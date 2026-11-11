// What each kind of PayPal request (limitation, hold or dispute notice) asks for, and which evidence
// types answer it. Used by the notice mapper (lib/ai-tasks.ts): the AI only names the request kind;
// coverage is decided here from the ledger. Requests that are not about fulfilment are listed so the
// app can say so plainly instead of guessing. Complements lib/evidence/requirements.ts, which the
// completeness score uses.

import type { EvidenceType } from './types';

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
    answeredBy: ['scope_agreement', 'delivery_file', 'client_acknowledgment', 'paypal_completion_record', 'message'],
    note: 'For a service or digital work, show what was agreed, what was delivered and that the client received it.',
    source: 'https://www.paypal.com/us/cshelp/article/how-can-i-release-my-payments-on-hold-help129',
  },
  {
    id: 'service_completion',
    label: 'Confirm the order is completed',
    fulfilment: true,
    answeredBy: ['paypal_completion_record', 'client_acknowledgment'],
    note: 'PayPal releases a held payment for a service about 7 days after the order is marked completed.',
    source: 'https://www.paypal.com/us/cshelp/article/how-can-i-release-my-payments-on-hold-help129',
  },
  {
    id: 'item_not_received',
    label: 'Dispute: item not received',
    fulfilment: true,
    answeredBy: ['delivery_file', 'client_acknowledgment', 'paypal_completion_record'],
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
