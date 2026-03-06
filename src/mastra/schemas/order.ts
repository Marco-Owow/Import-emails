import { z } from 'zod';
import { extractionResultSchema } from './extraction-config';

// DB-persisted stable checkpoints only.
// Intermediate processing states (parsing, classifying, extracting, validating)
// are tracked by Mastra's workflow engine, not stored on the Order record.
export const orderStatusEnum = z.enum([
  'ingested',
  'classified',
  'extracted',
  'pending_review',
  'approved',
  'rejected',
  'pushed',
  'failed',
]);

export const orderSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  triggerEmailId: z.string().uuid().describe('The original email that created this order'),
  orderTypeId: z.string().uuid().nullable().optional().describe('Set after classification'),
  orderTypeSchemaId: z.string().uuid().nullable().optional().describe('Schema version used for extraction'),
  contactId: z.string().uuid().nullable().optional().describe('Resolved during customer identification'),
  status: orderStatusEnum,
  classificationSource: z.enum(['automatic', 'manual_folder', 'manual_override']).nullable().optional(),
  classificationConfidence: z.number().min(0).max(1).nullable().optional(),
  extractedData: extractionResultSchema.nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  approvedById: z.string().uuid().nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  systemReferenceId: z.string().nullable().optional().describe('Reference returned from ERP after successful delivery'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Order = z.infer<typeof orderSchema>;
export type OrderStatus = z.infer<typeof orderStatusEnum>;
