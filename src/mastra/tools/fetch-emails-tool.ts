import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';

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

const rawEmailSchema = z.object({
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
});

export type RawEmail = z.infer<typeof rawEmailSchema>;

export const fetchEmailsTool = createTool({
  id: 'fetch-emails-tool',
  description: 'Fetches unread emails from an Outlook mailbox via Microsoft Graph API',
  inputSchema: z.object({
    mailbox: z.string().email().optional().describe('Mailbox to poll (defaults to GRAPH_MAILBOX env)'),
    maxResults: z.number().optional().default(50).describe('Maximum emails to fetch'),
  }),
  outputSchema: z.object({
    emails: z.array(rawEmailSchema),
    count: z.number(),
  }),
  execute: async (inputData) => {
    const mailbox = inputData.mailbox || process.env.GRAPH_MAILBOX;
    const maxResults = inputData.maxResults || 50;

    if (!mailbox) {
      throw new Error('No mailbox specified. Set GRAPH_MAILBOX env or pass mailbox parameter.');
    }

    console.log(`Fetching up to ${maxResults} unread emails from ${mailbox}...`);

    const client = getGraphClient();

    // Fetch unread messages with attachments metadata
    const response = await client
      .api(`/users/${mailbox}/mailFolders/inbox/messages`)
      .filter('isRead eq false')
      .top(maxResults)
      .select('id,subject,from,toRecipients,ccRecipients,body,conversationId,receivedDateTime,hasAttachments')
      .orderby('receivedDateTime desc')
      .get();

    const messages = response.value || [];
    const emails: RawEmail[] = [];

    for (const msg of messages) {
      // Fetch attachments if present
      let attachments: RawEmail['attachments'] = [];
      if (msg.hasAttachments) {
        const attachResponse = await client
          .api(`/users/${mailbox}/messages/${msg.id}/attachments`)
          .select('id,name,contentType,size')
          .get();
        attachments = (attachResponse.value || []).map((att: any) => ({
          id: att.id,
          name: att.name || 'unnamed',
          contentType: att.contentType || 'application/octet-stream',
          size: att.size || 0,
        }));
      }

      emails.push({
        id: msg.id,
        subject: msg.subject || '(no subject)',
        from: msg.from?.emailAddress?.address || 'unknown',
        toRecipients: (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean),
        ccRecipients: (msg.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean),
        body: msg.body?.content || '',
        bodyType: msg.body?.contentType === 'html' ? 'html' : 'text',
        conversationId: msg.conversationId,
        receivedDateTime: msg.receivedDateTime,
        hasAttachments: msg.hasAttachments || false,
        attachments,
      });
    }

    console.log(`Fetched ${emails.length} unread emails from ${mailbox}`);
    return { emails, count: emails.length };
  },
});
