import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, closePool } from './client.js';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  console.log('Running Ordermind database migrations...\n');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  const pool = getPool();

  try {
    await pool.query(sql);
    console.log('Migration complete. Tables created:');
    console.log('  Identity & Access: organizations, users, roles, permissions, role_permissions, model_roles, user_order_type_access');
    console.log('  Contacts & Settings: contacts, organization_settings');
    console.log('  Connections: system_connections');
    console.log('  Emails: emails, inbound_emails, outbound_emails, email_attachments');
    console.log('  Order Types: order_types, order_type_schemas, business_rules');
    console.log('  Orders: orders, order_line_item_groups, order_line_items');
    console.log('  Validation & Submissions: order_validations, system_submissions');
    console.log('  Audit: audit_logs');
    console.log('  Internal Mastra: evidence_packs');
    console.log('\nAll indexes created.\n');

    await seed();
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

migrate();
