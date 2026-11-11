import type { EvidenceDTO, ProjectSummaryDTO } from '@/lib/contracts';
import { computeCompleteness } from '@/lib/evidence/rules';
import type { EvidenceItem, Project } from '@/lib/evidence/types';

// storageRef never leaves the server; clients only learn whether a file exists.
export const toEvidenceDTO = ({ storageRef, ...e }: EvidenceItem): EvidenceDTO => ({ ...e, hasFile: storageRef !== null });

export function toProjectSummary(p: Project, evidence: EvidenceItem[]): ProjectSummaryDTO {
  const c = computeCompleteness(p.id, evidence, p.status);
  return { ...p, evidenceScore: c.completeness, missingEvidence: c.missingEvidence };
}
