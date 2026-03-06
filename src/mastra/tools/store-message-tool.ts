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
    emailId: z.string().uuid(),
    attachmentIds: z.array(z.string().uuid()),
    orderId: z.string().uuid(),
    skipped: z.boolean().describe('True if message was already ingested'),
  }),
  execute: async (inputData) => {
    const { email, mailbox } = inputData;

    // Idempotency: hash the external email ID
    const contentHash = sha256(email.id);

    // Resolve organization — use DEFAULT_ORG_ID from env (set by seed script)
    const organizationId = process.env.DEFAULT_ORG_ID;
    if (!organizationId) {
      throw new Error('DEFAULT_ORG_ID env var not set. Run db:seed first.');
    }

    // Check if already stored (idempotency via content_hash on email_attachments or emails external_id)
    const existing = await query(
      'SELECT id FROM emails WHERE external_id = $1',
      [email.id],
    );

    if (existing.rows.length > 0) {
      const emailId = existing.rows[0].id;
      const orderRow = await query('SELECT id FROM orders WHERE trigger_email_id = $1', [emailId]);
      const attRows = await query('SELECT id FROM email_attachments WHERE email_id = $1', [emailId]);
      console.log(`Email already ingested (externalId: ${email.id.slice(0, 16)}...), skipping.`);
      return {
        emailId,
        attachmentIds: attRows.rows.map((r: any) => r.id),
        orderId: orderRow.rows[0]?.id || '',
        skipped: true,
      };
    }

    const emailId = randomUUID();
    const now = new Date().toISOString();

    // Insert base email record
    await query(
      `INSERT INTO emails (id, type, system_connection_id, thread_id, subject, external_id, created_at, updated_at)
       VALUES ($1, 'inbound', NULL, $2, $3, $4, $5, $5)`,
      [
        emailId,
        email.conversationId || null,
        email.subject,
        email.id,
        now,
      ],
    );

    // Insert inbound_emails detail record
    const inboundEmailId = randomUUID();
    await query(
      `INSERT INTO inbound_emails (id, email_id, sender, body_html, body_markdown, received_at)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [
        inboundEmailId,
        emailId,
        email.from,
        email.bodyType === 'html' ? email.body : null,
        email.receivedDateTime,
      ],
    );

    console.log(`Stored email ${emailId} (subject: "${email.subject}")`);

    // Download and store attachments
    const attachmentIds: string[] = [];

    if (email.hasAttachments && email.attachments.length > 0) {
      fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

      const client = getGraphClient();

      for (const att of email.attachments) {
        const attachmentId = randomUUID();
        let parseStatus = 'pending';
        let parseError: string | null = null;
        let storagePath = '';
        let contentHashAtt = '';

        try {
          const attData = await client
            .api(`/users/${mailbox}/messages/${email.id}/attachments/${att.id}`)
            .get();

          const contentBytes = attData.contentBytes
            ? Buffer.from(attData.contentBytes, 'base64')
            : Buffer.alloc(0);

          contentHashAtt = sha256(contentBytes);

          const ext = path.extname(att.name) || '';
          const safeFilename = `${attachmentId}${ext}`;
          storagePath = path.join(ATTACHMENTS_DIR, safeFilename);
          fs.writeFileSync(storagePath, contentBytes);

          console.log(`  Saved attachment: ${att.name} (${contentBytes.length} bytes)`);
        } catch (error) {
          parseStatus = 'error';
          parseError = error instanceof Error ? error.message : 'Failed to download attachment';
          storagePath = '';
          contentHashAtt = sha256(att.id);
          console.error(`  Failed to download attachment ${att.name}: ${parseError}`);
        }

        await query(
          `INSERT INTO email_attachments (id, email_id, file_name, mime_type, size, storage_path, content_hash, parse_status, parse_error, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [
            attachmentId,
            emailId,
            att.name,
            att.contentType,
            att.size,
            storagePath,
            contentHashAtt,
            parseStatus,
            parseError,
            now,
          ],
        );

        attachmentIds.push(attachmentId);
      }
    }

    // Create Order
    const orderId = randomUUID();
    await query(
      `INSERT INTO orders (id, organization_id, trigger_email_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ingested', $4, $4)`,
      [orderId, organizationId, emailId, now],
    );

    // Update emails.order_id back-reference
    await query('UPDATE emails SET order_id = $1, updated_at = NOW() WHERE id = $2', [orderId, emailId]);

    // Audit log
    await query(
      `INSERT INTO audit_logs (id, order_id, user_id, action, new_value, metadata, created_at, updated_at)
       VALUES ($1, $2, NULL, 'status_change', 'ingested', $3, $4, $4)`,
      [
        randomUUID(),
        orderId,
        JSON.stringify({
          emailId,
          attachmentCount: attachmentIds.length,
          subject: email.subject,
          sender: email.from,
        }),
        now,
      ],
    );

    console.log(`Created order ${orderId} (status: ingested, attachments: ${attachmentIds.length})`);

    return { emailId, attachmentIds, orderId, skipped: false };
  },
});
