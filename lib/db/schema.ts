// SQLite schema. Money is stored as integer minor units. Applied idempotently on first connection.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_email TEXT,
  scope TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'agreed' CHECK (status IN
    ('agreed','invoiced','paid','delivered','acknowledged','completed_recorded','closed')),
  paypal_invoice_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  delivery_token_hash TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_ref TEXT,
  provenance_level TEXT NOT NULL CHECK (provenance_level IN ('system_verified','client_confirmed','self_reported')),
  original_filename TEXT,
  mime_type TEXT,
  extracted_facts TEXT,
  quotes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_evidence_project ON evidence_items(project_id);

CREATE TABLE IF NOT EXISTS paypal_events (
  id TEXT PRIMARY KEY,               -- PayPal's event id: UNIQUE by construction, so duplicates are rejected
  event_type TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  raw_body TEXT NOT NULL,
  signature_verified INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT,
  processing_error TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  raw_text TEXT NOT NULL,
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,       -- approval is bound to the exact payload
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','executed','failed')),
  result TEXT,
  proposed_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT,
  executed_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  input TEXT,
  output TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;
