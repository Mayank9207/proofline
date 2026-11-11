// Turning a PayPal capture into ledger state. Used by the checkout return route and the webhook,
// so whichever arrives first records the payment and the other is a no-op.

import { getCapture, type Capture } from './paypal';
import { addEvidence, advanceStatus, getProject, getProjectByCapture, listEvidence, updateProject } from './store';

export async function recordCapture(projectId: string, capture: Capture) {
  const project = getProject(projectId);
  if (!project) return;
  if (listEvidence(projectId).some((e) => e.type === 'paypal_payment' && e.content.includes(capture.id))) return;
  // Re-read from PayPal: the capture resource is the source of truth for status and protection.
  const fresh = await getCapture(capture.id).catch(() => capture);
  updateProject(projectId, { paypal_capture_id: fresh.id, paid_at: fresh.create_time ?? new Date().toISOString() });
  addEvidence({
    projectId,
    type: 'paypal_payment',
    title: `PayPal payment ${fresh.status.toLowerCase()} (${fresh.amount.currency_code} ${fresh.amount.value})`,
    content: JSON.stringify({
      captureId: fresh.id,
      status: fresh.status,
      amount: fresh.amount,
      statusDetails: fresh.status_details ?? null,
      sellerProtection: fresh.seller_protection ?? null,
    }),
    source: 'paypal_api',
    provenance: 'system_verified',
  });
  if (fresh.status === 'COMPLETED' || fresh.status === 'PENDING') advanceStatus(project, 'paid');
}

export const projectForCapture = (captureId: string) => getProjectByCapture(captureId);
