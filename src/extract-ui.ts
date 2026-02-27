import 'dotenv/config';
import http from 'http';
import { read, utils } from 'xlsx';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { extractionAgent } from './mastra/agents/extraction-agent';
import { extractionResultSchema } from './mastra/schemas/extraction-config';
import { orderTypeConfigs, getOrderTypeConfig } from './mastra/config/order-types';

const PORT = 3456;

// ── Parsing functions ──────────────────────────────────────────────

function parseExcelBuffer(buffer: Buffer, filename: string) {
  const workbook = read(buffer, { type: 'buffer' });
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = utils.sheet_to_json<Record<string, unknown>>(sheet);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { name, headers, rows: rows.slice(0, 200) };
  });
  return { type: 'excel' as const, filename, sheets };
}

function detectTables(text: string): { rows: string[][]; headers?: string[] }[] {
  const lines = text.split('\n').filter((l) => l.trim());
  const tables: { rows: string[][]; headers?: string[] }[] = [];
  let currentTableRows: string[][] = [];
  for (const line of lines) {
    const cells = line.split(/\t+|\s{3,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      currentTableRows.push(cells);
    } else {
      if (currentTableRows.length >= 2) {
        tables.push({ headers: currentTableRows[0], rows: currentTableRows.slice(1) });
      }
      currentTableRows = [];
    }
  }
  if (currentTableRows.length >= 2) {
    tables.push({ headers: currentTableRows[0], rows: currentTableRows.slice(1) });
  }
  return tables;
}

async function parsePdfBuffer(buffer: Buffer, filename: string) {
  const data = await pdfParse(buffer);
  const fullText: string = data.text || '';
  const numPages: number = data.numpages || 1;
  const pages: { pageNumber: number; text: string; tables: { rows: string[][]; headers?: string[] }[] }[] = [];
  if (numPages === 1) {
    pages.push({ pageNumber: 1, text: fullText, tables: detectTables(fullText) });
  } else {
    const avgLen = Math.ceil(fullText.length / numPages);
    for (let i = 0; i < numPages; i++) {
      const pageText = fullText.slice(i * avgLen, (i + 1) * avgLen);
      pages.push({ pageNumber: i + 1, text: pageText, tables: detectTables(pageText) });
    }
  }
  return { type: 'pdf' as const, filename, pages, pageCount: numPages };
}

function isExcel(filename: string): boolean {
  return /\.(xlsx|xls)$/i.test(filename);
}

function isPdf(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

// ── Evidence formatting for LLM ────────────────────────────────────

function formatExcelEvidence(parsed: ReturnType<typeof parseExcelBuffer>): string {
  const parts: string[] = [`=== EXCEL: ${parsed.filename} ===`];
  for (const sheet of parsed.sheets) {
    parts.push(`[Sheet: ${sheet.name}]`);
    parts.push(`  Headers: ${sheet.headers.join(' | ')}`);
    sheet.rows.slice(0, 50).forEach((row) => {
      const vals = sheet.headers.map((h) => `${h}: ${row[h] ?? ''}`);
      parts.push(`  ${vals.join(' | ')}`);
    });
    parts.push('');
  }
  return parts.join('\n');
}

function formatPdfEvidence(parsed: Awaited<ReturnType<typeof parsePdfBuffer>>): string {
  const parts: string[] = [`=== PDF: ${parsed.filename} (${parsed.pageCount} pages) ===`];
  for (const page of parsed.pages) {
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
  return parts.join('\n');
}

// ── HTML UI ────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ORMI-Ordermind</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #f5f5f5; color: #333; padding: 2rem; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .subtitle { color: #666; margin-bottom: 1.5rem; font-size: 0.9rem; }
  .tabs { display: flex; gap: 0; margin-bottom: 1.5rem; }
  .tab { padding: 0.7rem 1.5rem; background: #e5e5e5; border: none; cursor: pointer;
         font-size: 0.95rem; font-weight: 600; color: #666; transition: all 0.15s; }
  .tab:first-child { border-radius: 8px 0 0 8px; }
  .tab:last-child { border-radius: 0 8px 8px 0; }
  .tab.active { background: #4f46e5; color: #fff; }
  .card { background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
  label { font-weight: 600; display: block; margin-bottom: 0.5rem; font-size: 0.9rem; }
  select { width: 100%; padding: 0.6rem; border: 1px solid #ddd; border-radius: 8px; font-size: 0.95rem; margin-bottom: 1rem; }
  .drop-zone { border: 2px dashed #ccc; border-radius: 12px; padding: 2rem; text-align: center;
               cursor: pointer; transition: all 0.2s; margin-bottom: 1rem; }
  .drop-zone:hover, .drop-zone.dragover { border-color: #4f46e5; background: #f0f0ff; }
  .drop-zone.has-file { border-color: #22c55e; background: #f0fdf4; }
  .drop-zone p { color: #888; font-size: 0.9rem; }
  .drop-zone .filename { color: #22c55e; font-weight: 600; font-size: 1rem; }
  input[type=file] { display: none; }
  button.action { background: #4f46e5; color: #fff; border: none; padding: 0.8rem 2rem; border-radius: 8px;
           font-size: 1rem; cursor: pointer; width: 100%; font-weight: 600; transition: background 0.2s; }
  button.action:hover { background: #4338ca; }
  button.action:disabled { background: #aaa; cursor: not-allowed; }
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #fff;
             border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite;
             vertical-align: middle; margin-right: 0.5rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hidden { display: none; }
  .result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .confidence-badge { background: #f0f0ff; color: #4f46e5; padding: 0.3rem 0.8rem; border-radius: 20px;
                      font-weight: 600; font-size: 0.85rem; }
  .field-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 0.8rem 0;
               border-bottom: 1px solid #f0f0f0; }
  .field-row:last-child { border-bottom: none; }
  .field-key { font-weight: 600; color: #555; min-width: 160px; font-size: 0.9rem; }
  .field-value { flex: 1; word-break: break-word; }
  .field-value pre { background: #f8f8f8; padding: 0.5rem; border-radius: 6px; font-size: 0.8rem;
                     overflow-x: auto; white-space: pre-wrap; }
  .field-conf { min-width: 60px; text-align: right; font-size: 0.8rem; color: #888; }
  .field-ref { font-size: 0.75rem; color: #999; margin-top: 0.2rem; }
  .error { background: #fef2f2; color: #dc2626; padding: 1rem; border-radius: 8px; }
  .token-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-top: 1rem; }
  .token-panel h3 { font-size: 0.85rem; color: #64748b; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .token-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
  .token-item { text-align: center; }
  .token-item .num { font-size: 1.4rem; font-weight: 700; color: #1e293b; }
  .token-item .lbl { font-size: 0.75rem; color: #94a3b8; margin-top: 0.15rem; }
  .json-output { background: #1e293b; color: #e2e8f0; border-radius: 8px; padding: 1rem;
                 font-family: 'SF Mono', Monaco, monospace; font-size: 0.8rem;
                 overflow-x: auto; white-space: pre-wrap; max-height: 500px; overflow-y: auto; }
</style>
</head>
<body>
  <h1>ORMI-Ordermind</h1>
  <p class="subtitle">Upload Excel or PDF files to parse or extract structured data</p>

  <div class="tabs">
    <button class="tab active" data-tab="parse">Parse Only</button>
    <button class="tab" data-tab="extract">LLM Extract</button>
  </div>

  <!-- PARSE TAB -->
  <div id="tab-parse">
    <div class="card">
      <label>File (Excel or PDF)</label>
      <div class="drop-zone" id="parseDrop">
        <p>Drag &amp; drop .xlsx / .xls / .pdf here, or click to browse</p>
      </div>
      <input type="file" id="parseFileInput" accept=".xlsx,.xls,.pdf">
      <button class="action" id="parseBtn" disabled>Parse to JSON</button>
    </div>
    <div id="parseResults" class="card hidden">
      <h2 style="margin-bottom:1rem">Parsed Output</h2>
      <div class="json-output" id="parseJson"></div>
    </div>
  </div>

  <!-- EXTRACT TAB -->
  <div id="tab-extract" class="hidden">
    <div class="card">
      <label for="orderType">Order Type</label>
      <select id="orderType"></select>
      <label>File (Excel or PDF)</label>
      <div class="drop-zone" id="extractDrop">
        <p>Drag &amp; drop .xlsx / .xls / .pdf here, or click to browse</p>
      </div>
      <input type="file" id="extractFileInput" accept=".xlsx,.xls,.pdf">
      <button class="action" id="extractBtn" disabled>Extract Fields</button>
    </div>
    <div id="extractResults" class="card hidden">
      <div class="result-header">
        <h2>Extracted Fields</h2>
        <span class="confidence-badge" id="overallConf"></span>
      </div>
      <div id="fieldsList"></div>
      <div class="token-panel" id="tokenPanel">
        <h3>Token Usage</h3>
        <div class="token-grid">
          <div class="token-item"><div class="num" id="tokInput">-</div><div class="lbl">Input</div></div>
          <div class="token-item"><div class="num" id="tokOutput">-</div><div class="lbl">Output</div></div>
          <div class="token-item"><div class="num" id="tokTotal">-</div><div class="lbl">Total</div></div>
        </div>
      </div>
    </div>
  </div>

  <div id="errorBox" class="card error hidden"></div>

<script>
  // ── Tab switching ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('tab-parse').classList.toggle('hidden', target !== 'parse');
      document.getElementById('tab-extract').classList.toggle('hidden', target !== 'extract');
      document.getElementById('errorBox').classList.add('hidden');
    });
  });

  // ── Order types dropdown ──
  const orderTypes = ${JSON.stringify(orderTypeConfigs.map((c) => ({ value: c.orderType, label: c.label, description: c.description })))};
  const sel = document.getElementById('orderType');
  orderTypes.forEach(t => { const o = document.createElement('option'); o.value = t.value; o.textContent = t.label + ' — ' + t.description; sel.appendChild(o); });

  // ── Shared file handling ──
  function setupDropZone(dropId, inputId, btnId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    let file = null;
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragover'); if (e.dataTransfer.files.length) set(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files.length) set(input.files[0]); });
    function set(f) {
      file = f;
      drop.innerHTML = '<p class="filename">' + f.name + '</p><p style="margin-top:0.5rem;color:#888">' + (f.size/1024).toFixed(1) + ' KB — click to change</p>';
      drop.classList.add('has-file');
      btn.disabled = false;
    }
    return () => file;
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function showError(msg) {
    const box = document.getElementById('errorBox');
    box.textContent = msg;
    box.classList.remove('hidden');
  }

  // ── Parse tab ──
  const getParseFile = setupDropZone('parseDrop', 'parseFileInput', 'parseBtn');
  document.getElementById('parseBtn').addEventListener('click', async () => {
    const file = getParseFile();
    if (!file) return;
    const btn = document.getElementById('parseBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Parsing...';
    document.getElementById('parseResults').classList.add('hidden');
    document.getElementById('errorBox').classList.add('hidden');
    try {
      const base64 = await toBase64(file);
      const res = await fetch('/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: base64, filename: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed');
      document.getElementById('parseResults').classList.remove('hidden');
      document.getElementById('parseJson').textContent = JSON.stringify(data, null, 2);
    } catch (err) { showError(err.message); }
    finally { btn.disabled = false; btn.textContent = 'Parse to JSON'; }
  });

  // ── Extract tab ──
  const getExtractFile = setupDropZone('extractDrop', 'extractFileInput', 'extractBtn');
  document.getElementById('extractBtn').addEventListener('click', async () => {
    const file = getExtractFile();
    if (!file) return;
    const btn = document.getElementById('extractBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Extracting...';
    document.getElementById('extractResults').classList.add('hidden');
    document.getElementById('errorBox').classList.add('hidden');
    try {
      const base64 = await toBase64(file);
      const res = await fetch('/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: base64, filename: file.name, orderType: sel.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extraction failed');
      renderExtractResults(data);
    } catch (err) { showError(err.message); }
    finally { btn.disabled = false; btn.textContent = 'Extract Fields'; }
  });

  function renderExtractResults(data) {
    document.getElementById('extractResults').classList.remove('hidden');
    document.getElementById('overallConf').textContent = 'Confidence: ' + (data.overallConfidence * 100).toFixed(0) + '%';

    const list = document.getElementById('fieldsList');
    list.innerHTML = '';
    data.fields.forEach(f => {
      const val = typeof f.value === 'object' ? JSON.stringify(f.value, null, 2) : String(f.value ?? 'null');
      const isObj = typeof f.value === 'object' && f.value !== null;
      list.innerHTML += '<div class="field-row">'
        + '<div class="field-key">' + f.key + '</div>'
        + '<div class="field-value">' + (isObj ? '<pre>' + val + '</pre>' : val)
        + (f.evidenceRef ? '<div class="field-ref">' + f.evidenceRef + '</div>' : '')
        + '</div>'
        + '<div class="field-conf">' + (f.confidence * 100).toFixed(0) + '%</div>'
        + '</div>';
    });

    // Token usage
    const tu = data.tokenUsage;
    if (tu) {
      document.getElementById('tokInput').textContent = (tu.inputTokens ?? 0).toLocaleString();
      document.getElementById('tokOutput').textContent = (tu.outputTokens ?? 0).toLocaleString();
      document.getElementById('tokTotal').textContent = (tu.totalTokens ?? 0).toLocaleString();
    }
  }
</script>
</body>
</html>`;

// ── HTTP Server ────────────────────────────────────────────────────

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

async function parseFile(file: string, filename: string) {
  const buffer = Buffer.from(file, 'base64');
  if (isExcel(filename)) {
    return parseExcelBuffer(buffer, filename);
  } else if (isPdf(filename)) {
    return await parsePdfBuffer(buffer, filename);
  } else {
    throw new Error(`Unsupported file type: ${filename}. Use .xlsx, .xls, or .pdf`);
  }
}

function formatEvidence(parsed: any): string {
  if (parsed.type === 'excel') return formatExcelEvidence(parsed);
  if (parsed.type === 'pdf') return formatPdfEvidence(parsed);
  throw new Error('Unknown parsed type');
}

const server = http.createServer(async (req, res) => {
  // Serve UI
  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
    return;
  }

  // Route 1: Parse only (no LLM)
  if (req.method === 'POST' && req.url === '/parse') {
    try {
      const { file, filename } = JSON.parse(await readBody(req));
      if (!file || !filename) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing file or filename' }));
        return;
      }
      console.log(`[Parse] ${filename}`);
      const parsed = await parseFile(file, filename);
      console.log(`[Parse] Done: ${parsed.type} — ${parsed.type === 'excel' ? parsed.sheets.length + ' sheets' : parsed.pageCount + ' pages'}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(parsed));
    } catch (err: any) {
      console.error('[Parse] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Route 2: LLM Extract (parse + GPT-4o + token audit)
  if (req.method === 'POST' && req.url === '/extract') {
    try {
      const { file, filename, orderType } = JSON.parse(await readBody(req));
      if (!file || !filename) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing file or filename' }));
        return;
      }
      const config = getOrderTypeConfig(orderType);
      if (!config) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Unknown order type: ${orderType}` }));
        return;
      }

      console.log(`[Extract] ${filename} as ${orderType}`);

      // Parse
      const parsed = await parseFile(file, filename);
      const evidenceText = formatEvidence(parsed);

      // Build prompt
      const fieldsText = config.fields
        .map((f) => {
          let line = `- ${f.key} (${f.label}): [${f.type}] ${f.required ? 'REQUIRED' : 'optional'} — ${f.description}`;
          if (f.examples && f.examples.length > 0) line += ` Examples: ${f.examples.join(', ')}`;
          return line;
        })
        .join('\n');

      const prompt = `Extract the following fields from this ${config.label} evidence.

## Fields to Extract
${fieldsText}

## Evidence
${evidenceText}

Return a JSON object with:
- orderType: "${orderType}"
- fields: array of { key, value, confidence, evidenceRef } for each field above
- overallConfidence: weighted average of field confidences`;

      // Call LLM
      const response = await extractionAgent.generate(prompt, {
        output: extractionResultSchema,
      });

      // Extract result
      const result = response.object;
      if (!result) {
        throw new Error('Agent returned no structured output. Response text: ' + (response.text || '').slice(0, 300));
      }

      // Token usage audit
      const tokenUsage = {
        inputTokens: response.usage?.inputTokens ?? null,
        outputTokens: response.usage?.outputTokens ?? null,
        totalTokens: response.usage?.totalTokens ?? null,
        reasoningTokens: (response.usage as any)?.reasoningTokens ?? null,
        cachedInputTokens: (response.usage as any)?.cachedInputTokens ?? null,
      };

      console.log(`[Extract] Done: ${result.fields.length} fields, confidence ${result.overallConfidence.toFixed(2)}`);
      console.log(`[Extract] Tokens: input=${tokenUsage.inputTokens} output=${tokenUsage.outputTokens} total=${tokenUsage.totalTokens}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, tokenUsage }));
    } catch (err: any) {
      console.error('[Extract] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\nORMI-Ordermind Extract UI ready at http://localhost:${PORT}`);
  console.log(`  Route 1: POST /parse    — Parse Excel/PDF to JSON (no LLM)`);
  console.log(`  Route 2: POST /extract  — Parse + LLM extraction with token audit\n`);
});
