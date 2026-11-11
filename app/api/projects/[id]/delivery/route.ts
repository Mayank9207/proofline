import { jsonError } from '@/lib/api';
import { createDeliveryLink } from '@/lib/db/delivery';
import { getProject, updateProject } from '@/lib/db/projects';
import { listEvidence } from '@/lib/db/evidence';

export const dynamic = 'force-dynamic';

// Freelancer creates a delivery link. The raw token is returned once; share the URL with the client.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return jsonError(404, 'Project not found.');
  if (!listEvidence(id).some((e) => e.type === 'delivery_file'))
    return jsonError(409, 'Add at least one delivery_file evidence item before creating a delivery link.');
  const { token, link } = createDeliveryLink(id);
  if (project.status === 'paid') updateProject(id, { status: 'delivered' });
  const origin = new URL(request.url).origin;
  return Response.json({ url: `${origin}/deliver/${token}`, token, expiresAt: link.expiresAt }, { status: 201 });
}
