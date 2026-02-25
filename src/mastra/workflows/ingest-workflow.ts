import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { RequestContext } from '@mastra/core/di';
import { fetchEmailsTool } from '../tools/fetch-emails-tool';
import { storeMessageTool } from '../tools/store-message-tool';

const ingestInputSchema = z.object({
  mailbox: z.string().email().optional().describe('Mailbox to poll (defaults to GRAPH_MAILBOX env)'),
  maxResults: z.number().optional().default(50),
});

const fetchResultSchema = z.object({
  emails: z.array(z.object({
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
  })),
  count: z.number(),
});

const ingestOutputSchema = z.object({
  messageIds: z.array(z.string().uuid()),
  orderIds: z.array(z.string().uuid()),
  skippedCount: z.number(),
  errors: z.array(z.string()),
});

// Step 1: Fetch new emails from mailbox
const fetchEmailsStep = createStep({
  id: 'fetch-new-emails',
  description: 'Fetches unread emails from Outlook via Microsoft Graph',
  inputSchema: ingestInputSchema,
  outputSchema: fetchResultSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    console.log('Step: fetch-new-emails');

    const result = await fetchEmailsTool.execute!(
      {
        mailbox: inputData.mailbox,
        maxResults: inputData.maxResults,
      },
      { mastra, requestContext: requestContext || new RequestContext() },
    );

    if ('error' in result) {
      throw new Error('Failed to fetch emails: ' + result.error);
    }

    console.log(`Fetched ${result.count} unread emails`);
    return result;
  },
});

// Step 2: Store each email + create orders
const storeMessagesStep = createStep({
  id: 'store-messages',
  description: 'Stores raw emails, downloads attachments, creates Orders',
  inputSchema: fetchResultSchema,
  outputSchema: ingestOutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    console.log('Step: store-messages');

    const mailbox = process.env.GRAPH_MAILBOX || '';
    const messageIds: string[] = [];
    const orderIds: string[] = [];
    const errors: string[] = [];
    let skippedCount = 0;

    for (const email of inputData.emails) {
      try {
        const result = await storeMessageTool.execute!(
          { email, mailbox },
          { mastra, requestContext: requestContext || new RequestContext() },
        );

        if ('error' in result) {
          errors.push(`Email "${email.subject}": ${result.error}`);
          continue;
        }

        messageIds.push(result.messageId);
        orderIds.push(result.orderId);
        if (result.skipped) skippedCount++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Email "${email.subject}": ${msg}`);
      }
    }

    console.log(
      `Stored ${messageIds.length} messages, created ${orderIds.length} orders, ` +
      `skipped ${skippedCount} duplicates, ${errors.length} errors`,
    );

    return { messageIds, orderIds, skippedCount, errors };
  },
});

export const ingestWorkflow = createWorkflow({
  id: 'ingest-workflow',
  description: 'Fetches unread emails from Outlook, stores raw messages and attachments, creates Orders',
  inputSchema: ingestInputSchema,
  outputSchema: ingestOutputSchema,
})
  .then(fetchEmailsStep)
  .then(storeMessagesStep)
  .commit();
