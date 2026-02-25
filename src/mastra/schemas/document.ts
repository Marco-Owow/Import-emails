import { z } from 'zod';

export const documentSchema = z.object({
  id: z.string().uuid(),
  sourceType: z.enum(['email_body', 'pdf', 'excel_sheet']),
  sourceId: z.string().uuid().describe('messageId or attachmentId'),
  title: z.string().optional(),
  textContent: z.string().describe('Normalized plain text'),
  tables: z.array(z.object({
    headers: z.array(z.string()).optional(),
    rows: z.array(z.array(z.string())),
  })).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type Document = z.infer<typeof documentSchema>;
