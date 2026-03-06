import { z } from 'zod';

export const systemConnectionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  type: z.enum(['outlook', 'sap', 'navision', 'ols', 'wms', 'print', 'edi_mailbox']),
  name: z.string(),
  status: z.enum(['connected', 'error', 'disabled']),
  config: z.record(z.string(), z.unknown()).describe(
    'Endpoints, credentials, connection parameters. For Outlook: {email, webhookSubscriptionId, webhookExpiresAt, deltaToken, folderMappings}',
  ),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SystemConnection = z.infer<typeof systemConnectionSchema>;
