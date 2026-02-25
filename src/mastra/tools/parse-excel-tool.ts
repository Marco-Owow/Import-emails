import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { query } from '../db/client';
import { excelSheetSchema } from '../schemas';

export const parseExcelTool = createTool({
  id: 'parse-excel-tool',
  description: 'Extracts sheets, tables, and cell data from an Excel attachment',
  inputSchema: z.object({
    attachmentId: z.string().uuid().describe('ID of the Excel attachment to parse'),
  }),
  outputSchema: z.object({
    attachmentId: z.string().uuid(),
    filename: z.string(),
    sheets: z.array(excelSheetSchema),
    sheetCount: z.number(),
  }),
  execute: async (inputData) => {
    const { attachmentId } = inputData;

    // Load attachment metadata from DB
    const attResult = await query(
      'SELECT filename, storage_path FROM attachments WHERE id = $1',
      [attachmentId],
    );

    if (attResult.rows.length === 0) {
      throw new Error(`Attachment not found: ${attachmentId}`);
    }

    const { filename, storage_path } = attResult.rows[0];

    if (!storage_path || !fs.existsSync(storage_path)) {
      throw new Error(`Attachment file not found on disk: ${storage_path}`);
    }

    console.log(`Parsing Excel: ${filename}`);

    const buffer = fs.readFileSync(storage_path);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const sheets: Array<{
      name: string;
      tables: Array<{
        range?: string;
        headers: string[];
        rows: Record<string, unknown>[];
      }>;
      cellsSample?: Record<string, unknown>[];
    }> = [];

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;

      // Get used range
      const range = worksheet['!ref'] || '';

      // Convert to JSON (header row becomes keys)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, unknown>[];

      // Extract headers from first row
      const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];

      // Detect if this is a key-value sheet (2 columns, labels in first)
      const isKeyValue = headers.length === 2 && jsonData.length > 0 &&
        jsonData.every(row => typeof row[headers[0]] === 'string');

      // Build table representation
      const tables = [{
        range,
        headers,
        rows: jsonData,
      }];

      // Sample first 5 rows for cells overview
      const cellsSample = jsonData.slice(0, 5);

      sheets.push({ name: sheetName, tables, cellsSample });
    }

    const sheetCount = sheets.length;

    // Update attachment metadata
    await query(
      'UPDATE attachments SET sheet_count = $1, parse_status = $2 WHERE id = $3',
      [sheetCount, 'parsed', attachmentId],
    );

    console.log(`Parsed Excel ${filename}: ${sheetCount} sheets, ${sheets.reduce((sum, s) => sum + s.tables[0].rows.length, 0)} total rows`);

    return { attachmentId, filename, sheets, sheetCount };
  },
});
