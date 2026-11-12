import { timingSafeEqual } from 'node:crypto';
import { reconcile } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Called by the Render cron job (see render.yaml). Protected by a shared secret: anyone could otherwise
// trigger PayPal API calls. Fails closed when CRON_SECRET is not configured.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: 'cron not configured' }, { status: 503 });
  if (!authorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(await reconcile());
}
