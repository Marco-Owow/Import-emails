import { z } from 'zod';

export const emailSegmentSchema = z.object({
  type: z.enum(['plain', 'quote', 'forward_header', 'signature', 'greeting']),
  content: z.string(),
  from: z.string().optional().describe('Sender in forwarded block'),
  date: z.string().optional().describe('Date in forwarded block'),
});

export const pdfTableSchema = z.object({
  rows: z.array(z.array(z.string())),
  headers: z.array(z.string()).optional(),
});

export const pdfPageSchema = z.object({
  pageNumber: z.number(),
  text: z.string(),
  tables: z.array(pdfTableSchema).default([]),
});

export const pdfEvidenceSchema = z.object({
  attachmentId: z.string().uuid(),
  filename: z.string(),
  pages: z.array(pdfPageSchema),
});

export const excelTableSchema = z.object({
  range: z.string().optional(),
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export const excelSheetSchema = z.object({
  name: z.string(),
  tables: z.array(excelTableSchema).default([]),
  cellsSample: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const excelEvidenceSchema = z.object({
  attachmentId: z.string().uuid(),
  filename: z.string(),
  sheets: z.array(excelSheetSchema),
});

export const parseQualitySchema = z.object({
  score: z.number().min(0).max(1),
  errors: z.array(z.string()).default([]),
});

export const evidencePackSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  email: z.object({
    segments: z.array(emailSegmentSchema),
  }),
  pdfs: z.array(pdfEvidenceSchema).default([]),
  excels: z.array(excelEvidenceSchema).default([]),
  parseQuality: parseQualitySchema,
});

export type EmailSegment = z.infer<typeof emailSegmentSchema>;
export type PdfPage = z.infer<typeof pdfPageSchema>;
export type PdfEvidence = z.infer<typeof pdfEvidenceSchema>;
export type ExcelSheet = z.infer<typeof excelSheetSchema>;
export type ExcelEvidence = z.infer<typeof excelEvidenceSchema>;
export type EvidencePack = z.infer<typeof evidencePackSchema>;
export type ParseQuality = z.infer<typeof parseQualitySchema>;
