import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { extractionAgent } from '../agents/extraction-agent';

const routeEnum = z.enum(['no_action', 'sales_order', 'incoming_shipment', 'service_case']);
export type Route = z.infer<typeof routeEnum>;

export const classifyRouteTool = createTool({
  id: 'classify-route-tool',
  description: 'Classifies an email into one of 4 processing routes using LLM analysis of subject and body',
  inputSchema: z.object({
    subject: z.string(),
    bodyExcerpt: z.string().describe('First ~1500 chars of email body (HTML stripped)'),
  }),
  outputSchema: z.object({
    route: routeEnum,
  }),
  execute: async (inputData) => {
    const { subject, bodyExcerpt } = inputData;

    const prompt = `You are classifying an incoming business email for a B2B lighting products distributor (OWOW/Opple).

Classify this email into exactly ONE of these routes:
- "sales_order": Customer is placing a purchase order for products (mentions PO number, product codes, quantities, order confirmation request)
- "incoming_shipment": About an incoming delivery, container arrival, stock arrival, ASN, or stock discrepancy/return
- "service_case": Order status inquiry, complaint, return/RMA request, technical support, or other customer service matter
- "no_action": Newsletter, auto-reply, out-of-office, spam, informational memo with no action needed

Email subject: ${subject}

Email body (excerpt):
${bodyExcerpt.slice(0, 1500)}

Respond with ONLY the route string, one of: sales_order | incoming_shipment | service_case | no_action`;

    try {
      const response = await extractionAgent.generate(prompt);
      const text = response.text?.trim().toLowerCase() ?? '';

      // Extract route from response
      const route = routeEnum.parse(
        ['no_action', 'sales_order', 'incoming_shipment', 'service_case'].find((r) => text.includes(r)) ?? 'service_case',
      );

      console.log(`[classify-route] Route: ${route}`);
      return { route };
    } catch (error) {
      console.error('[classify-route] Classification failed:', error);
      return { route: 'service_case' as const };
    }
  },
});
