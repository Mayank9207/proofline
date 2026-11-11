// Proofline's evidence ledger: one SQLite file through Node's built-in `node:sqlite` (Node 24),
// so there is no native module to install. Server-side only.
//
// The database is created and seeded on first use. Seeded rows are marked `seeded = 1` and the UI
// labels them as sample data; everything created through the app or PayPal is real.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { seed } from './seed';

const DB_PATH = process.env.PROOFLINE_DB ?? path.join(process.cwd(), 'data', 'proofline.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  scope TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'agreed',
  paypal_order_id TEXT,
  paypal_capture_id TEXT,
  paid_at TEXT,
  delivered_at TEXT,
  delivery_token TEXT UNIQUE,
  created_at TEXT NOT NULL,
  seeded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  source TEXT NOT NULL,
  provenance TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  facts TEXT,
  seeded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS evidence_project ON evidence(project_id);
CREATE TABLE IF NOT EXISTS paypal_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  verified INTEGER NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  text TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_runs (
  input_sha256 TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  output TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number };
  if (n === 0) seed(db);
  return db;
}

export const now = () => new Date().toISOString();

export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
