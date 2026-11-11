// Turning a PayPal capture into ledger state. Used by the checkout return route and the webhook,
// so whichever arrives first records the payment and the other is a no-op.

import { listEvidence } from '@/lib/db/evidence';
import { getProject, updateProject } from '@/lib/db/projects';
import { getCapture, type Capture } from './paypal';
import { addPayPalEvidence, advanceStatus } from './store';

const captureIdOf = (facts: unknown) => (facts && typeof facts === 'object' ? (facts as { captureId?: unknown }).captureId : undefined);

export async function recordCapture(projectId: string, capture: Capture) {
  const project = getProject(projectId);
  if (!project) return;
  if (listEvidence(projectId).some((e) => e.type === 'paypal_payment' && captureIdOf(e.extractedFacts) === capture.id)) return;
  // Re-read from PayPal: the capture resource is the source of truth for status and protection.
  const fresh = await getCapture(capture.id).catch(() => capture);
  updateProject(projectId, { paypalCaptureId: fresh.id });
  addPayPalEvidence({
    projectId,
    type: 'paypal_payment',
    title: `PayPal payment ${fresh.status.toLowerCase()} (${fresh.amount.currency_code} ${fresh.amount.value})`,
    source: 'paypal_api',
    capturedAt: fresh.create_time,
    record: {
      captureId: fresh.id,
      status: fresh.status,
      amount: fresh.amount,
      statusDetails: fresh.status_details ?? null,
      sellerProtection: fresh.seller_protection ?? null,
    },
  });
  if (fresh.status === 'COMPLETED' || fresh.status === 'PENDING') advanceStatus(project, 'paid');
}
