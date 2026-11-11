import { db, newId } from './index';
import { hashPayload } from '@/lib/evidence/hash';

// The audit-trail tables in schema.ts that the app writes besides projects and evidence: PayPal
// webhook events, approved PayPal actions, pasted notices, and the AI answer cache.

/** Store a webhook event once. Returns false when PayPal re-delivered an event already stored. */
export function recordPayPalEvent(e: { id: string; eventType: string; projectId: string | null; rawBody: string; verified: boolean }): boolean {
  return db().prepare(
    `INSERT OR IGNORE INTO paypal_events (id, event_type, project_id, raw_body, signature_verified, processed_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  ).run(e.id, e.eventType, e.projectId, e.rawBody, e.verified ? 1 : 0).changes > 0;
}

/**
 * Record a PayPal write the seller approved, bound to the sha256 of the exact payload sent.
 * The seller approves in the UI before the call, so the row is written with its outcome.
 */
export function recordApproval(a: { projectId: string; actionType: string; payload: unknown; ok: boolean; result: unknown }) {
  db().prepare(
    `INSERT INTO approvals (id, project_id, action_type, payload, payload_sha256, status, result, proposed_by, decided_at, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'seller', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  ).run(
    newId('apr'), a.projectId, a.actionType, JSON.stringify(a.payload), hashPayload(a.payload),
    a.ok ? 'executed' : 'failed', JSON.stringify(a.result ?? null),
  );
}

export function recordNotice(n: { projectId: string | null; rawText: string; category: string | null }) {
  db().prepare('INSERT INTO notices (id, project_id, raw_text, category) VALUES (?, ?, ?, ?)')
    .run(newId('ntc'), n.projectId, n.rawText, n.category);
}

/** A cached AI answer, keyed by the sha256 of task + model + input (see lib/llm.ts). */
export function getAiRun(key: string): string | null {
  const r = db().prepare('SELECT output FROM ai_runs WHERE id = ?').get(key) as { output: string | null } | undefined;
  return r?.output ?? null;
}

export function saveAiRun(r: { key: string; kind: string; model: string; input: string; output: string; projectId?: string | null }) {
  db().prepare('INSERT OR REPLACE INTO ai_runs (id, project_id, kind, input, output, model) VALUES (?, ?, ?, ?, ?, ?)')
    .run(r.key, r.projectId ?? null, r.kind, r.input, r.output, r.model);
}
