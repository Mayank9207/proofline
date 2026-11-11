// PayPal sends the client back here after they approve a checkout order: capture it and record the
// payment on the project. `token` is the PayPal order id.

import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { captureOrder, getOrder, PayPalApiError } from '@/lib/paypal';
import { recordCapture } from '@/lib/payments';
import { getProjectByOrder } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('token');
  const project = orderId ? getProjectByOrder(orderId) : null;
  if (!orderId || !project) redirect('/');

  let order;
  try {
    order = await captureOrder(orderId);
  } catch (error) {
    // Already captured (a refresh, or the webhook got there first): read it instead.
    if (error instanceof PayPalApiError && error.status === 422) order = await getOrder(orderId);
    else throw error;
  }
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (capture) await recordCapture(project.id, capture);
  redirect(`/projects/${project.id}?paid=1`);
}
