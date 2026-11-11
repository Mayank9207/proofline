import type { ProvenanceLevel } from './types';

// Provenance is decided by HOW evidence entered the system, never by what a client or the AI claims.
export type IngestChannel =
  | 'freelancer_upload' // file the freelancer uploads
  | 'freelancer_paste' // text the freelancer pastes
  | 'delivery_portal' // client acknowledgment via the delivery link
  | 'paypal_verified'; // PayPal API / signature-verified webhook

const MAP: Record<IngestChannel, ProvenanceLevel> = {
  freelancer_upload: 'self_reported',
  freelancer_paste: 'self_reported',
  delivery_portal: 'client_confirmed',
  paypal_verified: 'system_verified',
};

export const provenanceFor = (channel: IngestChannel): ProvenanceLevel => MAP[channel];
