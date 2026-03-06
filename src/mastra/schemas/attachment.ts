import { z } from 'zod';

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  emailId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  storagePath: z.string().describe('Local or S3 path to raw bytes'),
  // Internal Mastra processing fields (not in the target schema spec, kept for pipeline use)
  contentHash: z.string().describe('SHA-256 of attachment content'),
  pageCount: z.number().int().optional().describe('Page count for PDFs'),
  sheetCount: z.number().int().optional().describe('Sheet count for Excel files'),
  parseStatus: z.enum(['pending', 'parsed', 'error']).default('pending'),
  parseError: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
