import { createProjectBody } from '@/lib/contracts';
import { jsonError, parseBody } from '@/lib/api';
import { createProject, listProjects } from '@/lib/db/projects';
import { listEvidence } from '@/lib/db/evidence';
import { toProjectSummary } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export async function GET() {
  const projects = listProjects().map((p) => toProjectSummary(p, listEvidence(p.id)));
  return Response.json({ projects });
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, createProjectBody);
  if ('response' in parsed) return parsed.response;
  const project = createProject(parsed.data);
  return Response.json({ project: toProjectSummary(project, []) }, { status: 201 });
}
