/**
 * Migration: add classification columns to orders table.
 * Run with: npx tsx src/mastra/db/migrate-classify.ts
 */
import { getPool, closePool } from './client.js';

const migrations = [
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS sold_to_code TEXT`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_country TEXT`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS flag_reason TEXT`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS match_method TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_orders_sold_to_code ON orders(sold_to_code)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_flag_reason ON orders(flag_reason) WHERE flag_reason IS NOT NULL`,
];

async function migrateClassify() {
  console.log('Running classify-workflow migration...\n');
  const pool = getPool();
  try {
    for (const sql of migrations) {
      await pool.query(sql);
      console.log(`  OK: ${sql.slice(0, 60)}...`);
    }
    console.log('\nMigration complete.');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

migrateClassify();
