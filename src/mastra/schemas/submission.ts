import { z } from 'zod';

export const systemSubmissionSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  systemConnectionId: z.string().uuid(),
  idempotencyKey: z.string().describe('Prevents double-submitting to ERPs on retries'),
  status: z.enum(['success', 'failed']),
  request: z.record(z.string(), z.unknown()).nullable().optional().describe('Translated payload sent to external system'),
  response: z.record(z.string(), z.unknown()).nullable().optional().describe('Raw response from external system'),
  referenceId: z.string().nullable().optional().describe('External reference on success'),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SystemSubmission = z.infer<typeof systemSubmissionSchema>;
