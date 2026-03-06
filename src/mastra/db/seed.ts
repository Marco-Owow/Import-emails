/**
 * Seed script for development.
 * Inserts a default organization and the 5 known order types so FK references work.
 * Run with: npx tsx src/mastra/db/seed.ts
 * Also called automatically at the end of db:migrate.
 */

import { randomUUID } from 'crypto';
import { getPool, closePool } from './client.js';
import { orderTypeConfigs } from '../config/order-types.js';

export const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID ?? '00000000-0000-0000-0000-000000000001';

export async function seed() {
  const pool = getPool();

  console.log('Seeding default organization...');

  // Insert default organization (idempotent)
  await pool.query(
    `INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'testing', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_ORG_ID, 'OWOW (dev)', 'owow-dev'],
  );

  console.log(`  organization: ${DEFAULT_ORG_ID} (owow-dev)`);

  // Insert order types from config (idempotent by org + name)
  console.log('Seeding order types...');

  for (const config of orderTypeConfigs) {
    const isActionable = config.orderType !== 'no_action';

    await pool.query(
      `INSERT INTO order_types (id, organization_id, name, description, is_actionable, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        DEFAULT_ORG_ID,
        config.orderType,
        config.description,
        isActionable,
      ],
    );

    console.log(`  order_type: ${config.orderType}`);
  }

  console.log('Seed complete.');
}

// Run directly when invoked as a script
if (import.meta.url === new URL(process.argv[1], 'file:').href ||
    process.argv[1]?.endsWith('seed.ts') ||
    process.argv[1]?.endsWith('seed.js')) {
  seed()
    .catch((err) => {
      console.error('Seed failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    })
    .finally(() => closePool());
}
