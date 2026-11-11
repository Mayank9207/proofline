import { FREELANCER_EVIDENCE_TYPES, evidenceSchema } from '@/lib/contracts';
import { jsonError } from '@/lib/api';
import { newId } from '@/lib/db';
import { getProject } from '@/lib/db/projects';
import { createEvidence, listEvidence } from '@/lib/db/evidence';
import { calculateSHA256 } from '@/lib/evidence/hash';
import { provenanceFor } from '@/lib/evidence/provenance';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, storeOriginal } from '@/lib/evidence/storage';
import { toEvidenceDTO } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!projectId) return jsonError(400, 'projectId is required.');
  if (!getProject(projectId)) return jsonError(404, 'Project not found.');
  return Response.json({ evidence: listEvidence(projectId).map(toEvidenceDTO) });
}

// multipart/form-data: projectId, type, title, and either `file` (upload) or `text` (pasted content).
// Provenance is assigned here from the ingest channel; any client-supplied provenance is ignored.
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'Expected multipart/form-data.');
  }
  const projectId = String(form.get('projectId') ?? '');
  const type = String(form.get('type') ?? '');
  const title = String(form.get('title') ?? '').trim();
  const file = form.get('file');
  const text = form.get('text');

  if (!getProject(projectId)) return jsonError(404, 'Project not found.');
  if (!(FREELANCER_EVIDENCE_TYPES as readonly string[]).includes(type))
    return jsonError(400, `type must be one of: ${FREELANCER_EVIDENCE_TYPES.join(', ')}. Payment, acknowledgment and completion records are created by the system only.`);
  if (!title || title.length > 200) return jsonError(400, 'title is required (max 200 chars).');

  let bytes: Buffer;
  let mimeType: string | null = null;
  let originalFilename: string | null = null;
  let channel: 'freelancer_upload' | 'freelancer_paste';
  if (file instanceof File) {
    if (file.size > MAX_UPLOAD_BYTES) return jsonError(413, `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`);
    if (!ALLOWED_MIME.has(file.type)) return jsonError(415, `Unsupported file type "${file.type}".`);
    bytes = Buffer.from(await file.arrayBuffer());
    mimeType = file.type;
    originalFilename = file.name.slice(0, 255); // metadata only; never used as a path
    channel = 'freelancer_upload';
  } else if (typeof text === 'string' && text.length > 0) {
    if (text.length > 200_000) return jsonError(413, 'Pasted text too large.');
    bytes = Buffer.from(text, 'utf8');
    mimeType = 'text/plain';
    channel = 'freelancer_paste';
  } else {
    return jsonError(400, 'Provide a `file` or non-empty `text`.');
  }

  const id = newId('e');
  const sha256 = calculateSHA256(bytes); // hash the untouched original bytes before anything else
  const storageRef = await storeOriginal(projectId, id, bytes);
  const item = createEvidence({
    id, projectId, type: type as (typeof FREELANCER_EVIDENCE_TYPES)[number], title, source: channel === 'freelancer_upload' ? 'upload' : 'paste',
    sha256, storageRef, provenanceLevel: provenanceFor(channel), originalFilename, mimeType,
  });
  return Response.json({ evidence: evidenceSchema.parse(toEvidenceDTO(item)) }, { status: 201 });
}
