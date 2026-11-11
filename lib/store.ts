// Reads and writes on the evidence ledger, and the row sets AG Studio reports on.

import { randomBytes } from 'node:crypto';
import { getDb, newId, now } from './db';
import {
  EVIDENCE_TYPES,
  PROVENANCE,
  completeness,
  gapsFor,
  requiredTypes,
  sha256,
  type Evidence,
  type EvidenceType,
  type Project,
  type ProjectStatus,
  type Provenance,
} from './evidence';

// --- Reads --------------------------------------------------------------------------

export const listProjects = () =>
  getDb().prepare('SELECT * FROM projects ORDER BY created_at DESC, id').all() as unknown as Project[];

export const getProject = (id: string) =>
  getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Project | undefined;

export const getProjectByToken = (token: string) =>
  getDb().prepare('SELECT * FROM projects WHERE delivery_token = ?').get(token) as unknown as Project | undefined;

export const getProjectByOrder = (orderId: string) =>
  getDb().prepare('SELECT * FROM projects WHERE paypal_order_id = ?').get(orderId) as unknown as Project | undefined;

export const getProjectByCapture = (captureId: string) =>
  getDb().prepare('SELECT * FROM projects WHERE paypal_capture_id = ?').get(captureId) as unknown as Project | undefined;

export const listEvidence = (projectId?: string) =>
  (projectId
    ? getDb().prepare('SELECT * FROM evidence WHERE project_id = ? ORDER BY captured_at').all(projectId)
    : getDb().prepare('SELECT * FROM evidence ORDER BY captured_at').all()) as unknown as Evidence[];

// --- Writes -------------------------------------------------------------------------

export function addEvidence(input: {
  projectId: string;
  type: EvidenceType;
  title: string;
  content: string;
  source: string;
  provenance: Provenance;
  facts?: unknown;
  /** Fingerprint of the original bytes, when the content is a description of a file. */
  fileSha256?: string;
}): Evidence {
  const item: Evidence = {
    id: newId('ev'),
    project_id: input.projectId,
    type: input.type,
    title: input.title,
    content: input.content,
    sha256: input.fileSha256 ?? sha256(input.content),
    source: input.source,
    provenance: input.provenance,
    captured_at: now(),
    facts: input.facts === undefined ? null : JSON.stringify(input.facts),
    seeded: 0,
  };
  getDb()
    .prepare(`INSERT INTO evidence (id, project_id, type, title, content, sha256, source, provenance, captured_at, facts, seeded)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(item.id, item.project_id, item.type, item.title, item.content, item.sha256, item.source, item.provenance, item.captured_at, item.facts);
  return item;
}

const PROJECT_COLUMNS = new Set([
  'status', 'paypal_order_id', 'paypal_capture_id', 'paid_at', 'delivered_at', 'delivery_token',
]);

export function updateProject(id: string, fields: Partial<Pick<Project,
  'status' | 'paypal_order_id' | 'paypal_capture_id' | 'paid_at' | 'delivered_at' | 'delivery_token'>>) {
  const entries = Object.entries(fields).filter(([k]) => PROJECT_COLUMNS.has(k));
  if (entries.length === 0) return;
  getDb()
    .prepare(`UPDATE projects SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v ?? null), id);
}

// Status only moves forward; a late webhook never undoes a later step.
const ORDER: ProjectStatus[] = ['agreed', 'payment_requested', 'paid', 'delivered', 'acknowledged', 'completed'];
export function advanceStatus(project: Project, to: ProjectStatus) {
  if (ORDER.indexOf(to) > ORDER.indexOf(project.status)) updateProject(project.id, { status: to });
}

export function createProject(input: { title: string; clientName: string; clientEmail: string; scope: string; price: number }) {
  const id = newId('prj');
  getDb()
    .prepare(`INSERT INTO projects (id, title, client_name, client_email, scope, price, currency, status, created_at, seeded)
              VALUES (?, ?, ?, ?, ?, ?, 'USD', 'agreed', ?, 0)`)
    .run(id, input.title, input.clientName, input.clientEmail, input.scope, input.price, now());
  addEvidence({
    projectId: id,
    type: 'scope_agreement',
    title: 'Scope entered by seller',
    content: input.scope,
    source: 'seller_entry',
    provenance: 'self_reported',
  });
  return id;
}

export function ensureDeliveryToken(project: Project): string {
  if (project.delivery_token) return project.delivery_token;
  const token = randomBytes(16).toString('base64url');
  updateProject(project.id, { delivery_token: token });
  return token;
}

// Returns false when the event was already stored (PayPal retries deliveries).
export function recordPayPalEvent(event: { id: string; event_type: string; resource?: { id?: string } }, verified: boolean) {
  const result = getDb()
    .prepare(`INSERT OR IGNORE INTO paypal_events (id, event_type, resource_id, verified, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(event.id, event.event_type, event.resource?.id ?? null, verified ? 1 : 0, JSON.stringify(event), now());
  return result.changes > 0;
}

export function recordApproval(projectId: string, action: string, payloadSha256: string, result: unknown) {
  getDb()
    .prepare('INSERT INTO approvals (id, project_id, action, payload_sha256, result, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId('apr'), projectId, action, payloadSha256, JSON.stringify(result), now());
}

// --- Posture -------------------------------------------------------------------------

export function projectPosture(project: Project, items = listEvidence(project.id)) {
  const gaps = gapsFor(project, items);
  return { project, items, gaps, score: completeness(project, items) };
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  agreed: 'Agreed',
  payment_requested: 'Payment requested',
  paid: 'Paid',
  delivered: 'Delivered',
  acknowledged: 'Acknowledged',
  completed: 'Completed',
};

// Row sets for AG Studio (see app/dashboard/studio/data.ts).
export function getProoflineData(asOf = new Date()) {
  const projects = listProjects();
  const evidence = listEvidence();
  const byProject = new Map<string, Evidence[]>();
  for (const e of evidence) byProject.set(e.project_id, [...(byProject.get(e.project_id) ?? []), e]);

  const projectRows = projects.map((p) => {
    const items = byProject.get(p.id) ?? [];
    const gaps = gapsFor(p, items);
    const paid = p.paid_at !== null;
    const score = completeness(p, items);
    return {
      id: p.id,
      title: p.title,
      client: p.client_name,
      status: STATUS_LABEL[p.status],
      stage: ORDER.indexOf(p.status),
      price: p.price,
      paidAmount: paid ? p.price : 0,
      paidDate: p.paid_at?.slice(0, 10) ?? null,
      deliveredDate: p.delivered_at?.slice(0, 10) ?? null,
      evidenceItems: items.length,
      missingItems: gaps.length,
      completeness: score,
      posture: !paid ? 'Not paid yet' : gaps.length === 0 ? 'Evidence complete' : 'Missing evidence',
      // Money that a hold or dispute could freeze while evidence is missing.
      atRisk: paid && gaps.length > 0 ? p.price : 0,
      sample: p.seeded === 1,
    };
  });

  const evidenceRows = evidence.map((e) => ({
    id: e.id,
    projectId: e.project_id,
    type: EVIDENCE_TYPES[e.type] ?? e.type,
    title: e.title,
    provenance: PROVENANCE[e.provenance] ?? e.provenance,
    source: e.source,
    capturedAt: e.captured_at,
    capturedDate: e.captured_at.slice(0, 10),
    fingerprint: e.sha256.slice(0, 12),
    sample: e.seeded === 1,
  }));

  // One row per project and required evidence type: the completeness matrix.
  const matrixRows = projects.flatMap((p) => {
    const have = new Map<EvidenceType, Evidence>();
    for (const e of byProject.get(p.id) ?? []) if (!have.has(e.type)) have.set(e.type, e);
    const required = new Set(requiredTypes(p));
    return (Object.keys(EVIDENCE_TYPES) as EvidenceType[])
      .filter((t) => ['scope_agreement', 'paypal_payment', 'delivery_file', 'client_acknowledgment', 'paypal_completion'].includes(t))
      .map((t) => {
        const item = have.get(t);
        const state = item ? 'present' : required.has(t) ? 'missing' : 'not_yet';
        return {
          id: `${p.id}:${t}`,
          projectId: p.id,
          evidenceType: EVIDENCE_TYPES[t],
          state,
          provenance: item ? PROVENANCE[item.provenance] : null,
          // What the matrix cell card shows: the item on file, or the next step for a gap.
          evidenceTitle: item?.title ?? null,
          capturedAt: item?.captured_at ?? null,
          fingerprint: item ? item.sha256.slice(0, 12) : null,
          source: item?.source ?? null,
          sampleEvidence: item ? item.seeded === 1 : false,
          nextStep: state === 'missing' ? (gapsFor(p, byProject.get(p.id) ?? []).find((g) => g.type === t)?.nextStep ?? null) : null,
          present: item ? 1 : 0,
          missing: state === 'missing' ? 1 : 0,
          required: required.has(t) ? 1 : 0,
          presentRequired: item && required.has(t) ? 1 : 0,
        };
      });
  });

  const gapRows = projects.flatMap((p) =>
    gapsFor(p, byProject.get(p.id) ?? []).map((g) => ({
      id: `${p.id}:${g.type}`,
      projectId: p.id,
      missing: g.label,
      nextStep: g.nextStep,
      atRisk: p.paid_at ? p.price : 0,
    })),
  );

  return { asOf: asOf.toISOString(), projects: projectRows, evidence: evidenceRows, matrix: matrixRows, gaps: gapRows };
}

export type ProoflineData = ReturnType<typeof getProoflineData>;
