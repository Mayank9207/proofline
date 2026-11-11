import { jsonError } from '@/lib/api';
import { deleteEvidence, getEvidence } from '@/lib/db/evidence';
import { removeOriginal } from '@/lib/evidence/storage';
import { toEvidenceDTO } from '@/lib/serialize';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const e = getEvidence((await params).id);
  return e ? Response.json({ evidence: toEvidenceDTO(e) }) : jsonError(404, 'Evidence not found.');
}

// Only self-reported evidence is removable; verified/confirmed records are the audit trail.
export async function DELETE(_req: Request, { params }: Ctx) {
  const e = getEvidence((await params).id);
  if (!e) return jsonError(404, 'Evidence not found.');
  if (e.provenanceLevel !== 'self_reported') return jsonError(403, 'System-verified and client-confirmed evidence cannot be deleted.');
  deleteEvidence(e.id);
  if (e.storageRef) await removeOriginal(e.storageRef);
  return new Response(null, { status: 204 });
}
