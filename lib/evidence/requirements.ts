import type { EvidenceType } from './types';

// Maps a PayPal request category to the evidence types that answer it. Deliberately separates
// fulfillment evidence from identity / business documentation. The Notice Mapper uses this.
export const REQUIREMENTS = {
  proof_of_fulfillment: ['scope_agreement', 'paypal_payment', 'delivery_file', 'client_acknowledgment'],
  identity: ['identity_doc'],
  supplier_receipt: ['supplier_receipt'],
} as const satisfies Record<string, readonly EvidenceType[]>;

export type RequirementCategory = keyof typeof REQUIREMENTS;

export const DEFAULT_CATEGORY: RequirementCategory = 'proof_of_fulfillment';

export const isRequirementCategory = (v: string): v is RequirementCategory => v in REQUIREMENTS;
