import { z } from 'zod';

// Base email record — class table inheritance base (emails table).
// Shared by both inbound and outbound emails for unified thread display.
export const emailSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['inbound', 'outbound']),
  orderId: z.string().uuid().nullable().optional(),
  systemConnectionId: z.string().uuid().nullable().optional().describe('Outlook connection this email was received via'),
  threadId: z.string().nullable().optional().describe('Outlook conversationId'),
  subject: z.string(),
  externalId: z.string().nullable().optional().describe('Provider message ID'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Detail record for received emails — 1:1 with emails (inbound_emails table).
// Entry point of the pipeline — the first inbound email in a thread creates an Order.
export const inboundEmailSchema = z.object({
  id: z.string().uuid(),
  emailId: z.string().uuid(),
  folderId: z.string().nullable().optional().describe('Outlook folder ID for folder-based classification'),
  sender: z.string(),
  bodyHtml: z.string().nullable().optional(),
  bodyMarkdown: z.string().nullable().optional().describe('Converted for LLM processing'),
  receivedAt: z.string().datetime(),
});

export type Email = z.infer<typeof emailSchema>;
export type InboundEmail = z.infer<typeof inboundEmailSchema>;

// Legacy alias for internal compatibility
export type Message = Email & { sender: string; bodyHtml?: string | null; receivedAt: string };
