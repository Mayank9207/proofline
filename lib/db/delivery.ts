import { randomBytes } from 'node:crypto';
import { db, newId } from './index';
import { calculateSHA256 } from '@/lib/evidence/hash';

const TTL_DAYS = 30;

export type DeliveryLink = { id: string; projectId: string; expiresAt: string };

// Returns the raw token ONCE. Only its hash is persisted; any older active link for the project is revoked.
export function createDeliveryLink(projectId: string): { token: string; link: DeliveryLink } {
  const token = randomBytes(32).toString('base64url');
  const id = newId('dl');
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000).toISOString();
  const conn = db();
  conn.transaction(() => {
    conn.prepare(`UPDATE delivery_links SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id = ? AND revoked_at IS NULL`).run(projectId);
    conn.prepare('INSERT INTO delivery_links (id, project_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(id, projectId, calculateSHA256(token), expiresAt);
  })();
  return { token, link: { id, projectId, expiresAt } };
}

// Validated on every request: hash lookup, not revoked, not expired.
export function resolveDeliveryToken(token: string): DeliveryLink | null {
  if (!token || token.length > 100) return null;
  const r = db().prepare('SELECT id, project_id, expires_at FROM delivery_links WHERE token_hash = ? AND revoked_at IS NULL')
    .get(calculateSHA256(token)) as { id: string; project_id: string; expires_at: string } | undefined;
  if (!r || r.expires_at < new Date().toISOString()) return null;
  return { id: r.id, projectId: r.project_id, expiresAt: r.expires_at };
}
