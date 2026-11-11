// PayPal webhooks. Each event is signature-checked, stored once by event id (PayPal retries), then
// applied to the ledger. Unverified events are stored for inspection but never change state.

import { getProject } from '@/lib/db/projects';
import { recordPayPalEvent } from '@/lib/db/records';
import { verifyWebhook } from '@/lib/paypal';
import { recordCapture } from '@/lib/payments';
import { addPayPalEvidence, getProjectByCapture } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Event = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    custom_id?: string;
    status?: string;
    amount?: { value: string; currency_code: string };
    dispute_id?: string;
    reason?: string;
    disputed_transactions?: { seller_transaction_id?: string }[];
    seller_response_due_date?: string;
  };
};

// The project an event is about: captures carry our project id as custom_id, disputes name the capture.
function projectFor(event: Event) {
  const r = event.resource ?? {};
  if (r.custom_id) return getProject(r.custom_id);
  const captureId = r.disputed_transactions?.[0]?.seller_transaction_id;
  return captureId ? getProjectByCapture(captureId) : null;
}

export async function POST(request: Request) {
  const raw = await request.text();
  let event: Event;
  try {
    event = JSON.parse(raw) as Event;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!event.id || !event.event_type) return Response.json({ error: 'not a PayPal event' }, { status: 400 });

  const verified = await verifyWebhook(request.headers, raw).catch(() => false);
  const project = projectFor(event);
  const isNew = recordPayPalEvent({ id: event.id, eventType: event.event_type, projectId: project?.id ?? null, rawBody: raw, verified });
  if (!verified || !isNew || !project) return Response.json({ received: true, verified, duplicate: !isNew });

  const r = event.resource ?? {};
  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
    case 'PAYMENT.CAPTURE.PENDING':
      if (r.id && r.amount && r.status) await recordCapture(project.id, { id: r.id, status: r.status, amount: r.amount });
      break;
    case 'CUSTOMER.DISPUTE.CREATED':
    case 'CUSTOMER.DISPUTE.UPDATED':
      addPayPalEvidence({
        projectId: project.id,
        type: 'dispute_event',
        title: `Dispute ${r.dispute_id}: ${r.reason ?? 'opened'} (${r.status ?? ''})`,
        source: 'paypal_webhook',
        record: { eventId: event.id, eventType: event.event_type, ...r },
      });
      break;
  }
  return Response.json({ received: true, verified: true });
}
