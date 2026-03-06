import { z } from 'zod';

export const orderValidationSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  businessRuleId: z.string().uuid(),
  status: z.enum(['passed', 'failed']),
  severity: z.enum(['blocking', 'warning']),
  message: z.string().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  assigneeRole: z.string().nullable().optional().describe(
    'Role-based routing hint, e.g. operational_buyer, tactical_buyer',
  ),
  resolvedById: z.string().uuid().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OrderValidation = z.infer<typeof orderValidationSchema>;
