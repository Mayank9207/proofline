// Evidence types, provenance, completeness rules and the PayPal request catalogue. Everything here
// is deterministic: the AI explains and extracts, but whether a project's evidence is complete is
// decided by these rules.

import { createHash } from 'node:crypto';

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export const EVIDENCE_TYPES = {
  scope_agreement: 'Agreed scope',
  client_approval: 'Client approval',
  message: 'Client message',
  delivery_file: 'Delivered file',
  client_acknowledgment: 'Client acknowledgment',
  paypal_payment: 'PayPal payment',
  paypal_completion: 'Completion recorded in PayPal',
  dispute_event: 'Dispute event',
  other: 'Other',
} as const;
export type EvidenceType = keyof typeof EVIDENCE_TYPES;

// How much an item can be trusted on its own, strongest first.
export const PROVENANCE = {
  system_verified: 'System verified',
  client_confirmed: 'Client confirmed',
  self_reported: 'Self reported',
} as const;
export type Provenance = keyof typeof PROVENANCE;

export const PROJECT_STATUSES = ['agreed', 'payment_requested', 'paid', 'delivered', 'acknowledged', 'completed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Project = {
  id: string;
  title: string;
  client_name: string;
  client_email: string;
  scope: string;
  price: number;
  currency: string;
  status: ProjectStatus;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  paid_at: string | null;
  delivered_at: string | null;
  delivery_token: string | null;
  created_at: string;
  seeded: number;
};

export type Evidence = {
  id: string;
  project_id: string;
  type: EvidenceType;
  title: string;
  content: string;
  sha256: string;
  source: string;
  provenance: Provenance;
  captured_at: string;
  facts: string | null;
  seeded: number;
};

// What a project needs on file once it reaches a stage. Paid work needs the agreed scope and the
// payment; delivered work also needs the delivery, the client's acknowledgment and a completion
// record in PayPal (which is also what PayPal asks for to release a held payment for a service).
const STAGE_REQUIREMENTS: { from: ProjectStatus; types: EvidenceType[] }[] = [
  { from: 'paid', types: ['scope_agreement', 'paypal_payment'] },
  { from: 'delivered', types: ['delivery_file', 'client_acknowledgment', 'paypal_completion'] },
];

const stageIndex = (s: ProjectStatus) => PROJECT_STATUSES.indexOf(s);

export function requiredTypes(project: Pick<Project, 'status'>): EvidenceType[] {
  return STAGE_REQUIREMENTS.filter((r) => stageIndex(project.status) >= stageIndex(r.from)).flatMap((r) => r.types);
}

export type Gap = { projectId: string; type: EvidenceType; label: string; nextStep: string };

const NEXT_STEP: Partial<Record<EvidenceType, string>> = {
  scope_agreement: 'Paste the brief or message where the client agreed the scope and price.',
  paypal_payment: 'Request payment through PayPal so the payment is linked to this project.',
  delivery_file: 'Upload or paste the delivered work so its fingerprint is recorded.',
  client_acknowledgment: 'Send the client the delivery link and ask them to confirm receipt.',
  paypal_completion: 'Record the service as completed in PayPal (releases held funds for services).',
};

export function gapsFor(project: Project, items: Evidence[]): Gap[] {
  const have = new Set(items.map((e) => e.type));
  return requiredTypes(project)
    .filter((t) => !have.has(t))
    .map((t) => ({ projectId: project.id, type: t, label: EVIDENCE_TYPES[t], nextStep: NEXT_STEP[t] ?? 'Add this evidence.' }));
}

export function completeness(project: Project, items: Evidence[]) {
  const required = requiredTypes(project);
  if (required.length === 0) return 1;
  const have = new Set(items.map((e) => e.type));
  return required.filter((t) => have.has(t)).length / required.length;
}

// --- PayPal request catalogue ------------------------------------------------------
// What each kind of PayPal request is asking for, and which evidence types answer it. Requests that
// are not about fulfilment are listed so the app can say so plainly instead of guessing.

export type RequestKind = {
  id: string;
  label: string;
  fulfilment: boolean;
  answeredBy: EvidenceType[];
  note: string;
  source: string;
};

export const REQUEST_KINDS: RequestKind[] = [
  {
    id: 'proof_of_fulfillment',
    label: 'Proof of fulfillment / delivery',
    fulfilment: true,
    answeredBy: ['scope_agreement', 'delivery_file', 'client_acknowledgment', 'paypal_completion', 'message'],
    note: 'For a service or digital work, show what was agreed, what was delivered and that the client received it.',
    source: 'https://www.paypal.com/us/cshelp/article/how-can-i-release-my-payments-on-hold-help129',
  },
  {
    id: 'service_completion',
    label: 'Confirm the order is completed',
    fulfilment: true,
    answeredBy: ['paypal_completion', 'client_acknowledgment'],
    note: 'PayPal releases a held payment for a service about 7 days after the order is marked completed.',
    source: 'https://www.paypal.com/us/cshelp/article/how-can-i-release-my-payments-on-hold-help129',
  },
  {
    id: 'item_not_received',
    label: 'Dispute: item not received',
    fulfilment: true,
    answeredBy: ['delivery_file', 'client_acknowledgment', 'paypal_completion'],
    note: 'Show the delivery and the client’s confirmation of receipt.',
    source: 'https://developer.paypal.com/disputes/reasons-evidence',
  },
  {
    id: 'not_as_described',
    label: 'Dispute: not as described',
    fulfilment: true,
    answeredBy: ['scope_agreement', 'client_approval', 'delivery_file', 'message'],
    note: 'Show the agreed scope and the client’s approvals along the way. Seller Protection does not cover these claims.',
    source: 'https://www.paypal.com/us/legalhub/paypal/seller-protection',
  },
  {
    id: 'supplier_receipt',
    label: 'Receipt from supplier',
    fulfilment: false,
    answeredBy: [],
    note: 'Not fulfilment evidence. Original commissioned work has no supplier; explain that and attach the scope and work-in-progress instead.',
    source: 'https://www.paypal.com/us/cshelp/article/why-is-my-payment-on-hold-or-unavailable-help126',
  },
  {
    id: 'identity_or_business',
    label: 'Identity or business information',
    fulfilment: false,
    answeredBy: [],
    note: 'Not fulfilment evidence. Provide it directly to PayPal; Proofline does not store identity documents.',
    source: 'https://www.paypal.com/us/cshelp/article/why-is-my-payment-on-hold-or-unavailable-help126',
  },
];
