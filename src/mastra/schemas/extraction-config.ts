import { z } from 'zod';

export const extractionFieldDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'date', 'boolean', 'array', 'address']),
  required: z.boolean().default(true),
  description: z.string(),
  examples: z.array(z.string()).optional(),
});

export const orderTypeConfigSchema = z.object({
  orderType: z.string(),
  label: z.string(),
  description: z.string(),
  fields: z.array(extractionFieldDefSchema),
});

export const extractedFieldValueSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  evidenceRef: z.string().optional(),
});

export const extractionResultSchema = z.object({
  orderType: z.string(),
  fields: z.array(extractedFieldValueSchema),
  overallConfidence: z.number().min(0).max(1),
});

export type ExtractionFieldDef = z.infer<typeof extractionFieldDefSchema>;
export type OrderTypeConfig = z.infer<typeof orderTypeConfigSchema>;
export type ExtractedFieldValue = z.infer<typeof extractedFieldValueSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
