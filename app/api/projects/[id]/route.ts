import { patchProjectBody } from '@/lib/contracts';
import { jsonError, parseBody } from '@/lib/api';
import { deleteProject, getProject, updateProject } from '@/lib/db/projects';
import { listEvidence } from '@/lib/db/evidence';
import { computeCompleteness } from '@/lib/evidence/rules';
import { toEvidenceDTO, toProjectSummary } from '@/lib/serialize';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return jsonError(404, 'Project not found.');
  const evidence = listEvidence(id);
  return Response.json({
    project: toProjectSummary(project, evidence),
    evidence: evidence.map(toEvidenceDTO),
    completeness: computeCompleteness(id, evidence, project.status),
  });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = await parseBody(request, patchProjectBody);
  if ('response' in parsed) return parsed.response;
  const project = updateProject(id, parsed.data);
  if (!project) return jsonError(404, 'Project not found.');
  return Response.json({ project: toProjectSummary(project, listEvidence(id)) });
}

// Safeguard: a project with PayPal records attached is a financial record and can't be deleted here.
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return jsonError(404, 'Project not found.');
  if (project.paypalOrderId || project.paypalCaptureId || ['paid', 'delivered', 'acknowledged', 'completed_recorded', 'closed'].includes(project.status))
    return jsonError(409, 'Projects with PayPal payments or later lifecycle states cannot be deleted.');
  deleteProject(id);
  return new Response(null, { status: 204 });
}
