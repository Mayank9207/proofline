// Human wording for the backend's codes (lib/evidence/types.ts): evidence types, provenance levels,
// project statuses, and the next step that closes each kind of gap. Display only; the rules that
// decide what is required live in lib/evidence/rules.ts.

import type { EvidenceType, ProjectStatus, ProvenanceLevel } from './types';

export const EVIDENCE_LABELS: Record<EvidenceType, string> = {
  scope_agreement: 'Agreed scope',
  client_approval: 'Client approval',
  message: 'Client message',
  delivery_file: 'Delivered file',
  delivery_access: 'Delivery access',
  client_acknowledgment: 'Client acknowledgment',
  paypal_payment: 'PayPal payment',
  paypal_completion_record: 'Completion recorded in PayPal',
  dispute_event: 'Dispute event',
  identity_doc: 'Identity document',
  supplier_receipt: 'Supplier receipt',
  other: 'Other',
};

// Strongest first. The dashboard colours cells by these exact strings (app/dashboard/studio/widgets.tsx).
export const PROVENANCE_LABELS: Record<ProvenanceLevel, string> = {
  system_verified: 'System verified',
  client_confirmed: 'Client confirmed',
  self_reported: 'Self reported',
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  agreed: 'Agreed',
  invoiced: 'Payment requested',
  paid: 'Paid',
  delivered: 'Delivered',
  acknowledged: 'Acknowledged',
  completed_recorded: 'Completed',
  closed: 'Closed',
};

export const NEXT_STEP: Partial<Record<EvidenceType, string>> = {
  scope_agreement: 'Paste the brief or message where the client agreed the scope and price.',
  paypal_payment: 'Request payment through PayPal so the payment is linked to this project.',
  delivery_file: 'Upload the delivered work so its fingerprint is recorded.',
  client_acknowledgment: 'Send the client the delivery link and ask them to confirm receipt.',
  paypal_completion_record: 'Record the service as completed in PayPal (releases held funds for services).',
};

export const nextStepFor = (type: EvidenceType) => NEXT_STEP[type] ?? 'Add this evidence.';

// The evidence types the dashboard's matrix shows as columns, in order: everything any project stage
// can require for proof of fulfilment.
export const MATRIX_TYPES: readonly EvidenceType[] = [
  'scope_agreement',
  'paypal_payment',
  'delivery_file',
  'client_acknowledgment',
  'paypal_completion_record',
];
