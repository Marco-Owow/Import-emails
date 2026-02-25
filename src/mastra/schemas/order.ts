import { z } from 'zod';

export const orderStatusEnum = z.enum([
  'new',
  'parsing',
  'parsed',
  'classifying',
  'classified',
  'extracting',
  'extracted',
  'validating',
  'validated',
  'review',
  'approved',
  'submitted',
  'error',
  'flagged',
]);

export const orderSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  status: orderStatusEnum,
  orderType: z.string().optional(),
  clientId: z.string().optional(),
  evidencePackId: z.string().uuid().optional(),
  extractedFields: z.record(z.string(), z.unknown()).optional(),
  validationResults: z.record(z.string(), z.unknown()).optional(),
  userEdits: z.record(z.string(), z.unknown()).optional(),
  erpPayload: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Order = z.infer<typeof orderSchema>;
export type OrderStatus = z.infer<typeof orderStatusEnum>;
