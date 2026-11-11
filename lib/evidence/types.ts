// Shared domain types for the Proofline backend. The API contracts (lib/contracts.ts) are built from these.

export const EVIDENCE_TYPES = [
  'scope_agreement',
  'client_approval',
  'message',
  'delivery_file',
  'delivery_access',
  'client_acknowledgment',
  'paypal_payment',
  'paypal_completion_record',
  'dispute_event',
  'identity_doc',
  'supplier_receipt',
  'other',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

// How the evidence entered the system. Always assigned server-side, never taken from a client.
export const PROVENANCE_LEVELS = ['system_verified', 'client_confirmed', 'self_reported'] as const;
export type ProvenanceLevel = (typeof PROVENANCE_LEVELS)[number];

export const PROJECT_STATUSES = [
  'agreed',
  'invoiced',
  'paid',
  'delivered',
  'acknowledged',
  'completed_recorded',
  'closed',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Project = {
  id: string;
  clientName: string;
  clientEmail: string | null;
  scope: string;
  amount: number; // integer minor units (e.g. 500000 = 5,000.00)
  currency: string;
  status: ProjectStatus;
  paypalInvoiceId: string | null;
  paypalCaptureId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceItem = {
  id: string;
  projectId: string;
  type: EvidenceType;
  title: string;
  capturedAt: string;
  source: string; // how it arrived: upload | paste | paypal_webhook | delivery_portal | ...
  sha256: string;
  storageRef: string | null; // internal only; never returned by the API
  provenanceLevel: ProvenanceLevel;
  originalFilename: string | null;
  mimeType: string | null;
  extractedFacts: unknown;
  quotes: unknown;
  createdAt: string;
};
