import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { RequestContext } from '@mastra/core/di';
import { query } from '../db/client';
import { resolveSenderTool } from '../tools/resolve-sender-tool';
import { classifyRouteTool } from '../tools/classify-route-tool';

// ─── Schemas shared between steps ────────────────────────────────────────────

const classifyInputSchema = z.object({
  orderId: z.string().uuid().describe('Order ID to classify'),
});

const segmentSchema = z.object({
  type: z.enum(['plain', 'quote', 'forward_header', 'signature', 'greeting']),
  content: z.string(),
  from: z.string().optional(),
  date: z.string().optional(),
});

const contextSchema = z.object({
  orderId: z.string().uuid(),
  emailId: z.string().uuid(),
  from: z.string(),
  subject: z.string(),
  bodyExcerpt: z.string(),
  segments: z.array(segmentSchema),
});

const senderDetectedSchema = contextSchema.extend({
  senderType: z.enum(['opple', 'external']),
  originalCustomerName: z.string().optional(),
});

const customerResolvedSchema = senderDetectedSchema.extend({
  soldToCode: z.string().optional(),
  company: z.string().optional(),
  country: z.string().optional(),
  confirmationEmail: z.string().optional(),
  deliveryDay: z.string().optional(),
  combiningDay: z.string().optional(),
  isResolved: z.boolean(),
  matchMethod: z.enum(['email_exact', 'name_fuzzy', 'llm_name_fuzzy', 'unresolved']),
  matchConfidence: z.number(),
});

const routeClassifiedSchema = customerResolvedSchema.extend({
  route: z.enum(['no_action', 'sales_order', 'incoming_shipment', 'service_case']),
});

const classifyOutputSchema = z.object({
  orderId: z.string().uuid(),
  orderType: z.string(),
  soldToCode: z.string().optional(),
  company: z.string().optional(),
  country: z.string().optional(),
  status: z.string(),
  flagReason: z.string().optional(),
});

// ─── Step 1: Fetch order + email + evidence pack from DB ──────────────────────

const fetchClassifyContextStep = createStep({
  id: 'fetch-classify-context',
  description: 'Loads order, inbound email, and evidence pack from the database',
  inputSchema: classifyInputSchema,
  outputSchema: contextSchema,
  execute: async ({ inputData }) => {
    const { orderId } = inputData;
    console.log(`Step: fetch-classify-context for order ${orderId}`);

    const orderRow = await query(
      'SELECT id, trigger_email_id FROM orders WHERE id = $1',
      [orderId],
    );
    if (orderRow.rows.length === 0) throw new Error(`Order not found: ${orderId}`);
    const emailId: string = orderRow.rows[0].trigger_email_id;

    // Load inbound email detail
    const emailRow = await query(
      `SELECT e.subject, ie.sender, ie.body_html
       FROM emails e
       JOIN inbound_emails ie ON ie.email_id = e.id
       WHERE e.id = $1`,
      [emailId],
    );
    if (emailRow.rows.length === 0) throw new Error(`Inbound email not found: ${emailId}`);
    const { subject, sender, body_html } = emailRow.rows[0];

    // Load evidence pack for parsed segments
    const epRow = await query(
      'SELECT data FROM evidence_packs WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
      [orderId],
    );

    let segments: z.infer<typeof segmentSchema>[] = [];
    if (epRow.rows.length > 0) {
      const ep = epRow.rows[0].data;
      segments = ep?.email?.segments ?? [];
    }

    // Strip HTML tags for excerpt
    const bodyExcerpt = (body_html ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);

    return { orderId, emailId, from: sender, subject, bodyExcerpt, segments };
  },
});

// ─── Step 2: Detect sender type (Opple vs external) ──────────────────────────

const detectSenderTypeStep = createStep({
  id: 'detect-sender-type',
  description: 'Determines if the sender is an Opple internal address and extracts the original customer name',
  inputSchema: contextSchema,
  outputSchema: senderDetectedSchema,
  execute: async ({ inputData }) => {
    const { from, segments } = inputData;
    console.log(`Step: detect-sender-type (from: ${from})`);

    const isOpple = from.toLowerCase().includes('@opple.com');
    const senderType = isOpple ? 'opple' : 'external';

    let originalCustomerName: string | undefined;

    if (isOpple) {
      for (const seg of segments) {
        if (seg.type === 'forward_header' && seg.from) {
          const nameMatch = seg.from.match(/^([^<]+)</);
          if (nameMatch) {
            originalCustomerName = nameMatch[1].trim();
          } else {
            const emailMatch = seg.from.match(/@([^.>]+)/);
            if (emailMatch) originalCustomerName = emailMatch[1];
          }
          break;
        }
      }
      console.log(`Opple sender detected. Original customer hint: "${originalCustomerName ?? 'none'}"`);
    }

    return { ...inputData, senderType, originalCustomerName };
  },
});

// ─── Step 3: Resolve customer against master data ─────────────────────────────

const resolveCustomerStep = createStep({
  id: 'resolve-customer',
  description: 'Looks up the Sold-To code from Customer Master Data Excel',
  inputSchema: senderDetectedSchema,
  outputSchema: customerResolvedSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const { senderType, from, originalCustomerName, bodyExcerpt, segments } = inputData;
    console.log(`Step: resolve-customer (senderType: ${senderType})`);

    const result = await resolveSenderTool.execute!(
      {
        senderType,
        fromEmail: from,
        originalCustomerName,
        emailBodyExcerpt: bodyExcerpt,
        segments,
      },
      { mastra, requestContext: requestContext || new RequestContext() },
    );

    return { ...inputData, ...result };
  },
});

// ─── Step 4: Classify route via LLM ──────────────────────────────────────────

const classifyRouteStep = createStep({
  id: 'classify-route',
  description: 'Classifies the email into a processing route (sales_order, shipment, service, no_action)',
  inputSchema: customerResolvedSchema,
  outputSchema: routeClassifiedSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const { subject, bodyExcerpt } = inputData;
    console.log(`Step: classify-route (subject: "${subject}")`);

    const result = await classifyRouteTool.execute!(
      { subject, bodyExcerpt },
      { mastra, requestContext: requestContext || new RequestContext() },
    );

    return { ...inputData, route: result.route };
  },
});

// ─── Step 5: Finalize — write order type + contact to DB ────────────────────

const finalizeClassificationStep = createStep({
  id: 'finalize-classification',
  description: 'Determines final order type, writes results to DB, creates audit log entry',
  inputSchema: routeClassifiedSchema,
  outputSchema: classifyOutputSchema,
  execute: async ({ inputData }) => {
    const {
      orderId,
      organizationId: _orgId,
      route,
      isResolved,
      soldToCode,
      company,
      country,
      confirmationEmail,
      deliveryDay,
      combiningDay,
      matchMethod,
      matchConfidence,
    } = inputData as typeof inputData & { organizationId?: string };

    console.log(`Step: finalize-classification (route: ${route}, resolved: ${isResolved})`);

    let orderType: string;
    let status: string;
    let flagReason: string | undefined;

    if (!isResolved) {
      orderType = route;
      status = 'failed';
      flagReason = 'customer_not_identified';
    } else {
      status = 'classified';
      switch (route) {
        case 'no_action':
          orderType = 'no_action';
          break;
        case 'sales_order':
          orderType = country?.toLowerCase() === 'italy'
            ? 'sales_order_zorn_italy'
            : 'sales_order_zorn';
          break;
        case 'incoming_shipment':
          orderType = 'incoming_shipment';
          break;
        case 'service_case':
          orderType = 'service_case';
          break;
        default:
          orderType = route;
      }
    }

    // Resolve or create a contact record for this customer
    let contactId: string | null = null;
    if (isResolved && soldToCode) {
      // Look for existing contact by externalId (ERP sold-to code) in this org
      const orgRow = await query('SELECT organization_id FROM orders WHERE id = $1', [orderId]);
      const organizationId = orgRow.rows[0]?.organization_id;

      if (organizationId) {
        const contactRow = await query(
          'SELECT id FROM contacts WHERE organization_id = $1 AND external_id = $2',
          [organizationId, soldToCode],
        );

        if (contactRow.rows.length > 0) {
          contactId = contactRow.rows[0].id;
        } else {
          // Stub: insert a minimal contact record so the FK can be satisfied
          contactId = randomUUID();
          await query(
            `INSERT INTO contacts (id, organization_id, external_id, email, name, company_name, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
            [
              contactId,
              organizationId,
              soldToCode,
              confirmationEmail ?? null,
              company ?? soldToCode,
              company ?? null,
            ],
          );
        }
      }
    }

    // Look up order_type_id from the order_types table by name key
    const orgRow2 = await query('SELECT organization_id FROM orders WHERE id = $1', [orderId]);
    const organizationId = orgRow2.rows[0]?.organization_id;
    let orderTypeId: string | null = null;
    if (organizationId) {
      const otRow = await query(
        'SELECT id FROM order_types WHERE organization_id = $1 AND name = $2',
        [organizationId, orderType],
      );
      orderTypeId = otRow.rows[0]?.id ?? null;
    }

    // Persist to orders table
    await query(
      `UPDATE orders
       SET status = $1,
           order_type_id = $2,
           contact_id = $3,
           classification_source = 'automatic',
           classification_confidence = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [status, orderTypeId, contactId, matchConfidence, orderId],
    );

    // Audit log — status change
    await query(
      `INSERT INTO audit_logs (id, order_id, user_id, action, old_value, new_value, metadata, created_at, updated_at)
       VALUES ($1, $2, NULL, 'status_change', 'ingested', $3, $4, NOW(), NOW())`,
      [
        randomUUID(),
        orderId,
        status,
        JSON.stringify({
          orderType,
          flagReason,
          soldToCode,
          company,
          country,
          confirmationEmail,
          deliveryDay,
          combiningDay,
          matchMethod,
          matchConfidence,
        }),
      ],
    );

    console.log(
      `Order ${orderId} classified: type="${orderType}", status="${status}"` +
      (flagReason ? `, flagReason="${flagReason}"` : '') +
      ` (customer: "${company ?? 'unknown'}", soldTo: "${soldToCode ?? 'none'}")`,
    );

    return { orderId, orderType, soldToCode, company, country, status, flagReason };
  },
});

// ─── Workflow assembly ────────────────────────────────────────────────────────

export const classifyWorkflow = createWorkflow({
  id: 'classify-workflow',
  description: 'Identifies the customer (Sold-To lookup) and classifies the email route (ZORN / ZORN Italy / Shipment / Service / No Action)',
  inputSchema: classifyInputSchema,
  outputSchema: classifyOutputSchema,
})
  .then(fetchClassifyContextStep)
  .then(detectSenderTypeStep)
  .then(resolveCustomerStep)
  .then(classifyRouteStep)
  .then(finalizeClassificationStep)
  .commit();
