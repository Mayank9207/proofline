import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema';

// The ONLY file that knows we use SQLite. Everything else goes through lib/db/projects.ts and
// lib/db/evidence.ts, so swapping to Postgres later means rewriting those, not every API route.
export const DATA_DIR = process.env.PROOFLINE_DATA_DIR ?? path.join(process.cwd(), 'data');

const globalForDb = globalThis as unknown as { __prooflineDb?: Database.Database };

export function db(): Database.Database {
  if (!globalForDb.__prooflineDb) {
    mkdirSync(DATA_DIR, { recursive: true });
    const conn = new Database(path.join(DATA_DIR, 'proofline.db'));
    conn.pragma('journal_mode = WAL');
    conn.pragma('foreign_keys = ON');
    conn.exec(SCHEMA);
    globalForDb.__prooflineDb = conn;
  }
  return globalForDb.__prooflineDb;
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
