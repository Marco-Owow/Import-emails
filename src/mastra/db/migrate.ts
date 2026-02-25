import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, closePool } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  console.log('Running ORMI-Ordermind database migrations...\n');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  const pool = getPool();

  try {
    await pool.query(sql);
    console.log('Migration complete. Tables created:');
    console.log('  - messages');
    console.log('  - attachments');
    console.log('  - orders');
    console.log('  - evidence_packs');
    console.log('  - audit_events');
    console.log('\nAll indexes created.');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

migrate();
