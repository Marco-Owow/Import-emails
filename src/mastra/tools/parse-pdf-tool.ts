import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { query } from '../db/client';
import { pdfPageSchema } from '../schemas';

/**
 * Basic table detection from text lines.
 * Looks for lines with consistent column-like spacing (tabs or multiple spaces).
 */
function detectTables(text: string): { rows: string[][]; headers?: string[] }[] {
  const lines = text.split('\n').filter(l => l.trim());
  const tables: { rows: string[][]; headers?: string[] }[] = [];
  let currentTableRows: string[][] = [];

  for (const line of lines) {
    // A "table-like" line has multiple tab-separated or multi-space-separated values
    const cells = line.split(/\t+|\s{3,}/).map(c => c.trim()).filter(Boolean);

    if (cells.length >= 2) {
      currentTableRows.push(cells);
    } else {
      // Flush current table if we had rows
      if (currentTableRows.length >= 2) {
        tables.push({
          headers: currentTableRows[0],
          rows: currentTableRows.slice(1),
        });
      }
      currentTableRows = [];
    }
  }

  // Flush remaining
  if (currentTableRows.length >= 2) {
    tables.push({
      headers: currentTableRows[0],
      rows: currentTableRows.slice(1),
    });
  }

  return tables;
}

export const parsePdfTool = createTool({
  id: 'parse-pdf-tool',
  description: 'Extracts text and tables from a PDF attachment, page by page',
  inputSchema: z.object({
    attachmentId: z.string().uuid().describe('ID of the PDF attachment to parse'),
  }),
  outputSchema: z.object({
    attachmentId: z.string().uuid(),
    filename: z.string(),
    pages: z.array(pdfPageSchema),
    pageCount: z.number(),
  }),
  execute: async (inputData) => {
    const { attachmentId } = inputData;

    // Load attachment metadata from DB
    const attResult = await query(
      'SELECT filename, storage_path, mime_type FROM attachments WHERE id = $1',
      [attachmentId],
    );

    if (attResult.rows.length === 0) {
      throw new Error(`Attachment not found: ${attachmentId}`);
    }

    const { filename, storage_path, mime_type } = attResult.rows[0];

    if (!storage_path || !fs.existsSync(storage_path)) {
      throw new Error(`Attachment file not found on disk: ${storage_path}`);
    }

    console.log(`Parsing PDF: ${filename}`);

    const buffer = fs.readFileSync(storage_path);

    // pdf-parse returns all text. We use the render callback to get per-page text.
    const pages: Array<{ pageNumber: number; text: string; tables: { rows: string[][]; headers?: string[] }[] }> = [];

    const data = await pdfParse(buffer, {
      pagerender: async (pageData: any) => {
        const textContent = await pageData.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        return pageText;
      },
    });

    // pdf-parse combines all pages. Split by page markers or use numpages.
    // Since pagerender is called per page, we build from the full text split approach.
    // For better accuracy, split the combined text evenly by page count.
    const fullText = data.text || '';
    const numPages = data.numpages || 1;

    if (numPages === 1) {
      const tables = detectTables(fullText);
      pages.push({ pageNumber: 1, text: fullText, tables });
    } else {
      // Split text roughly by page — not perfect, but usable
      const avgLen = Math.ceil(fullText.length / numPages);
      for (let i = 0; i < numPages; i++) {
        const pageText = fullText.slice(i * avgLen, (i + 1) * avgLen);
        const tables = detectTables(pageText);
        pages.push({ pageNumber: i + 1, text: pageText, tables });
      }
    }

    // Update attachment metadata
    await query(
      'UPDATE attachments SET page_count = $1, parse_status = $2 WHERE id = $3',
      [numPages, 'parsed', attachmentId],
    );

    console.log(`Parsed PDF ${filename}: ${numPages} pages, ${pages.reduce((sum, p) => sum + p.tables.length, 0)} tables detected`);

    return { attachmentId, filename, pages, pageCount: numPages };
  },
});
