import { DEFAULT_CATEGORY, REQUIREMENTS, type RequirementCategory } from './requirements';
import { PROJECT_STATUSES, type EvidenceItem, type EvidenceType, type ProjectStatus, type ProvenanceLevel } from './types';

export type Completeness = {
  projectId: string;
  category: RequirementCategory;
  status: ProjectStatus;
  presentEvidence: EvidenceType[];
  missingEvidence: EvidenceType[];
  provenance: Partial<Record<EvidenceType, ProvenanceLevel>>; // strongest level per present type
  completeness: number; // 0-100, a product-defined indicator, NOT a PayPal risk score or win probability
};

const RANK: Record<ProvenanceLevel, number> = { self_reported: 0, client_confirmed: 1, system_verified: 2 };
const reached = (status: ProjectStatus, from: ProjectStatus) =>
  PROJECT_STATUSES.indexOf(status) >= PROJECT_STATUSES.indexOf(from);

// What proof a project should have depends on how far it has progressed:
//   before paid: the agreement (scope_agreement - our addition, so early projects don't score a vacuous 100)
//   paid+:       scope_agreement, paypal_payment
//   delivered+:  + delivery_file, client_acknowledgment, paypal_completion_record
// Other categories (identity, supplier_receipt) are static lists from the requirements catalogue.
export function requiredEvidence(category: RequirementCategory, status: ProjectStatus): readonly EvidenceType[] {
  if (category !== 'proof_of_fulfillment') return REQUIREMENTS[category];
  if (reached(status, 'delivered'))
    return ['scope_agreement', 'paypal_payment', 'delivery_file', 'client_acknowledgment', 'paypal_completion_record'];
  if (reached(status, 'paid')) return ['scope_agreement', 'paypal_payment'];
  return ['scope_agreement'];
}

// Deterministic: purely a function of the stored evidence records and project status. AI never decides this.
export function computeCompleteness(
  projectId: string,
  evidence: Pick<EvidenceItem, 'type' | 'provenanceLevel'>[],
  status: ProjectStatus,
  category: RequirementCategory = DEFAULT_CATEGORY,
): Completeness {
  const required = requiredEvidence(category, status);
  const provenance: Partial<Record<EvidenceType, ProvenanceLevel>> = {};
  for (const e of evidence) {
    const cur = provenance[e.type];
    if (!cur || RANK[e.provenanceLevel] > RANK[cur]) provenance[e.type] = e.provenanceLevel;
  }
  const presentEvidence = required.filter((t) => provenance[t]);
  const missingEvidence = required.filter((t) => !provenance[t]);
  return {
    projectId, category, status, presentEvidence, missingEvidence, provenance,
    completeness: Math.round((presentEvidence.length / required.length) * 100),
  };
}
