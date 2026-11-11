import { jsonError } from '@/lib/api';
import { resolveDeliveryToken } from '@/lib/db/delivery';
import { getProject } from '@/lib/db/projects';
import { listEvidence } from '@/lib/db/evidence';

export const dynamic = 'force-dynamic';

// Public endpoint. Exposes only what the client needs for THIS delivery: no email, PayPal IDs or other evidence.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const link = resolveDeliveryToken((await params).token);
  if (!link) return jsonError(404, 'This delivery link is invalid or has expired.');
  const project = getProject(link.projectId)!;
  const evidence = listEvidence(link.projectId);
  const ack = evidence.find((e) => e.type === 'client_acknowledgment');
  return Response.json({
    delivery: {
      scope: project.scope,
      clientName: project.clientName,
      expiresAt: link.expiresAt,
      files: evidence.filter((e) => e.type === 'delivery_file').map((e) => ({
        id: e.id, title: e.title, filename: e.originalFilename, mimeType: e.mimeType, sha256: e.sha256, hasFile: e.storageRef !== null,
      })),
      acknowledgedAt: ack?.capturedAt ?? null,
    },
  });
}
