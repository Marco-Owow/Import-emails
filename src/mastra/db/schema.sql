-- ORMI-Ordermind: custom tables for order management
-- Mastra's own tables (workflow snapshots, evals, etc.) are auto-created by PostgresStore.

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  external_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT[] NOT NULL DEFAULT '{}',
  cc TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  body_type TEXT NOT NULL DEFAULT 'text' CHECK (body_type IN ('html', 'text')),
  thread_id TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  content_hash TEXT NOT NULL,
  raw_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (content_hash)
);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  page_count INTEGER,
  sheet_count INTEGER,
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'parsed', 'error')),
  parse_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','parsing','parsed','classifying','classified',
                      'extracting','extracted','validating','validated',
                      'review','approved','submitted','error','flagged')),
  order_type TEXT,
  client_id TEXT,
  evidence_pack_id UUID,
  extracted_fields JSONB,
  validation_results JSONB,
  user_edits JSONB,
  erp_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evidence_packs (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_content_hash ON messages(content_hash);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox ON messages(mailbox);
CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_orders_message_id ON orders(message_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_evidence_packs_order_id ON evidence_packs(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_order_id ON audit_events(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type);
