import { db, newId } from './index';
import type { EvidenceItem, EvidenceType, ProvenanceLevel } from '@/lib/evidence/types';

type Row = {
  id: string; project_id: string; type: EvidenceType; title: string; captured_at: string; source: string;
  sha256: string; storage_ref: string | null; provenance_level: ProvenanceLevel; original_filename: string | null;
  mime_type: string | null; extracted_facts: string | null; quotes: string | null; created_at: string;
};

const parse = (s: string | null) => (s ? JSON.parse(s) : null);

const toEvidence = (r: Row): EvidenceItem => ({
  id: r.id, projectId: r.project_id, type: r.type, title: r.title, capturedAt: r.captured_at, source: r.source,
  sha256: r.sha256, storageRef: r.storage_ref, provenanceLevel: r.provenance_level,
  originalFilename: r.original_filename, mimeType: r.mime_type, extractedFacts: parse(r.extracted_facts),
  quotes: parse(r.quotes), createdAt: r.created_at,
});

export type NewEvidence = {
  id?: string; projectId: string; type: EvidenceType; title: string; capturedAt?: string; source: string;
  sha256: string; storageRef?: string | null; provenanceLevel: ProvenanceLevel; originalFilename?: string | null;
  mimeType?: string | null; extractedFacts?: unknown; quotes?: unknown;
};

export function listEvidence(projectId: string): EvidenceItem[] {
  return (db().prepare('SELECT * FROM evidence_items WHERE project_id = ? ORDER BY captured_at, id').all(projectId) as Row[]).map(toEvidence);
}

export function getEvidence(id: string): EvidenceItem | null {
  const r = db().prepare('SELECT * FROM evidence_items WHERE id = ?').get(id) as Row | undefined;
  return r ? toEvidence(r) : null;
}

export function createEvidence(e: NewEvidence): EvidenceItem {
  const id = e.id ?? newId('e');
  db().prepare(
    `INSERT INTO evidence_items (id, project_id, type, title, captured_at, source, sha256, storage_ref,
       provenance_level, original_filename, mime_type, extracted_facts, quotes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, e.projectId, e.type, e.title, e.capturedAt ?? new Date().toISOString(), e.source, e.sha256,
    e.storageRef ?? null, e.provenanceLevel, e.originalFilename ?? null, e.mimeType ?? null,
    e.extractedFacts === undefined ? null : JSON.stringify(e.extractedFacts),
    e.quotes === undefined ? null : JSON.stringify(e.quotes),
  );
  return getEvidence(id)!;
}

export function deleteEvidence(id: string): boolean {
  return db().prepare('DELETE FROM evidence_items WHERE id = ?').run(id).changes > 0;
}
