import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { RequestContext } from '@mastra/core/di';
import { query } from '../db/client';
import { parseEmailBodyTool } from '../tools/parse-email-body-tool';
import { parsePdfTool } from '../tools/parse-pdf-tool';
import { parseExcelTool } from '../tools/parse-excel-tool';
import { evidencePackSchema, parseQualitySchema } from '../schemas';
import type { EmailSegment, PdfEvidence, ExcelEvidence } from '../schemas';

const parseInputSchema = z.object({
  orderId: z.string().uuid().describe('Order ID to parse'),
});

// Intermediate schema after email parsing
const emailParsedSchema = z.object({
  orderId: z.string().uuid(),
  messageId: z.string().uuid(),
  segments: z.array(z.object({
    type: z.enum(['plain', 'quote', 'forward_header', 'signature', 'greeting']),
    content: z.string(),
    from: z.string().optional(),
    date: z.string().optional(),
  })),
  attachmentIds: z.array(z.object({
    id: z.string().uuid(),
    filename: z.string(),
    mimeType: z.string(),
  })),
});

// After all attachments are parsed
const attachmentsParsedSchema = z.object({
  orderId: z.string().uuid(),
  messageId: z.string().uuid(),
  segments: emailParsedSchema.shape.segments,
  pdfs: z.array(z.object({
    attachmentId: z.string().uuid(),
    filename: z.string(),
    pages: z.array(z.object({
      pageNumber: z.number(),
      text: z.string(),
      tables: z.array(z.object({
        rows: z.array(z.array(z.string())),
        headers: z.array(z.string()).optional(),
      })).default([]),
    })),
  })),
  excels: z.array(z.object({
    attachmentId: z.string().uuid(),
    filename: z.string(),
    sheets: z.array(z.object({
      name: z.string(),
      tables: z.array(z.object({
        range: z.string().optional(),
        headers: z.array(z.string()),
        rows: z.array(z.record(z.string(), z.unknown())),
      })).default([]),
      cellsSample: z.array(z.record(z.string(), z.unknown())).optional(),
    })),
  })),
  errors: z.array(z.string()),
});

const parseOutputSchema = z.object({
  evidencePackId: z.string().uuid(),
  parseQuality: parseQualitySchema,
});

// Step 1: Parse email body into segments
const parseEmailBodyStep = createStep({
  id: 'parse-email-body',
  description: 'Parses the email body into structured segments (plain, quotes, forwards, signature)',
  inputSchema: parseInputSchema,
  outputSchema: emailParsedSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const { orderId } = inputData;
    console.log(`Step: parse-email-body for order ${orderId}`);

    // Update order status
    await query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', ['parsing', orderId]);

    // Get the message ID for this order
    const orderResult = await query('SELECT message_id FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      throw new Error(`Order not found: ${orderId}`);
    }
    const messageId = orderResult.rows[0].message_id;

    // Parse email body
    const result = await parseEmailBodyTool.execute!(
      { messageId },
      { mastra, requestContext: requestContext || new RequestContext() },
    );

    if ('error' in result) {
      throw new Error('Failed to parse email body: ' + result.error);
    }

    // Get attachments for this message
    const attResult = await query(
      'SELECT id, filename, mime_type FROM attachments WHERE message_id = $1 AND parse_status != $2',
      [messageId, 'error'],
    );

    const attachmentIds = attResult.rows.map((r: any) => ({
      id: r.id,
      filename: r.filename,
      mimeType: r.mime_type,
    }));

    console.log(`Email parsed: ${result.segmentCount} segments, ${attachmentIds.length} attachments to process`);

    return {
      orderId,
      messageId,
      segments: result.segments,
      attachmentIds,
    };
  },
});

// Step 2: Parse all attachments (PDFs + Excel)
const parseAttachmentsStep = createStep({
  id: 'parse-attachments',
  description: 'Parses PDF and Excel attachments into structured data',
  inputSchema: emailParsedSchema,
  outputSchema: attachmentsParsedSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const { orderId, messageId, segments, attachmentIds } = inputData;
    console.log(`Step: parse-attachments for order ${orderId}`);

    const pdfs: PdfEvidence[] = [];
    const excels: ExcelEvidence[] = [];
    const errors: string[] = [];

    for (const att of attachmentIds) {
      const isPdf = att.mimeType === 'application/pdf' || att.filename.endsWith('.pdf');
      const isExcel =
        att.mimeType.includes('spreadsheet') ||
        att.mimeType.includes('excel') ||
        att.filename.endsWith('.xlsx') ||
        att.filename.endsWith('.xls');

      try {
        if (isPdf) {
          const result = await parsePdfTool.execute!(
            { attachmentId: att.id },
            { mastra, requestContext: requestContext || new RequestContext() },
          );
          if (!('error' in result)) {
            pdfs.push({
              attachmentId: result.attachmentId,
              filename: result.filename,
              pages: result.pages,
            });
          }
        } else if (isExcel) {
          const result = await parseExcelTool.execute!(
            { attachmentId: att.id },
            { mastra, requestContext: requestContext || new RequestContext() },
          );
          if (!('error' in result)) {
            excels.push({
              attachmentId: result.attachmentId,
              filename: result.filename,
              sheets: result.sheets,
            });
          }
        } else {
          console.log(`Skipping unsupported attachment type: ${att.filename} (${att.mimeType})`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${att.filename}: ${msg}`);
        // Mark attachment as error
        await query(
          'UPDATE attachments SET parse_status = $1, parse_error = $2 WHERE id = $3',
          ['error', msg, att.id],
        );
      }
    }

    console.log(`Attachments parsed: ${pdfs.length} PDFs, ${excels.length} Excel files, ${errors.length} errors`);

    return { orderId, messageId, segments, pdfs, excels, errors };
  },
});

// Step 3: Assemble evidence pack and store
const assembleEvidencePackStep = createStep({
  id: 'assemble-evidence-pack',
  description: 'Combines parsed email + attachments into canonical Evidence Pack',
  inputSchema: attachmentsParsedSchema,
  outputSchema: parseOutputSchema,
  execute: async ({ inputData }) => {
    const { orderId, segments, pdfs, excels, errors } = inputData;
    console.log(`Step: assemble-evidence-pack for order ${orderId}`);

    const evidencePackId = randomUUID();

    // Compute parse quality: start at 1.0, subtract per error
    const errorPenalty = 0.15;
    const score = Math.max(0, 1.0 - errors.length * errorPenalty);
    const parseQuality = { score, errors };

    const evidencePack = {
      id: evidencePackId,
      orderId,
      email: { segments },
      pdfs,
      excels,
      parseQuality,
    };

    // Validate against schema
    evidencePackSchema.parse(evidencePack);

    // Store in Postgres
    await query(
      'INSERT INTO evidence_packs (id, order_id, data) VALUES ($1, $2, $3)',
      [evidencePackId, orderId, JSON.stringify(evidencePack)],
    );

    // Update order
    await query(
      'UPDATE orders SET status = $1, evidence_pack_id = $2, updated_at = NOW() WHERE id = $3',
      ['parsed', evidencePackId, orderId],
    );

    // Audit event
    await query(
      'INSERT INTO audit_events (id, order_id, event_type, payload) VALUES ($1, $2, $3, $4)',
      [
        randomUUID(),
        orderId,
        'evidence_pack_created',
        JSON.stringify({
          evidencePackId,
          emailSegments: segments.length,
          pdfCount: pdfs.length,
          excelCount: excels.length,
          parseQuality,
        }),
      ],
    );

    console.log(
      `Evidence pack ${evidencePackId} stored (quality: ${score.toFixed(2)}, ` +
      `${segments.length} segments, ${pdfs.length} PDFs, ${excels.length} Excel files)`,
    );

    return { evidencePackId, parseQuality };
  },
});

export const parseWorkflow = createWorkflow({
  id: 'parse-workflow',
  description: 'Parses email body and attachments (PDF/Excel) into a structured Evidence Pack',
  inputSchema: parseInputSchema,
  outputSchema: parseOutputSchema,
})
  .then(parseEmailBodyStep)
  .then(parseAttachmentsStep)
  .then(assembleEvidencePackStep)
  .commit();
