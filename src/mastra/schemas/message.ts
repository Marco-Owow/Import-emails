import { z } from 'zod';

export const messageSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().describe('Microsoft Graph message ID'),
  mailbox: z.string().email(),
  from: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()).default([]),
  subject: z.string(),
  body: z.string().describe('Raw HTML or text body'),
  bodyType: z.enum(['html', 'text']),
  threadId: z.string().optional().describe('conversationId from Graph'),
  receivedAt: z.string().datetime(),
  contentHash: z.string().describe('SHA-256 of externalId for idempotency'),
  rawMime: z.string().optional(),
});

export type Message = z.infer<typeof messageSchema>;
