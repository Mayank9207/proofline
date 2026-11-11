import { jsonError } from '@/lib/api';
import { getProject } from '@/lib/db/projects';
import { listEvidence } from '@/lib/db/evidence';
import { computeCompleteness } from '@/lib/evidence/rules';
import { isRequirementCategory } from '@/lib/evidence/requirements';

export const dynamic = 'force-dynamic';

// GET /api/projects/p1/completeness?category=proof_of_fulfillment
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(id)) return jsonError(404, 'Project not found.');
  const cat = new URL(request.url).searchParams.get('category') ?? 'proof_of_fulfillment';
  if (!isRequirementCategory(cat)) return jsonError(400, `Unknown category "${cat}".`);
  return Response.json({ completeness: computeCompleteness(id, listEvidence(id), cat) });
}
