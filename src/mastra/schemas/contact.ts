import { z } from 'zod';

export const contactSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  externalId: z.string().nullable().optional().describe('ERP customer reference number'),
  email: z.string().nullable().optional(),
  name: z.string(),
  companyName: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Contact = z.infer<typeof contactSchema>;
