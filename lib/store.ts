// Proofline's read model and the few writes the server actions and PayPal routes share, built on the
// backend in lib/db/* and lib/evidence/*. Pages, server actions and AG Studio read through here;
// what counts as complete is decided only by lib/evidence/rules.ts.

import { createEvidence, listEvidence } from '@/lib/db/evidence';
import { listProjects, updateProject } from '@/lib/db/projects';
import { canonicalJson, calculateSHA256 } from '@/lib/evidence/hash';
import { EVIDENCE_LABELS, MATRIX_TYPES, PROVENANCE_LABELS, STATUS_LABELS, nextStepFor } from '@/lib/evidence/labels';
import { provenanceFor } from '@/lib/evidence/provenance';
import { computeCompleteness, requiredEvidence } from '@/lib/evidence/rules';
import { DEFAULT_CATEGORY } from '@/lib/evidence/requirements';
import { PROJECT_STATUSES, type EvidenceItem, type EvidenceType, type Project, type ProjectStatus } from '@/lib/evidence/types';

// --- Lookups ---------------------------------------------------------------------------------

export const getProjectByOrder = (orderId: string) => listProjects().find((p) => p.paypalOrderId === orderId) ?? null;
export const getProjectByCapture = (captureId: string) => listProjects().find((p) => p.paypalCaptureId === captureId) ?? null;

const stage = (s: ProjectStatus) => PROJECT_STATUSES.indexOf(s);
export const reached = (p: Pick<Project, 'status'>, s: ProjectStatus) => stage(p.status) >= stage(s);

// Seeded demo data (scripts/seed.ts) is labelled "Sample" everywhere: seed clients use the reserved
// example.com domain and seeded evidence has a `seed` source. Anything else came through the app or PayPal.
export const isSampleProject = (p: Pick<Project, 'clientEmail'>) => p.clientEmail?.toLowerCase().endsWith('@example.com') ?? false;
export const isSampleEvidence = (e: Pick<EvidenceItem, 'source'>) => e.source.startsWith('seed');

/** Minor units (backend) to a display amount. */
export const major = (minor: number) => minor / 100;

// --- Writes shared by actions, the PayPal return route and the webhook --------------------------

/** Status only moves forward: a late webhook or a repeated click never undoes a later step. */
export function advanceStatus(project: Project, to: ProjectStatus) {
  if (stage(to) > stage(project.status)) updateProject(project.id, { status: to });
}

/**
 * Evidence created from a PayPal API response or a signature-verified webhook. The record itself is
 * the evidence: it is kept as extracted facts and fingerprinted as canonical JSON.
 */
export function addPayPalEvidence(e: { projectId: string; type: EvidenceType; title: string; source: string; record: Record<string, unknown>; capturedAt?: string }) {
  return createEvidence({
    projectId: e.projectId,
    type: e.type,
    title: e.title,
    capturedAt: e.capturedAt,
    source: e.source,
    sha256: calculateSHA256(canonicalJson(e.record)),
    provenanceLevel: provenanceFor('paypal_verified'),
    mimeType: 'application/json',
    extractedFacts: e.record,
  });
}

// --- Posture -----------------------------------------------------------------------------------

export type Gap = { type: EvidenceType; label: string; nextStep: string };

export function projectPosture(project: Project, evidence: EvidenceItem[] = listEvidence(project.id)) {
  const result = computeCompleteness(project.id, evidence, project.status);
  const gaps: Gap[] = result.missingEvidence.map((type) => ({ type, label: EVIDENCE_LABELS[type], nextStep: nextStepFor(type) }));
  return {
    project,
    evidence,
    gaps,
    /** 0-1, from the backend's 0-100 completeness. */
    score: result.completeness / 100,
    provenance: result.provenance,
    paid: reached(project, 'paid'),
    sample: isSampleProject(project),
  };
}

export type Posture = ReturnType<typeof projectPosture>;

export const listPostures = () => listProjects().map((p) => projectPosture(p));

// --- Row sets for AG Studio (app/dashboard/studio/data.ts) ------------------------------------

const firstOf = (items: EvidenceItem[], type: EvidenceType) => items.find((e) => e.type === type) ?? null;

export function getProoflineData(asOf = new Date()) {
  const postures = listPostures();

  const projectRows = postures.map(({ project: p, evidence, gaps, score, paid, sample }) => ({
    id: p.id,
    title: p.title,
    client: p.clientName,
    status: STATUS_LABELS[p.status],
    stage: stage(p.status),
    price: major(p.amount),
    paidAmount: paid ? major(p.amount) : 0,
    paidDate: paid ? (firstOf(evidence, 'paypal_payment')?.capturedAt.slice(0, 10) ?? null) : null,
    deliveredDate: reached(p, 'delivered') ? (firstOf(evidence, 'delivery_file')?.capturedAt.slice(0, 10) ?? null) : null,
    evidenceItems: evidence.length,
    missingItems: gaps.length,
    completeness: score,
    posture: !paid ? 'Not paid yet' : gaps.length === 0 ? 'Evidence complete' : 'Missing evidence',
    // Money that a hold or dispute could freeze while evidence is missing.
    atRisk: paid && gaps.length > 0 ? major(p.amount) : 0,
    sample,
  }));

  const evidenceRows = postures.flatMap(({ evidence }) =>
    evidence.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      type: EVIDENCE_LABELS[e.type] ?? e.type,
      title: e.title,
      provenance: PROVENANCE_LABELS[e.provenanceLevel],
      source: e.source,
      capturedAt: e.capturedAt,
      capturedDate: e.capturedAt.slice(0, 10),
      fingerprint: e.sha256.slice(0, 12),
      sample: isSampleEvidence(e),
    })),
  );

  // One row per project and fulfilment evidence type: the completeness matrix.
  const matrixRows = postures.flatMap(({ project: p, evidence, gaps, provenance }) => {
    const required = new Set(requiredEvidence(DEFAULT_CATEGORY, p.status));
    return MATRIX_TYPES.map((t) => {
      // Show the strongest item on file for this type, as the score does.
      const item = evidence.find((e) => e.type === t && e.provenanceLevel === provenance[t]) ?? null;
      const state = item ? 'present' : required.has(t) ? 'missing' : 'not_yet';
      return {
        id: `${p.id}:${t}`,
        projectId: p.id,
        evidenceType: EVIDENCE_LABELS[t],
        state,
        provenance: item ? PROVENANCE_LABELS[item.provenanceLevel] : null,
        // What the matrix cell card shows: the item on file, or the next step for a gap.
        evidenceTitle: item?.title ?? null,
        capturedAt: item?.capturedAt ?? null,
        fingerprint: item ? item.sha256.slice(0, 12) : null,
        source: item?.source ?? null,
        sampleEvidence: item ? isSampleEvidence(item) : false,
        nextStep: state === 'missing' ? (gaps.find((g) => g.type === t)?.nextStep ?? null) : null,
        present: item ? 1 : 0,
        missing: state === 'missing' ? 1 : 0,
        required: required.has(t) ? 1 : 0,
        presentRequired: item && required.has(t) ? 1 : 0,
      };
    });
  });

  const gapRows = postures.flatMap(({ project: p, gaps, paid }) =>
    gaps.map((g) => ({
      id: `${p.id}:${g.type}`,
      projectId: p.id,
      missing: g.label,
      nextStep: g.nextStep,
      atRisk: paid ? major(p.amount) : 0,
    })),
  );

  return { asOf: asOf.toISOString(), projects: projectRows, evidence: evidenceRows, matrix: matrixRows, gaps: gapRows };
}

export type ProoflineData = ReturnType<typeof getProoflineData>;
