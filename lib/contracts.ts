import { z } from 'zod';
import { EVIDENCE_TYPES, PROJECT_STATUSES, PROVENANCE_LEVELS } from '@/lib/evidence/types';

// The API contract shared with the frontend. Import these types; never reach into lib/db.
export const evidenceTypeSchema = z.enum(EVIDENCE_TYPES);
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const provenanceSchema = z.enum(PROVENANCE_LEVELS);

export const projectSchema = z.object({
  id: z.string(),
  clientName: z.string(),
  clientEmail: z.string().nullable(),
  scope: z.string(),
  amount: z.number().int(), // minor units
  currency: z.string(),
  status: projectStatusSchema,
  paypalInvoiceId: z.string().nullable(),
  paypalCaptureId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const projectSummarySchema = projectSchema.extend({
  evidenceScore: z.number().int().min(0).max(100),
  missingEvidence: z.array(evidenceTypeSchema),
});

// Public evidence shape: storageRef (internal file path) is intentionally absent.
export const evidenceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: evidenceTypeSchema,
  title: z.string(),
  capturedAt: z.string(),
  source: z.string(),
  sha256: z.string(),
  provenanceLevel: provenanceSchema,
  originalFilename: z.string().nullable(),
  mimeType: z.string().nullable(),
  hasFile: z.boolean(),
  extractedFacts: z.unknown(),
  quotes: z.unknown(),
  createdAt: z.string(),
});

export const completenessSchema = z.object({
  projectId: z.string(),
  category: z.string(),
  presentEvidence: z.array(evidenceTypeSchema),
  missingEvidence: z.array(evidenceTypeSchema),
  provenance: z.record(z.string(), provenanceSchema),
  completeness: z.number().int().min(0).max(100),
});

export const createProjectBody = z.object({
  clientName: z.string().min(1).max(200),
  clientEmail: z.string().email().nullish(),
  scope: z.string().min(1).max(2000),
  amount: z.number().int().min(0), // minor units
  currency: z.string().length(3).transform((s) => s.toUpperCase()),
});

// Status is changed by the system (webhooks, delivery portal), but allow manual override for the demo.
export const patchProjectBody = createProjectBody.partial().extend({ status: projectStatusSchema.optional() });

// Evidence types a freelancer may register by hand. Payment / acknowledgment / completion records
// are created only by trusted server flows, so a client cannot forge them.
export const FREELANCER_EVIDENCE_TYPES = [
  'scope_agreement', 'client_approval', 'message', 'delivery_file', 'delivery_access', 'identity_doc', 'other',
] as const;

export type ProjectDTO = z.infer<typeof projectSchema>;
export type ProjectSummaryDTO = z.infer<typeof projectSummarySchema>;
export type EvidenceDTO = z.infer<typeof evidenceSchema>;
export type CompletenessDTO = z.infer<typeof completenessSchema>;
