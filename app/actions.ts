'use server';

// Server actions behind Proofline's pages. Every PayPal write happens here, on the server, and is
// recorded in the approvals table with the sha256 of the exact payload the seller approved.

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createOrder, recordServiceCompleted, sandboxChargeback, provideDisputeEvidence, PayPalApiError } from '@/lib/paypal';
import {
  addEvidence,
  advanceStatus,
  createProject,
  ensureDeliveryToken,
  getProject,
  getProjectByToken,
  listEvidence,
  recordApproval,
  updateProject,
} from '@/lib/store';
import { extractEvidence, mapNotice, type NoticeItem } from '@/lib/ai-tasks';
import { EVIDENCE_TYPES, sha256, type EvidenceType } from '@/lib/evidence';
import { getDb, newId, now } from '@/lib/db';

async function baseUrl() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

function refresh(projectId?: string) {
  revalidatePath('/');
  revalidatePath('/dashboard');
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

export type ActionResult = { ok: boolean; message: string };

// --- Projects and evidence --------------------------------------------------------------

export async function createProjectAction(form: FormData) {
  const price = Number(text(form, 'price'));
  const id = createProject({
    title: text(form, 'title'),
    clientName: text(form, 'clientName'),
    clientEmail: text(form, 'clientEmail'),
    scope: text(form, 'scope'),
    price: Number.isFinite(price) && price > 0 ? price : 0,
  });
  refresh(id);
  redirect(`/projects/${id}`);
}

export async function addEvidenceAction(projectId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const project = getProject(projectId);
  if (!project) return { ok: false, message: 'Project not found.' };
  const pasted = text(form, 'content');
  const file = form.get('file');
  const chosenType = text(form, 'type') as EvidenceType | 'auto';

  // A file: fingerprint the bytes. Proofline keeps the fingerprint and description, not the file.
  if (file instanceof File && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const type: EvidenceType = chosenType === 'auto' ? 'delivery_file' : chosenType;
    addEvidence({
      projectId,
      type,
      title: text(form, 'title') || file.name,
      content: `${file.name} (${file.size} bytes, ${file.type || 'unknown type'})`,
      fileSha256: createHash('sha256').update(bytes).digest('hex'),
      source: 'upload',
      provenance: type === 'delivery_file' ? 'system_verified' : 'self_reported',
    });
    if (type === 'delivery_file') {
      updateProject(projectId, { delivered_at: project.delivered_at ?? now() });
      advanceStatus(project, 'delivered');
    }
    refresh(projectId);
    return { ok: true, message: `Fingerprinted ${file.name}.` };
  }

  if (!pasted) return { ok: false, message: 'Paste some text or choose a file.' };

  if (chosenType !== 'auto') {
    addEvidence({ projectId, type: chosenType, title: text(form, 'title') || EVIDENCE_TYPES[chosenType], content: pasted, source: 'paste', provenance: 'self_reported' });
    refresh(projectId);
    return { ok: true, message: 'Evidence added.' };
  }

  const extraction = await extractEvidence(project, pasted);
  if (!extraction) {
    addEvidence({ projectId, type: 'other', title: text(form, 'title') || 'Pasted text', content: pasted, source: 'paste', provenance: 'self_reported' });
    refresh(projectId);
    return { ok: true, message: 'AI is unavailable, so the text was saved unclassified. Choose a type to file it properly.' };
  }
  addEvidence({
    projectId,
    type: extraction.type,
    title: text(form, 'title') || extraction.title,
    content: pasted,
    source: 'paste',
    provenance: 'self_reported',
    facts: extraction.statements,
  });
  refresh(projectId);
  const dropped = extraction.dropped ? ` ${extraction.dropped} quote(s) not found word for word in your text were discarded.` : '';
  return { ok: true, message: `Filed as “${EVIDENCE_TYPES[extraction.type]}” with ${extraction.statements.length} verified quote(s).${dropped}` };
}

// --- PayPal ------------------------------------------------------------------------------

export async function requestPaymentAction(projectId: string) {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found');
  const base = await baseUrl();
  const { order, approveUrl } = await createOrder({
    projectId,
    description: project.title,
    amount: project.price,
    currency: project.currency,
    returnUrl: `${base}/api/paypal/return`,
    cancelUrl: `${base}/projects/${projectId}`,
  });
  updateProject(projectId, { paypal_order_id: order.id });
  advanceStatus(project, 'payment_requested');
  refresh(projectId);
  if (!approveUrl) throw new Error('PayPal returned no approval link');
  redirect(approveUrl);
}

export async function createDeliveryLinkAction(projectId: string) {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found');
  ensureDeliveryToken(project);
  refresh(projectId);
}

export async function recordCompletionAction(projectId: string): Promise<ActionResult> {
  const project = getProject(projectId);
  if (!project?.paypal_capture_id) return { ok: false, message: 'There is no PayPal capture for this project yet.' };
  const payload = { trackers: [{ transaction_id: project.paypal_capture_id, status: 'COMPLETED' }] };
  try {
    const result = await recordServiceCompleted(project.paypal_capture_id);
    recordApproval(projectId, 'record_service_completed', sha256(JSON.stringify(payload)), result);
    addEvidence({
      projectId,
      type: 'paypal_completion',
      title: 'Service recorded as completed in PayPal',
      content: JSON.stringify({ request: payload, response: result }),
      source: 'paypal_api',
      provenance: 'system_verified',
    });
    advanceStatus(project, 'completed');
    refresh(projectId);
    return { ok: true, message: 'PayPal accepted the completion record.' };
  } catch (error) {
    const message = error instanceof PayPalApiError ? error.message : String(error);
    return { ok: false, message: `PayPal refused: ${message}` };
  }
}

// --- Client delivery page ----------------------------------------------------------------

export async function acknowledgeDeliveryAction(token: string, form: FormData) {
  const project = getProjectByToken(token);
  if (!project) throw new Error('Unknown delivery link');
  const h = await headers();
  const name = text(form, 'name') || project.client_name;
  // Store a hash of the network details, not the details themselves.
  const fingerprint = sha256(`${h.get('x-forwarded-for') ?? ''}|${h.get('user-agent') ?? ''}`).slice(0, 16);
  addEvidence({
    projectId: project.id,
    type: 'client_acknowledgment',
    title: `Receipt confirmed by ${name}`,
    content: JSON.stringify({ confirmedBy: name, confirmedAt: now(), statement: text(form, 'statement'), clientFingerprint: fingerprint }),
    source: 'delivery_portal',
    provenance: 'client_confirmed',
  });
  advanceStatus(project, 'acknowledged');
  refresh(project.id);
  redirect(`/d/${token}?confirmed=1`);
}

// --- Notices ------------------------------------------------------------------------------

export async function mapNoticeAction(_prev: { items: NoticeItem[] | null; error?: string } | null, form: FormData) {
  const project = getProject(text(form, 'projectId'));
  const notice = text(form, 'notice');
  if (!project || !notice) return { items: null, error: 'Choose a project and paste the notice.' };
  const items = await mapNotice(notice, project, listEvidence(project.id));
  if (!items) return { items: null, error: 'AI is unavailable right now. Try again, or check the OpenAI key.' };
  getDb()
    .prepare('INSERT INTO notices (id, project_id, text, result, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(newId('ntc'), project.id, notice, JSON.stringify(items), now());
  return { items };
}

// --- Sandbox dispute demo -----------------------------------------------------------------

export async function sandboxChargebackAction(projectId: string): Promise<ActionResult> {
  const project = getProject(projectId);
  if (!project?.paypal_capture_id) return { ok: false, message: 'There is no PayPal capture for this project yet.' };
  try {
    await sandboxChargeback(project.paypal_capture_id);
    return { ok: true, message: 'Sandbox chargeback requested. PayPal sends a dispute webhook shortly.' };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}

export async function answerDisputeAction(projectId: string, disputeId: string, notes: string): Promise<ActionResult> {
  try {
    const result = await provideDisputeEvidence(disputeId, notes);
    recordApproval(projectId, 'provide_dispute_evidence', sha256(JSON.stringify({ disputeId, notes })), result);
    refresh(projectId);
    return { ok: true, message: 'Evidence sent to PayPal.' };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}
