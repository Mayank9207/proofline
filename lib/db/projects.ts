import { db, newId } from './index';
import type { Project, ProjectStatus } from '@/lib/evidence/types';

type Row = {
  id: string; client_name: string; client_email: string | null; scope: string; amount: number;
  currency: string; status: ProjectStatus; paypal_invoice_id: string | null; paypal_capture_id: string | null;
  created_at: string; updated_at: string;
};

const toProject = (r: Row): Project => ({
  id: r.id, clientName: r.client_name, clientEmail: r.client_email, scope: r.scope, amount: r.amount,
  currency: r.currency, status: r.status, paypalInvoiceId: r.paypal_invoice_id,
  paypalCaptureId: r.paypal_capture_id, createdAt: r.created_at, updatedAt: r.updated_at,
});

export type NewProject = {
  id?: string; clientName: string; clientEmail?: string | null; scope: string; amount: number;
  currency: string; status?: ProjectStatus;
};

export function listProjects(): Project[] {
  return (db().prepare('SELECT * FROM projects ORDER BY created_at, id').all() as Row[]).map(toProject);
}

export function getProject(id: string): Project | null {
  const r = db().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
  return r ? toProject(r) : null;
}

export function createProject(p: NewProject): Project {
  const id = p.id ?? newId('p');
  db().prepare(
    `INSERT INTO projects (id, client_name, client_email, scope, amount, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, p.clientName, p.clientEmail ?? null, p.scope, p.amount, p.currency, p.status ?? 'agreed');
  return getProject(id)!;
}

const COLUMNS = {
  clientName: 'client_name', clientEmail: 'client_email', scope: 'scope', amount: 'amount',
  currency: 'currency', status: 'status', paypalInvoiceId: 'paypal_invoice_id', paypalCaptureId: 'paypal_capture_id',
} as const;

export function updateProject(id: string, patch: Partial<Pick<Project, keyof typeof COLUMNS>>): Project | null {
  const keys = (Object.keys(patch) as (keyof typeof COLUMNS)[]).filter((k) => k in COLUMNS && patch[k] !== undefined);
  if (keys.length) {
    const sets = keys.map((k) => `${COLUMNS[k]} = ?`).join(', ');
    db().prepare(`UPDATE projects SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(...keys.map((k) => patch[k] ?? null), id);
  }
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  return db().prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}
