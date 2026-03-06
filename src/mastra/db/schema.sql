-- Ordermind Database Schema
-- AI-Powered Order Processing Platform
--
-- Design decisions:
--   - PostgreSQL with JSONB for client-specific flexible fields
--   - Fixed SQL columns for structural/shared fields (status, timestamps, FKs)
--   - JSONB for client/order-type-specific extracted data and line items
--   - Polymorphic RBAC following Laravel conventions (model_roles)
--   - Mastra AI framework for workflow orchestration (evidence_packs kept as internal table)
--   - Class table inheritance for emails: emails (base) + inbound_emails / outbound_emails
--   - Audit trail as first-class entity for traceability + future AI training
--
-- Mastra's own tables (workflow snapshots, evals, etc.) are auto-created by PostgresStore.

-- ============================================================
-- Identity & Access
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  slug VARCHAR NOT NULL UNIQUE,
  status VARCHAR NOT NULL DEFAULT 'onboarding'
    CHECK (status IN ('onboarding', 'testing', 'live', 'churned')),
  go_live_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email VARCHAR NOT NULL UNIQUE,
  first_name VARCHAR NOT NULL,
  last_name VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Named roles scoped per organization. null organization_id = system-wide (e.g. super_admin).
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  name VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Polymorphic pivot: assigns a role to any model (users, user_order_type_access, etc.)
CREATE TABLE IF NOT EXISTS model_roles (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  model_type VARCHAR NOT NULL,
  model_id UUID NOT NULL,
  PRIMARY KEY (role_id, model_type, model_id)
);

-- Scopes a user's access to specific order types within their organization
CREATE TABLE IF NOT EXISTS user_order_type_access (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_type_id UUID NOT NULL -- FK to order_types added after that table is created
);


-- ============================================================
-- Contacts (Customers of Organizations)
-- ============================================================

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  external_id VARCHAR,                   -- ERP customer reference number
  email VARCHAR,
  name VARCHAR NOT NULL,
  company_name VARCHAR,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Organization Settings
-- ============================================================

CREATE TABLE IF NOT EXISTS organization_settings (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id),

  -- Subscription & Billing
  tier VARCHAR NOT NULL DEFAULT 'starter'
    CHECK (tier IN ('starter', 'standard', 'enterprise')),
  monthly_order_limit INTEGER,
  monthly_license_fee DECIMAL(10,2),
  sla_level VARCHAR NOT NULL DEFAULT 'basis'
    CHECK (sla_level IN ('basis', 'standard', 'premium')),
  contract_start_date DATE,
  contract_end_date DATE,

  -- Pipeline Configuration
  classification_strategy VARCHAR NOT NULL DEFAULT 'ai'
    CHECK (classification_strategy IN ('ai', 'folder_based', 'hybrid')),
  customer_identification_strategy VARCHAR NOT NULL DEFAULT 'domain'
    CHECK (customer_identification_strategy IN ('domain', 'llm', 'hybrid')),
  processing_delay_seconds INTEGER NOT NULL DEFAULT 0,
  default_language VARCHAR NOT NULL DEFAULT 'nl',
  timezone VARCHAR NOT NULL DEFAULT 'Europe/Brussels',

  -- Approval & Routing
  auto_approve_on_pass BOOLEAN NOT NULL DEFAULT false,
  combine_exception_emails BOOLEAN NOT NULL DEFAULT false,

  -- Flexible Config
  features JSONB,
  config JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- System Integration Configuration
-- ============================================================

CREATE TABLE IF NOT EXISTS system_connections (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  type VARCHAR NOT NULL
    CHECK (type IN ('outlook', 'sap', 'navision', 'ols', 'wms', 'print', 'edi_mailbox')),
  name VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'error', 'disabled')),
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Email Communication (Class Table Inheritance)
-- ============================================================

-- Base email entity for unified thread indexing.
-- All emails (inbound and outbound) share this table.
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY,
  type VARCHAR NOT NULL CHECK (type IN ('inbound', 'outbound')),
  order_id UUID,                         -- FK to orders added after that table is created
  system_connection_id UUID REFERENCES system_connections(id),
  thread_id VARCHAR,                     -- Outlook conversationId
  subject VARCHAR NOT NULL DEFAULT '',
  external_id VARCHAR,                   -- Provider message ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Detail table for received emails (1:1 with emails)
CREATE TABLE IF NOT EXISTS inbound_emails (
  id UUID PRIMARY KEY,
  email_id UUID NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
  folder_id VARCHAR,                     -- Outlook folder ID (folder-based classification)
  sender VARCHAR NOT NULL,
  body_html TEXT,
  body_markdown TEXT,                    -- Converted for LLM processing
  received_at TIMESTAMPTZ NOT NULL
);

-- Detail table for system-generated outbound emails (1:1 with emails)
CREATE TABLE IF NOT EXISTS outbound_emails (
  id UUID PRIMARY KEY,
  email_id UUID NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
  order_validation_id UUID,              -- FK to order_validations added after that table
  recipient VARCHAR NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent', 'cancelled')),
  approved_by_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);

-- Files attached to emails (inbound or outbound)
CREATE TABLE IF NOT EXISTS email_attachments (
  id UUID PRIMARY KEY,
  email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  file_name VARCHAR NOT NULL,
  mime_type VARCHAR NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  storage_path VARCHAR NOT NULL,
  -- Internal Mastra processing fields (pipeline state tracking)
  content_hash VARCHAR,
  page_count INTEGER,
  sheet_count INTEGER,
  parse_status VARCHAR NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsed', 'error')),
  parse_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Order Type Configuration
-- ============================================================

CREATE TABLE IF NOT EXISTS order_types (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR NOT NULL,
  description TEXT,
  classification_hint TEXT,             -- Description/prompt for LLM classification
  is_actionable BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from user_order_type_access now that order_types exists
ALTER TABLE user_order_type_access
  DROP CONSTRAINT IF EXISTS user_order_type_access_order_type_id_fkey;
ALTER TABLE user_order_type_access
  ADD CONSTRAINT user_order_type_access_order_type_id_fkey
  FOREIGN KEY (order_type_id) REFERENCES order_types(id);

-- Schema per order type — versioned so schema changes don't break existing orders
CREATE TABLE IF NOT EXISTS order_type_schemas (
  id UUID PRIMARY KEY,
  order_type_id UUID NOT NULL REFERENCES order_types(id),
  version INTEGER NOT NULL DEFAULT 1,
  header_fields JSONB NOT NULL DEFAULT '[]',
  line_item_fields JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deterministic validation rules per order type
CREATE TABLE IF NOT EXISTS business_rules (
  id UUID PRIMARY KEY,
  order_type_id UUID NOT NULL REFERENCES order_types(id),
  name VARCHAR NOT NULL,
  type VARCHAR NOT NULL CHECK (type IN (
    'required_field', 'threshold', 'duplicate_check', 'calculated_field',
    'lookup_validation', 'multi_field_comparison', 'date_calculation', 'conditional_flag'
  )),
  config JSONB NOT NULL DEFAULT '{}',
  severity VARCHAR NOT NULL CHECK (severity IN ('blocking', 'warning')),
  "order" INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Order Processing
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  trigger_email_id UUID NOT NULL REFERENCES emails(id),
  order_type_id UUID REFERENCES order_types(id),
  order_type_schema_id UUID REFERENCES order_type_schemas(id),
  contact_id UUID REFERENCES contacts(id),

  -- DB-persisted stable checkpoints only. Intermediate processing states
  -- (e.g. parsing, classifying, extracting) are tracked by Mastra's workflow engine.
  status VARCHAR NOT NULL DEFAULT 'ingested'
    CHECK (status IN ('ingested', 'classified', 'extracted', 'pending_review',
                      'approved', 'rejected', 'pushed', 'failed')),

  classification_source VARCHAR
    CHECK (classification_source IN ('automatic', 'manual_folder', 'manual_override')),
  classification_confidence NUMERIC(3,2),

  extracted_data JSONB,                 -- Header-level extracted fields as key-value pairs
  assigned_to_id UUID REFERENCES users(id),
  approved_by_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  system_reference_id VARCHAR,          -- Reference returned from ERP after successful push

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add deferred FK from emails.order_id to orders
ALTER TABLE emails
  DROP CONSTRAINT IF EXISTS emails_order_id_fkey;
ALTER TABLE emails
  ADD CONSTRAINT emails_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES orders(id);

-- Grouping of line items within an order
CREATE TABLE IF NOT EXISTS order_line_item_groups (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL DEFAULT 'Products',
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Individual line items within a group
CREATE TABLE IF NOT EXISTS order_line_items (
  id UUID PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES order_line_item_groups(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Validation
-- ============================================================

CREATE TABLE IF NOT EXISTS order_validations (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  business_rule_id UUID NOT NULL REFERENCES business_rules(id),
  status VARCHAR NOT NULL CHECK (status IN ('passed', 'failed')),
  severity VARCHAR NOT NULL CHECK (severity IN ('blocking', 'warning')),
  message TEXT,
  assignee_id UUID REFERENCES users(id),
  assignee_role VARCHAR,
  resolved_by_id UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add deferred FK from outbound_emails.order_validation_id
ALTER TABLE outbound_emails
  DROP CONSTRAINT IF EXISTS outbound_emails_order_validation_id_fkey;
ALTER TABLE outbound_emails
  ADD CONSTRAINT outbound_emails_order_validation_id_fkey
  FOREIGN KEY (order_validation_id) REFERENCES order_validations(id);


-- ============================================================
-- System Submissions (Audit Log of External Calls)
-- ============================================================

CREATE TABLE IF NOT EXISTS system_submissions (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  system_connection_id UUID NOT NULL REFERENCES system_connections(id),
  idempotency_key VARCHAR NOT NULL UNIQUE,
  status VARCHAR NOT NULL CHECK (status IN ('success', 'failed')),
  request JSONB,
  response JSONB,
  reference_id VARCHAR,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Audit Trail
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),   -- null for system-triggered actions
  action VARCHAR NOT NULL CHECK (action IN (
    'field_edit', 'line_item_edit', 'status_change', 'classification_override',
    'approval', 'rejection', 'assignment', 'validation_resolve'
  )),
  field_path VARCHAR,                  -- e.g. 'extractedData.quantity', 'lineItems.0.data.price'
  old_value TEXT,
  new_value TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Internal Mastra Processing Table (not in target schema spec)
-- Stores assembled Evidence Packs used by extraction steps.
-- ============================================================

CREATE TABLE IF NOT EXISTS evidence_packs (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_organization_id ON contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_external_id ON contacts(organization_id, external_id);
CREATE INDEX IF NOT EXISTS idx_system_connections_org ON system_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_emails_order_id ON emails(order_id);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_email_id ON inbound_emails(email_id);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_sender ON inbound_emails(sender);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_received_at ON inbound_emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_attachments_email_id ON email_attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_content_hash ON email_attachments(content_hash);
CREATE INDEX IF NOT EXISTS idx_order_types_org ON order_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_orders_organization_id ON orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_orders_trigger_email_id ON orders(trigger_email_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_type_id ON orders(order_type_id);
CREATE INDEX IF NOT EXISTS idx_order_line_item_groups_order_id ON order_line_item_groups(order_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_group_id ON order_line_items(group_id);
CREATE INDEX IF NOT EXISTS idx_order_validations_order_id ON order_validations(order_id);
CREATE INDEX IF NOT EXISTS idx_system_submissions_order_id ON system_submissions(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_order_id ON audit_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_evidence_packs_order_id ON evidence_packs(order_id);
