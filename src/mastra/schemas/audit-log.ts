import { z } from 'zod';

export const auditLogSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional().describe('null for system-triggered actions'),
  action: z.enum([
    'field_edit',
    'line_item_edit',
    'status_change',
    'classification_override',
    'approval',
    'rejection',
    'assignment',
    'validation_resolve',
  ]),
  fieldPath: z.string().nullable().optional().describe("e.g. 'extractedData.quantity', 'lineItems.0.data.price'"),
  oldValue: z.string().nullable().optional(),
  newValue: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AuditLog = z.infer<typeof auditLogSchema>;
