import 'dotenv/config';
import http from 'http';
import { readFileSync } from 'fs';
import { read, utils } from 'xlsx';
import { extractionAgent } from './mastra/agents/extraction-agent';
import { extractionResultSchema } from './mastra/schemas/extraction-config';
import { orderTypeConfigs, getOrderTypeConfig } from './mastra/config/order-types';

const PORT = 3456;

function parseExcelBuffer(buffer: Buffer, filename: string) {
  const workbook = read(buffer, { type: 'buffer' });
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = utils.sheet_to_json<Record<string, unknown>>(sheet);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return {
      name,
      tables: [{ headers, rows: rows.slice(0, 200) }],
    };
  });
  return {
    filename,
    sheets,
  };
}

function formatEvidenceText(excel: ReturnType<typeof parseExcelBuffer>): string {
  const parts: string[] = [`=== EXCEL: ${excel.filename} ===`];
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
  return parts.join('\n');
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ORMI-Ordermind — Extract Fields</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #f5f5f5; color: #333; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  .subtitle { color: #666; margin-bottom: 2rem; font-size: 0.9rem; }
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
  button { background: #4f46e5; color: #fff; border: none; padding: 0.8rem 2rem; border-radius: 8px;
           font-size: 1rem; cursor: pointer; width: 100%; font-weight: 600; transition: background 0.2s; }
  button:hover { background: #4338ca; }
  button:disabled { background: #aaa; cursor: not-allowed; }
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #fff;
             border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite;
             vertical-align: middle; margin-right: 0.5rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #results { display: none; }
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
</style>
</head>
<body>
  <h1>ORMI-Ordermind</h1>
  <p class="subtitle">Upload an Excel file to extract structured order fields using AI</p>

  <div class="card">
    <label for="orderType">Order Type</label>
    <select id="orderType"></select>

    <label>Excel File</label>
    <div class="drop-zone" id="dropZone">
      <p>Drag &amp; drop an .xlsx / .xls file here, or click to browse</p>
    </div>
    <input type="file" id="fileInput" accept=".xlsx,.xls">

    <button id="extractBtn" disabled>Extract Fields</button>
  </div>

  <div id="results" class="card">
    <div class="result-header">
      <h2>Extracted Fields</h2>
      <span class="confidence-badge" id="overallConf"></span>
    </div>
    <div id="fieldsList"></div>
  </div>

  <div id="errorBox" class="card error" style="display:none"></div>

<script>
  const orderTypes = ${JSON.stringify(orderTypeConfigs.map((c) => ({ value: c.orderType, label: c.label, description: c.description })))};
  const sel = document.getElementById('orderType');
  orderTypes.forEach(t => { const o = document.createElement('option'); o.value = t.value; o.textContent = t.label + ' — ' + t.description; sel.appendChild(o); });

  let selectedFile = null;
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const extractBtn = document.getElementById('extractBtn');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

  function handleFile(file) {
    selectedFile = file;
    dropZone.innerHTML = '<p class="filename">' + file.name + '</p><p style="margin-top:0.5rem;color:#888">Click to change</p>';
    dropZone.classList.add('has-file');
    extractBtn.disabled = false;
  }

  extractBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    extractBtn.disabled = true;
    extractBtn.innerHTML = '<span class="spinner"></span>Extracting...';
    document.getElementById('results').style.display = 'none';
    document.getElementById('errorBox').style.display = 'none';

    try {
      const base64 = await toBase64(selectedFile);
      const res = await fetch('/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: base64, filename: selectedFile.name, orderType: sel.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extraction failed');
      renderResults(data);
    } catch (err) {
      document.getElementById('errorBox').style.display = 'block';
      document.getElementById('errorBox').textContent = err.message;
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract Fields';
    }
  });

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function renderResults(data) {
    document.getElementById('results').style.display = 'block';
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
  }
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
    return;
  }

  if (req.method === 'POST' && req.url === '/extract') {
    let body = '';
    for await (const chunk of req) body += chunk;

    try {
      const { file, filename, orderType } = JSON.parse(body);

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

      console.log(`Extracting fields from ${filename} as ${orderType}...`);

      // Parse Excel
      const buffer = Buffer.from(file, 'base64');
      const excel = parseExcelBuffer(buffer, filename);

      // Build prompt
      const evidenceText = formatEvidenceText(excel);
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
- overallConfidence: weighted average of field confidences

Respond ONLY with valid JSON matching the extractionResult schema.`;

      const response = await extractionAgent.generate(prompt, {
        output: extractionResultSchema,
      });

      console.log('Response keys:', Object.keys(response));
      console.log('Response.object:', response.object);
      console.log('Response.text:', typeof response.text === 'string' ? response.text.slice(0, 200) : response.text);

      const result = response.object ?? (response as any).parsed;
      if (!result) {
        throw new Error('Agent returned no structured output. Raw text: ' + (response.text || '').slice(0, 500));
      }
      console.log(`Extracted ${result.fields.length} fields (confidence: ${result.overallConfidence.toFixed(2)})`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      console.error('Extraction error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Internal error' }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\nORMI-Ordermind Extract UI ready at http://localhost:${PORT}\n`);
});
