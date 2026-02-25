import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { query } from '../db/client';
import { extractionResultSchema } from '../schemas/extraction-config';
import { getOrderTypeConfig, orderTypeConfigs } from '../config/order-types';
import type { EvidencePack, EmailSegment, PdfEvidence, ExcelEvidence } from '../schemas';

function formatEvidenceForPrompt(pack: EvidencePack): string {
  const parts: string[] = [];

  // Email segments
  if (pack.email.segments.length > 0) {
    parts.push('=== EMAIL BODY ===');
    pack.email.segments.forEach((seg: EmailSegment, i: number) => {
      parts.push(`[Segment ${i} | type: ${seg.type}]`);
      parts.push(seg.content);
      if (seg.from) parts.push(`  From: ${seg.from}`);
      if (seg.date) parts.push(`  Date: ${seg.date}`);
      parts.push('');
    });
  }

  // PDF pages
  for (const pdf of pack.pdfs) {
    parts.push(`=== PDF: ${pdf.filename} ===`);
    for (const page of pdf.pages) {
      parts.push(`[Page ${page.pageNumber}]`);
      parts.push(page.text);
      if (page.tables.length > 0) {
        page.tables.forEach((table, ti) => {
          parts.push(`  [Table ${ti}]`);
          if (table.headers) parts.push(`  Headers: ${table.headers.join(' | ')}`);
          table.rows.forEach((row) => parts.push(`  ${row.join(' | ')}`));
        });
      }
      parts.push('');
    }
  }

  // Excel sheets
  for (const excel of pack.excels) {
    parts.push(`=== EXCEL: ${excel.filename} ===`);
    for (const sheet of excel.sheets) {
      parts.push(`[Sheet: ${sheet.name}]`);
      for (const table of sheet.tables) {
        parts.push(`  Headers: ${table.headers.join(' | ')}`);
        table.rows.slice(0, 50).forEach((row) => {
          const vals = table.headers.map((h) => `${h}: ${row[h] ?? ''}`);
          parts.push(`  ${vals.join(' | ')}`);
        });
      }
      parts.push('');
    }
  }

  return parts.join('\n');
}

function formatFieldsForPrompt(config: { fields: Array<{ key: string; label: string; type: string; required: boolean; description: string; examples?: string[] }> }): string {
  return config.fields
    .map((f) => {
      let line = `- ${f.key} (${f.label}): [${f.type}] ${f.required ? 'REQUIRED' : 'optional'} — ${f.description}`;
      if (f.examples && f.examples.length > 0) {
        line += ` Examples: ${f.examples.join(', ')}`;
      }
      return line;
    })
    .join('\n');
}

export const extractFieldsTool = createTool({
  id: 'extract-fields-tool',
  description: 'Extracts structured fields from an Evidence Pack using the extraction agent',
  inputSchema: z.object({
    orderId: z.string().uuid().describe('Order ID to extract fields for'),
    orderType: z.string().describe('Order type key (e.g. sales_order, incoming_shipment)'),
  }),
  outputSchema: extractionResultSchema,
  execute: async ({ orderId, orderType }, { mastra }) => {
    // Look up order type config
    const config = getOrderTypeConfig(orderType);
    if (!config) {
      const available = orderTypeConfigs.map((c) => c.orderType).join(', ');
      throw new Error(`Unknown order type "${orderType}". Available: ${available}`);
    }

    // Load evidence pack from DB
    const epResult = await query(
      'SELECT data FROM evidence_packs WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
      [orderId],
    );
    if (epResult.rows.length === 0) {
      throw new Error(`No evidence pack found for order ${orderId}. Run parse-workflow first.`);
    }
    const evidencePack: EvidencePack = epResult.rows[0].data;

    // Update order status
    await query('UPDATE orders SET status = $1, order_type = $2, updated_at = NOW() WHERE id = $3', [
      'extracting',
      orderType,
      orderId,
    ]);

    // Build the prompt
    const evidenceText = formatEvidenceForPrompt(evidencePack);
    const fieldsText = formatFieldsForPrompt(config);

    const prompt = `Extract the following fields from this ${config.label} evidence.

## Fields to Extract
${fieldsText}

## Evidence
${evidenceText}

Return a JSON object with:
- orderType: "${orderType}"
- fields: array of { key, value, confidence, evidenceRef } for each field above
- overallConfidence: weighted average of field confidences

Respond ONLY with valid JSON matching the extractionResult schema.`;

    // Call the extraction agent
    const agent = mastra?.getAgent('extractionAgent');
    if (!agent) {
      throw new Error('Extraction agent not found. Ensure it is registered in Mastra.');
    }

    const response = await agent.generate(prompt, {
      output: extractionResultSchema,
    });

    const result = response.object;

    // Store result in orders
    await query('UPDATE orders SET extracted_fields = $1, status = $2, updated_at = NOW() WHERE id = $3', [
      JSON.stringify(result),
      'extracted',
      orderId,
    ]);

    // Audit event
    const { randomUUID } = await import('crypto');
    await query(
      'INSERT INTO audit_events (id, order_id, event_type, payload) VALUES ($1, $2, $3, $4)',
      [
        randomUUID(),
        orderId,
        'fields_extracted',
        JSON.stringify({
          orderType,
          fieldCount: result.fields.length,
          overallConfidence: result.overallConfidence,
        }),
      ],
    );

    console.log(
      `Extracted ${result.fields.length} fields for order ${orderId} ` +
        `(type: ${orderType}, confidence: ${result.overallConfidence.toFixed(2)})`,
    );

    return result;
  },
});
