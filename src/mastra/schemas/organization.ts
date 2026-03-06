import { z } from 'zod';

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['onboarding', 'testing', 'live', 'churned']),
  goLiveAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const organizationSettingsSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),

  // Subscription & Billing
  tier: z.enum(['starter', 'standard', 'enterprise']),
  monthlyOrderLimit: z.number().int().nullable().optional(),
  monthlyLicenseFee: z.number().nullable().optional(),
  slaLevel: z.enum(['basis', 'standard', 'premium']).default('basis'),
  contractStartDate: z.string().nullable().optional(),
  contractEndDate: z.string().nullable().optional(),

  // Pipeline Configuration
  classificationStrategy: z.enum(['ai', 'folder_based', 'hybrid']).default('ai'),
  customerIdentificationStrategy: z.enum(['domain', 'llm', 'hybrid']).default('domain'),
  processingDelaySeconds: z.number().int().default(0),
  defaultLanguage: z.string().default('nl'),
  timezone: z.string().default('Europe/Brussels'),

  // Approval & Routing
  autoApproveOnPass: z.boolean().default(false),
  combineExceptionEmails: z.boolean().default(false),

  // Flexible Config
  features: z.record(z.string(), z.unknown()).nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Organization = z.infer<typeof organizationSchema>;
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;
