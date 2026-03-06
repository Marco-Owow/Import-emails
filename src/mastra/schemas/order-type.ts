import { z } from 'zod';

export const orderTypeSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().describe('e.g. Losopdracht, Sales Order (ZORN), No Action'),
  description: z.string().nullable().optional(),
  classificationHint: z.string().nullable().optional().describe('LLM classification prompt hint'),
  isActionable: z.boolean().describe('false for No Action types — skips extraction/validation/push'),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const fieldDefinitionSchema = z.object({
  name: z.string(),
  type: z.string(),
  label: z.string(),
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
});

export const orderTypeSchemaSchema = z.object({
  id: z.string().uuid(),
  orderTypeId: z.string().uuid(),
  version: z.number().int(),
  headerFields: z.array(fieldDefinitionSchema),
  lineItemFields: z.array(fieldDefinitionSchema),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const businessRuleSchema = z.object({
  id: z.string().uuid(),
  orderTypeId: z.string().uuid(),
  name: z.string(),
  type: z.enum([
    'required_field',
    'threshold',
    'duplicate_check',
    'calculated_field',
    'lookup_validation',
    'multi_field_comparison',
    'date_calculation',
    'conditional_flag',
  ]),
  config: z.record(z.string(), z.unknown()),
  severity: z.enum(['blocking', 'warning']),
  order: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OrderType = z.infer<typeof orderTypeSchema>;
export type OrderTypeSchema = z.infer<typeof orderTypeSchemaSchema>;
export type BusinessRule = z.infer<typeof businessRuleSchema>;
