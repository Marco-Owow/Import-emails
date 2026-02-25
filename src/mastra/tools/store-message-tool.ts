import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { query } from '../db/client';

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function getGraphClient(): Client {
  const credential = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!,
  );

  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        return token.token;
      },
    },
  });
}

const ATTACHMENTS_DIR = path.resolve('data/attachments');

export const storeMessageTool = createTool({
  id: 'store-message-tool',
  description: 'Stores a raw email and its attachments in Postgres, creates an Order, with idempotency',
  inputSchema: z.object({
    email: z.object({
      id: z.string(),
      subject: z.string(),
      from: z.string(),
      toRecipients: z.array(z.string()),
      ccRecipients: z.array(z.string()),
      body: z.string(),
      bodyType: z.enum(['html', 'text']),
      conversationId: z.string().optional(),
      receivedDateTime: z.string(),
      hasAttachments: z.boolean(),
      attachments: z.array(z.object({
        id: z.string(),
        name: z.string(),
        contentType: z.string(),
        size: z.number(),
      })),
    }),
    mailbox: z.string().email(),
  }),
  outputSchema: z.object({
    messageId: z.string().uuid(),
    attachmentIds: z.array(z.string().uuid()),
    orderId: z.string().uuid(),
    skipped: z.boolean().describe('True if message was already ingested'),
  }),
  execute: async (inputData) => {
    const { email, mailbox } = inputData;

    // Idempotency: hash the external email ID
    const contentHash = sha256(email.id);

    // Check if already stored
    const existing = await query(
      'SELECT id FROM messages WHERE content_hash = $1',
      [contentHash],
    );

    if (existing.rows.length > 0) {
      const msgId = existing.rows[0].id;
      // Find existing order
      const orderRow = await query('SELECT id FROM orders WHERE message_id = $1', [msgId]);
      const attRows = await query('SELECT id FROM attachments WHERE message_id = $1', [msgId]);
      console.log(`Message already ingested (hash: ${contentHash.slice(0, 8)}...), skipping.`);
      return {
        messageId: msgId,
        attachmentIds: attRows.rows.map((r: any) => r.id),
        orderId: orderRow.rows[0]?.id || '',
        skipped: true,
      };
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    // Store message
    await query(
      `INSERT INTO messages (id, external_id, mailbox, "from", "to", cc, subject, body, body_type, thread_id, received_at, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        messageId,
        email.id,
        mailbox,
        email.from,
        email.toRecipients,
        email.ccRecipients,
        email.subject,
        email.body,
        email.bodyType,
        email.conversationId || null,
        email.receivedDateTime,
        contentHash,
      ],
    );

    console.log(`Stored message ${messageId} (subject: "${email.subject}")`);

    // Download and store attachments
    const attachmentIds: string[] = [];

    if (email.hasAttachments && email.attachments.length > 0) {
      // Ensure attachments dir exists
      fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

      const client = getGraphClient();

      for (const att of email.attachments) {
        const attachmentId = randomUUID();
        let parseStatus = 'pending';
        let parseError: string | null = null;
        let storagePath = '';
        let attachmentContentHash = '';

        try {
          // Download attachment content from Graph
          const attData = await client
            .api(`/users/${mailbox}/messages/${email.id}/attachments/${att.id}`)
            .get();

          const contentBytes = attData.contentBytes
            ? Buffer.from(attData.contentBytes, 'base64')
            : Buffer.alloc(0);

          attachmentContentHash = sha256(contentBytes);

          // Save to disk
          const ext = path.extname(att.name) || '';
          const safeFilename = `${attachmentId}${ext}`;
          storagePath = path.join(ATTACHMENTS_DIR, safeFilename);
          fs.writeFileSync(storagePath, contentBytes);

          console.log(`  Saved attachment: ${att.name} (${contentBytes.length} bytes)`);
        } catch (error) {
          parseStatus = 'error';
          parseError = error instanceof Error ? error.message : 'Failed to download attachment';
          storagePath = '';
          attachmentContentHash = sha256(att.id);
          console.error(`  Failed to download attachment ${att.name}: ${parseError}`);
        }

        // Determine page/sheet count hints from mime type
        const isPdf = att.contentType === 'application/pdf';
        const isExcel = att.contentType.includes('spreadsheet') ||
          att.contentType.includes('excel') ||
          att.name.endsWith('.xlsx') ||
          att.name.endsWith('.xls');

        await query(
          `INSERT INTO attachments (id, message_id, filename, mime_type, size_bytes, content_hash, storage_path, parse_status, parse_error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            attachmentId,
            messageId,
            att.name,
            att.contentType,
            att.size,
            attachmentContentHash,
            storagePath,
            parseStatus,
            parseError,
          ],
        );

        attachmentIds.push(attachmentId);
      }
    }

    // Create Order
    const orderId = randomUUID();
    await query(
      `INSERT INTO orders (id, message_id, status, created_at, updated_at)
       VALUES ($1, $2, 'new', $3, $3)`,
      [orderId, messageId, now],
    );

    // Audit event
    await query(
      `INSERT INTO audit_events (id, order_id, event_type, payload)
       VALUES ($1, $2, 'order_created', $3)`,
      [
        randomUUID(),
        orderId,
        JSON.stringify({
          messageId,
          attachmentCount: attachmentIds.length,
          subject: email.subject,
          from: email.from,
        }),
      ],
    );

    console.log(`Created order ${orderId} (status: new, attachments: ${attachmentIds.length})`);

    return { messageId, attachmentIds, orderId, skipped: false };
  },
});
