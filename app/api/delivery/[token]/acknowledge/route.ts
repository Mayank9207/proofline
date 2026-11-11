import { jsonError } from '@/lib/api';
import { newId } from '@/lib/db';
import { resolveDeliveryToken } from '@/lib/db/delivery';
import { getProject, updateProject } from '@/lib/db/projects';
import { createEvidence, listEvidence } from '@/lib/db/evidence';
import { canonicalJson, calculateSHA256 } from '@/lib/evidence/hash';
import { provenanceFor } from '@/lib/evidence/provenance';

export const dynamic = 'force-dynamic';

// Records "acknowledged via the delivery portal". A button click through a private link does not prove
// the client's identity, so the evidence says exactly that and is labelled client_confirmed, not verified.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const link = resolveDeliveryToken((await params).token);
  if (!link) return jsonError(404, 'This delivery link is invalid or has expired.');
  const project = getProject(link.projectId)!;
  const evidence = listEvidence(link.projectId);

  const existing = evidence.find((e) => e.type === 'client_acknowledgment');
  if (existing) return Response.json({ acknowledgedAt: existing.capturedAt, alreadyAcknowledged: true });

  const files = evidence.filter((e) => e.type === 'delivery_file');
  if (!files.length) return jsonError(409, 'Nothing to acknowledge.');

  const acknowledgedAt = new Date().toISOString();
  const record = {
    projectId: project.id,
    acknowledgedAt,
    method: 'delivery_portal_link', // identity of the person clicking is NOT verified
    acknowledged: files.map((f) => ({ evidenceId: f.id, title: f.title, sha256: f.sha256 })),
  };
  createEvidence({
    id: newId('e'), projectId: project.id, type: 'client_acknowledgment',
    title: `Client acknowledged delivery via portal (${project.clientName})`,
    capturedAt: acknowledgedAt, source: 'delivery_portal', sha256: calculateSHA256(canonicalJson(record)),
    provenanceLevel: provenanceFor('delivery_portal'), mimeType: 'application/json', extractedFacts: record,
  });
  if (project.status === 'paid' || project.status === 'delivered') updateProject(project.id, { status: 'acknowledged' });
  return Response.json({ acknowledgedAt, alreadyAcknowledged: false }, { status: 201 });
}
