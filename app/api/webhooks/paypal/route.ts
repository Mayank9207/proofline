// PayPal webhooks. Each event is signature-checked, stored once by event id (PayPal retries), then
// applied to the ledger. Unverified events are stored for inspection but never change state.

import { verifyWebhook } from '@/lib/paypal';
import { recordCapture } from '@/lib/payments';
import { addEvidence, getProject, getProjectByCapture, recordPayPalEvent } from '@/lib/store';

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

export async function POST(request: Request) {
  const raw = await request.text();
  let event: Event;
  try {
    event = JSON.parse(raw) as Event;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const verified = await verifyWebhook(request.headers, raw).catch(() => false);
  const isNew = recordPayPalEvent(event, verified);
  if (!verified || !isNew) return Response.json({ received: true, verified, duplicate: !isNew });

  const r = event.resource ?? {};
  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
    case 'PAYMENT.CAPTURE.PENDING': {
      const project = r.custom_id ? getProject(r.custom_id) : undefined;
      if (project && r.id && r.amount && r.status) {
        await recordCapture(project.id, { id: r.id, status: r.status, amount: r.amount });
      }
      break;
    }
    case 'CUSTOMER.DISPUTE.CREATED':
    case 'CUSTOMER.DISPUTE.UPDATED': {
      const captureId = r.disputed_transactions?.[0]?.seller_transaction_id;
      const project = captureId ? getProjectByCapture(captureId) : undefined;
      if (project) {
        addEvidence({
          projectId: project.id,
          type: 'dispute_event',
          title: `Dispute ${r.dispute_id}: ${r.reason ?? 'opened'} (${r.status ?? ''})`,
          content: JSON.stringify(r),
          source: 'paypal_webhook',
          provenance: 'system_verified',
        });
      }
      break;
    }
  }
  return Response.json({ received: true, verified: true });
}
