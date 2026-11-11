// Seeds six synthetic artist projects with varied evidence. Run: npm run seed   (idempotent: wipes and re-seeds)
import { db } from '../lib/db';
import { createProject } from '../lib/db/projects';
import { createEvidence } from '../lib/db/evidence';
import { calculateSHA256 } from '../lib/evidence/hash';
import type { EvidenceType, ProjectStatus, ProvenanceLevel } from '../lib/evidence/types';

type Seed = {
  id: string; title: string; clientName: string; scope: string; amount: number; status: ProjectStatus; has: EvidenceType[];
};

const PROV: Partial<Record<EvidenceType, ProvenanceLevel>> = {
  paypal_payment: 'system_verified', paypal_completion_record: 'system_verified', client_acknowledgment: 'client_confirmed',
};
const SEEDS: Seed[] = [
  { id: 'p1', title: 'Character illustration set', clientName: 'Alex Rivera', scope: 'Character illustration set (3 poses)', amount: 50000, status: 'paid', has: ['scope_agreement', 'paypal_payment', 'delivery_file'] },
  { id: 'p2', title: 'Album cover artwork', clientName: 'Mira Studios', scope: 'Album cover artwork', amount: 120000, status: 'acknowledged', has: ['scope_agreement', 'paypal_payment', 'delivery_file', 'client_acknowledgment', 'paypal_completion_record'] },
  { id: 'p3', title: 'Logo redesign', clientName: 'Jonas Weber', scope: 'Logo redesign with brand sheet', amount: 85000, status: 'invoiced', has: ['scope_agreement'] },
  { id: 'p4', title: "Children's book spreads", clientName: 'Priya Nair', scope: 'Children\'s book spreads (8)', amount: 240000, status: 'delivered', has: ['scope_agreement', 'paypal_payment', 'delivery_file', 'message'] },
  { id: 'p5', title: 'Launch concept art', clientName: 'Chen Lighting Co.', scope: 'Concept art for product launch', amount: 97500, status: 'agreed', has: [] },
  { id: 'p6', title: 'Tarot deck illustrations', clientName: 'Sofia Alvarez', scope: 'Tarot deck illustrations (12 cards)', amount: 180000, status: 'paid', has: ['paypal_payment', 'message'] },
];

// Days before seeding at which each kind of evidence was captured, so the timeline and paid dates read
// like real work: agreed first, then paid, messages, delivered, acknowledged, completion recorded.
const DAYS_AGO: Partial<Record<EvidenceType, number>> = {
  scope_agreement: 30, paypal_payment: 24, message: 20, delivery_file: 14, client_acknowledgment: 12, paypal_completion_record: 10,
};
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const conn = db();
conn.exec('DELETE FROM evidence_items; DELETE FROM projects;');
for (const [i, s] of SEEDS.entries()) {
  createProject({ id: s.id, title: s.title, clientName: s.clientName, clientEmail: `${s.clientName.split(' ')[0].toLowerCase()}@example.com`, scope: s.scope, amount: s.amount, currency: 'USD', status: s.status });
  for (const type of s.has) {
    createEvidence({
      projectId: s.id, type, title: `${type.replace(/_/g, ' ')} (${s.clientName})`, source: type === 'paypal_payment' ? 'seed:paypal' : 'seed',
      capturedAt: daysAgo((DAYS_AGO[type] ?? 18) - i), // later projects started a day later each
      sha256: calculateSHA256(`seed:${s.id}:${type}`), provenanceLevel: PROV[type] ?? 'self_reported',
    });
  }
}
console.log(`Seeded ${SEEDS.length} projects.`);
