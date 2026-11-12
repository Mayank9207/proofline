'use server';

// Server actions behind Proofline's pages. They call the backend's lib functions directly (lib/db/*,
// lib/evidence/*) and follow the same rules as its API routes: fingerprint the original bytes, keep
// the original under data/evidence, set provenance from how the evidence arrived, and let sellers
// file only the evidence types they may file by hand. Every PayPal write is recorded in `approvals`
// with the sha256 of the exact payload the seller approved.

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createProjectBody, FREELANCER_EVIDENCE_TYPES } from '@/lib/contracts';
import { newId } from '@/lib/db';
import { createDeliveryLink } from '@/lib/db/delivery';
import { createEvidence, listEvidence } from '@/lib/db/evidence';
import { createProject, getProject, updateProject } from '@/lib/db/projects';
import { recordApproval, recordNotice } from '@/lib/db/records';
import { calculateSHA256 } from '@/lib/evidence/hash';
import { EVIDENCE_LABELS } from '@/lib/evidence/labels';
import { provenanceFor, type IngestChannel } from '@/lib/evidence/provenance';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, storeOriginal } from '@/lib/evidence/storage';
import { extractEvidence, mapNotice, type NoticeItem } from '@/lib/ai-tasks';
import { assertDisputeOnCapture, createOrder, recordServiceCompleted, sandboxChargeback, provideDisputeEvidence, PayPalApiError } from '@/lib/paypal';
import { addPayPalEvidence, advanceStatus, major } from '@/lib/store';

type FreelancerType = (typeof FREELANCER_EVIDENCE_TYPES)[number];
const isFreelancerType = (v: string): v is FreelancerType => (FREELANCER_EVIDENCE_TYPES as readonly string[]).includes(v);

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

export type ActionResult = { ok: boolean; message: string; url?: string };

/** Store an original the seller supplied and register it as self-reported evidence. */
async function ingest(e: {
  projectId: string;
  type: FreelancerType;
  title: string;
  bytes: Buffer;
  mimeType: string;
  originalFilename?: string | null;
  channel: Extract<IngestChannel, 'freelancer_upload' | 'freelancer_paste'>;
  extractedFacts?: unknown;
  quotes?: unknown;
}) {
  const id = newId('e');
  const sha256 = calculateSHA256(e.bytes); // the untouched original, before anything else
  const storageRef = await storeOriginal(e.projectId, id, e.bytes);
  return createEvidence({
    id,
    projectId: e.projectId,
    type: e.type,
    title: e.title.slice(0, 200),
    source: e.channel === 'freelancer_upload' ? 'upload' : 'paste',
    sha256,
    storageRef,
    provenanceLevel: provenanceFor(e.channel),
    originalFilename: e.originalFilename ?? null,
    mimeType: e.mimeType,
    extractedFacts: e.extractedFacts,
    quotes: e.quotes,
  });
}

// --- Projects and evidence --------------------------------------------------------------

export async function createProjectAction(form: FormData) {
  const price = Number(text(form, 'price'));
  const parsed = createProjectBody.safeParse({
    title: text(form, 'title'),
    clientName: text(form, 'clientName'),
    clientEmail: text(form, 'clientEmail') || null,
    scope: text(form, 'scope'),
    amount: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : 0,
    currency: 'USD',
  });
  if (!parsed.success) throw new Error('Check the project details: every field is required and the price must be a number.');
  const project = createProject(parsed.data);
  // The scope as the seller typed it is the first, self-reported, record of the agreement.
  await ingest({
    projectId: project.id,
    type: 'scope_agreement',
    title: 'Scope entered by seller',
    bytes: Buffer.from(parsed.data.scope, 'utf8'),
    mimeType: 'text/plain',
    channel: 'freelancer_paste',
  });
  refresh(project.id);
  redirect(`/projects/${project.id}`);
}

export async function addEvidenceAction(projectId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const project = getProject(projectId);
  if (!project) return { ok: false, message: 'Project not found.' };
  const pasted = text(form, 'content');
  const file = form.get('file');
  const picked = text(form, 'type');
  const title = text(form, 'title');
  const chosen: FreelancerType | 'auto' | null = picked === 'auto' ? 'auto' : isFreelancerType(picked) ? picked : null;
  if (!chosen) return { ok: false, message: 'Choose an evidence type you can add yourself.' };

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: `The file is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
    if (!ALLOWED_MIME.has(file.type)) return { ok: false, message: `Files of type "${file.type || 'unknown'}" are not accepted. Use an image, PDF, text or zip file.` };
    await ingest({
      projectId,
      type: chosen === 'auto' ? 'delivery_file' : chosen,
      title: title || file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      originalFilename: file.name.slice(0, 255),
      channel: 'freelancer_upload',
    });
    refresh(projectId);
    return { ok: true, message: `Stored ${file.name} with its sha256 fingerprint.` };
  }

  if (!pasted) return { ok: false, message: 'Paste some text or choose a file.' };
  if (pasted.length > 200_000) return { ok: false, message: 'The pasted text is too long.' };
  const bytes = Buffer.from(pasted, 'utf8');

  if (chosen !== 'auto') {
    await ingest({ projectId, type: chosen, title: title || EVIDENCE_LABELS[chosen], bytes, mimeType: 'text/plain', channel: 'freelancer_paste' });
    refresh(projectId);
    return { ok: true, message: 'Evidence added.' };
  }

  const extraction = await extractEvidence(project, pasted);
  if (!extraction) {
    await ingest({ projectId, type: 'other', title: title || 'Pasted text', bytes, mimeType: 'text/plain', channel: 'freelancer_paste' });
    refresh(projectId);
    return { ok: true, message: 'AI is unavailable, so the text was saved unclassified. Choose a type to file it properly.' };
  }
  await ingest({
    projectId,
    type: extraction.type,
    title: title || extraction.title,
    bytes,
    mimeType: 'text/plain',
    channel: 'freelancer_paste',
    extractedFacts: extraction.statements,
    quotes: extraction.statements.map((s) => s.quote),
  });
  refresh(projectId);
  const dropped = extraction.dropped ? ` ${extraction.dropped} quote(s) not found word for word in your text were discarded.` : '';
  return { ok: true, message: `Filed as “${EVIDENCE_LABELS[extraction.type]}” with ${extraction.statements.length} verified quote(s).${dropped}` };
}

// --- PayPal ------------------------------------------------------------------------------

export async function requestPaymentAction(projectId: string) {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found');
  const base = await baseUrl();
  const { order, approveUrl } = await createOrder({
    projectId,
    description: project.title,
    amount: major(project.amount),
    currency: project.currency,
    returnUrl: `${base}/api/paypal/return`,
    cancelUrl: `${base}/projects/${projectId}`,
  });
  updateProject(projectId, { paypalOrderId: order.id });
  advanceStatus(project, 'invoiced');
  refresh(projectId);
  if (!approveUrl) throw new Error('PayPal returned no approval link');
  redirect(approveUrl);
}

export async function recordCompletionAction(projectId: string): Promise<ActionResult> {
  const project = getProject(projectId);
  if (!project?.paypalCaptureId) return { ok: false, message: 'There is no PayPal capture for this project yet.' };
  const payload = { trackers: [{ transaction_id: project.paypalCaptureId, status: 'COMPLETED' }] };
  try {
    const result = await recordServiceCompleted(project.paypalCaptureId);
    // trackers-batch answers 200 even when it rejects a tracker; the rejection is in `errors`.
    if (result.errors?.length) {
      const reason = JSON.stringify(result.errors).slice(0, 300);
      recordApproval({ projectId, actionType: 'record_service_completed', payload, ok: false, result });
      console.error('[PayPal] completion record refused:', reason);
      return { ok: false, message: `PayPal refused the completion record: ${reason}` };
    }
    recordApproval({ projectId, actionType: 'record_service_completed', payload, ok: true, result });
    addPayPalEvidence({
      projectId,
      type: 'paypal_completion_record',
      title: 'Service recorded as completed in PayPal',
      source: 'paypal_api',
      record: { request: payload, response: result as Record<string, unknown> },
    });
    advanceStatus(project, 'completed_recorded');
    refresh(projectId);
    return { ok: true, message: 'PayPal accepted the completion record.' };
  } catch (error) {
    const message = error instanceof PayPalApiError ? error.message : String(error);
    recordApproval({ projectId, actionType: 'record_service_completed', payload, ok: false, result: { error: message } });
    return { ok: false, message: `PayPal refused: ${message}` };
  }
}

// --- Client delivery link ----------------------------------------------------------------

/**
 * A secure link for the client (lib/db/delivery.ts): only its hash is stored, so the URL is shown
 * once, here. Creating a new one revokes the previous link. Same rules as POST
 * /api/projects/[id]/delivery.
 */
export async function createDeliveryLinkAction(projectId: string): Promise<ActionResult> {
  const project = getProject(projectId);
  if (!project) return { ok: false, message: 'Project not found.' };
  if (!listEvidence(projectId).some((e) => e.type === 'delivery_file'))
    return { ok: false, message: 'Upload the delivered file first: the client acknowledges what is listed on the link.' };
  const { token, link } = createDeliveryLink(projectId);
  if (project.status === 'paid') updateProject(projectId, { status: 'delivered' });
  refresh(projectId);
  return {
    ok: true,
    url: `${await baseUrl()}/deliver/${token}`,
    message: `Send this link to the client. It is shown only once, expires on ${new Date(link.expiresAt).toLocaleDateString('en-GB')} and replaces any earlier link.`,
  };
}

// --- Notices ------------------------------------------------------------------------------

export async function mapNoticeAction(_prev: { items: NoticeItem[] | null; error?: string } | null, form: FormData) {
  const project = getProject(text(form, 'projectId'));
  const notice = text(form, 'notice');
  if (!project || !notice) return { items: null, error: 'Choose a project and paste the notice.' };
  const items = await mapNotice(notice, listEvidence(project.id));
  if (!items) return { items: null, error: 'AI is unavailable right now. Try again in a minute.' };
  recordNotice({ projectId: project.id, rawText: notice, category: [...new Set(items.map((i) => i.kind))].join(',') || null });
  return { items };
}

// --- Sandbox dispute demo -----------------------------------------------------------------

export async function sandboxChargebackAction(projectId: string): Promise<ActionResult> {
  const project = getProject(projectId);
  if (!project?.paypalCaptureId) return { ok: false, message: 'There is no PayPal capture for this project yet.' };
  try {
    await sandboxChargeback(project.paypalCaptureId);
    refresh(projectId);
    return { ok: true, message: 'Sandbox chargeback requested. PayPal opens the dispute within a few minutes: refresh this page to see it under PayPal disputes.' };
  } catch (error) {
    return { ok: false, message: error instanceof PayPalApiError ? `PayPal refused: ${error.message}` : String(error) };
  }
}

/**
 * Send the seller's approved notes to PayPal as proof of fulfillment (bound to project and dispute;
 * the notes come from the form). The approval stores the sha256 of exactly what was sent, and a
 * PayPal acceptance is filed as dispute evidence on the project.
 */
export async function answerDisputeAction(projectId: string, disputeId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const project = getProject(projectId);
  if (!project?.paypalCaptureId) return { ok: false, message: 'There is no PayPal payment for this project.' };
  const notes = text(form, 'notes').slice(0, 2000);
  if (!notes) return { ok: false, message: 'Write the notes PayPal should read first.' };

  const payload = { disputeId, evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes }] };
  try {
    await assertDisputeOnCapture(disputeId, project.paypalCaptureId);
    const result = await provideDisputeEvidence(disputeId, notes);
    recordApproval({ projectId, actionType: 'provide_dispute_evidence', payload, ok: true, result });
    addPayPalEvidence({
      projectId,
      type: 'dispute_event',
      title: `Evidence sent to PayPal for dispute ${disputeId}`,
      source: 'paypal_api',
      record: { request: payload, response: result as Record<string, unknown> },
    });
    refresh(projectId);
    return { ok: true, message: 'PayPal accepted the evidence. A record of what was sent is now on file.' };
  } catch (error) {
    const message = error instanceof PayPalApiError ? `PayPal refused: ${error.message}` : error instanceof Error ? error.message : String(error);
    recordApproval({ projectId, actionType: 'provide_dispute_evidence', payload, ok: false, result: { error: message } });
    return { ok: false, message };
  }
}

