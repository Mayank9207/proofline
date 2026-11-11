import { DEFAULT_CATEGORY, REQUIREMENTS, type RequirementCategory } from './requirements';
import type { EvidenceItem, EvidenceType, ProvenanceLevel } from './types';

export type Completeness = {
  projectId: string;
  category: RequirementCategory;
  presentEvidence: EvidenceType[];
  missingEvidence: EvidenceType[];
  provenance: Partial<Record<EvidenceType, ProvenanceLevel>>; // strongest level per present type
  completeness: number; // 0-100, a product-defined indicator, NOT a PayPal risk score or win probability
};

const RANK: Record<ProvenanceLevel, number> = { self_reported: 0, client_confirmed: 1, system_verified: 2 };

// Deterministic: purely a function of the stored evidence records. AI never decides this.
export function computeCompleteness(
  projectId: string,
  evidence: Pick<EvidenceItem, 'type' | 'provenanceLevel'>[],
  category: RequirementCategory = DEFAULT_CATEGORY,
): Completeness {
  const required: readonly EvidenceType[] = REQUIREMENTS[category];
  const provenance: Partial<Record<EvidenceType, ProvenanceLevel>> = {};
  for (const e of evidence) {
    const cur = provenance[e.type];
    if (!cur || RANK[e.provenanceLevel] > RANK[cur]) provenance[e.type] = e.provenanceLevel;
  }
  const presentEvidence = required.filter((t) => provenance[t]);
  const missingEvidence = required.filter((t) => !provenance[t]);
  return {
    projectId,
    category,
    presentEvidence,
    missingEvidence,
    provenance,
    completeness: Math.round((presentEvidence.length / required.length) * 100),
  };
}
