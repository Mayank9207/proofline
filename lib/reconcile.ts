// Safety net for missed webhooks: pulls the facts from PayPal and records anything we don't have yet.
// Idempotent by design (recordCapture skips a capture already on file; disputes are matched by id+status),
// so running it every few minutes, or alongside the webhook, can never double-record.

import { listEvidence } from '@/lib/db/evidence';
import { listProjects } from '@/lib/db/projects';
import { recordCapture } from '@/lib/payments';
import { getDispute, getOrder, listDisputes } from '@/lib/paypal';
import { addPayPalEvidence, getProjectByCapture } from '@/lib/store';

export type ReconcileSummary = { ordersChecked: number; paymentsRecorded: number; disputesChecked: number; disputesRecorded: number; errors: string[] };

const MAX_ORDERS = 25;
const MAX_DISPUTES = 20;

export async function reconcile(): Promise<ReconcileSummary> {
  const out: ReconcileSummary = { ordersChecked: 0, paymentsRecorded: 0, disputesChecked: 0, disputesRecorded: 0, errors: [] };

  // 1) Checkout orders with no payment on file: the buyer may have paid but the return/webhook never landed.
  const unpaid = listProjects()
    .filter((p) => p.paypalOrderId && !listEvidence(p.id).some((e) => e.type === 'paypal_payment'))
    .slice(0, MAX_ORDERS);
  for (const p of unpaid) {
    out.ordersChecked++;
    try {
      const order = await getOrder(p.paypalOrderId!);
      for (const capture of order.purchase_units?.flatMap((u) => u.payments?.captures ?? []) ?? []) {
        await recordCapture(p.id, capture);
        out.paymentsRecorded++;
      }
    } catch (e) {
      out.errors.push(`order ${p.paypalOrderId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2) Disputes on captures we know about that have no matching record (same dispute id and status).
  try {
    const recent = (await listDisputes()).slice(0, MAX_DISPUTES);
    for (const summary of recent) {
      out.disputesChecked++;
      const d = summary.disputed_transactions ? summary : await getDispute(summary.dispute_id);
      const captureId = d.disputed_transactions?.[0]?.seller_transaction_id;
      const project = captureId ? getProjectByCapture(captureId) : null;
      if (!project) continue;
      const known = listEvidence(project.id).some((e) => {
        const f = e.extractedFacts as { dispute_id?: string; disputeId?: string; status?: string } | null;
        return e.type === 'dispute_event' && (f?.dispute_id ?? f?.disputeId) === d.dispute_id && f?.status === d.status;
      });
      if (known) continue;
      addPayPalEvidence({
        projectId: project.id,
        type: 'dispute_event',
        title: `Dispute ${d.dispute_id}: ${d.reason ?? 'opened'} (${d.status})`,
        source: 'paypal_api',
        capturedAt: d.create_time,
        record: { via: 'reconcile', ...d },
      });
      out.disputesRecorded++;
    }
  } catch (e) {
    out.errors.push(`disputes: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}
