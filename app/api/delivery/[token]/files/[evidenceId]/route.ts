import { jsonError } from '@/lib/api';
import { resolveDeliveryToken } from '@/lib/db/delivery';
import { getEvidence } from '@/lib/db/evidence';
import { readOriginal } from '@/lib/evidence/storage';

export const dynamic = 'force-dynamic';

// Lets the client view/download a deliverable, only if it is a delivery_file of the token's own project.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; evidenceId: string }> }) {
  const { token, evidenceId } = await params;
  const link = resolveDeliveryToken(token);
  if (!link) return jsonError(404, 'This delivery link is invalid or has expired.');
  const e = getEvidence(evidenceId);
  if (!e || e.projectId !== link.projectId || e.type !== 'delivery_file' || !e.storageRef) return jsonError(404, 'File not found.');
  const bytes = await readOriginal(e.storageRef);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': e.mimeType ?? 'application/octet-stream',
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'X-Content-SHA256': e.sha256,
    },
  });
}
