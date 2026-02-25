import { z } from 'zod';

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  contentHash: z.string().describe('SHA-256 of attachment content'),
  storagePath: z.string().describe('Local or S3 path to raw bytes'),
  pageCount: z.number().optional().describe('Page count for PDFs'),
  sheetCount: z.number().optional().describe('Sheet count for Excel files'),
  parseStatus: z.enum(['pending', 'parsed', 'error']).default('pending'),
  parseError: z.string().optional(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
