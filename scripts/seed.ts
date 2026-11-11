// Seeds six synthetic artist projects with varied evidence. Run: npm run seed   (idempotent: wipes and re-seeds)
import { db } from '../lib/db';
import { createProject } from '../lib/db/projects';
import { createEvidence } from '../lib/db/evidence';
import { calculateSHA256 } from '../lib/evidence/hash';
import type { EvidenceType, ProjectStatus, ProvenanceLevel } from '../lib/evidence/types';

type Seed = {
  id: string; clientName: string; scope: string; amount: number; status: ProjectStatus; has: EvidenceType[];
};

const PROV: Partial<Record<EvidenceType, ProvenanceLevel>> = {
  paypal_payment: 'system_verified', client_acknowledgment: 'client_confirmed',
};
const SEEDS: Seed[] = [
  { id: 'p1', clientName: 'Alex Rivera', scope: 'Character illustration set (3 poses)', amount: 500000, status: 'paid', has: ['scope_agreement', 'paypal_payment', 'delivery_file'] },
  { id: 'p2', clientName: 'Mira Studios', scope: 'Album cover artwork', amount: 1200000, status: 'acknowledged', has: ['scope_agreement', 'paypal_payment', 'delivery_file', 'client_acknowledgment'] },
  { id: 'p3', clientName: 'Jonas Weber', scope: 'Logo redesign with brand sheet', amount: 850000, status: 'invoiced', has: ['scope_agreement'] },
  { id: 'p4', clientName: 'Priya Nair', scope: 'Children\'s book spreads (8)', amount: 2400000, status: 'delivered', has: ['scope_agreement', 'paypal_payment', 'delivery_file', 'message'] },
  { id: 'p5', clientName: 'Chen Lighting Co.', scope: 'Concept art for product launch', amount: 975000, status: 'agreed', has: [] },
  { id: 'p6', clientName: 'Sofia Alvarez', scope: 'Tarot deck illustrations (12 cards)', amount: 1800000, status: 'paid', has: ['paypal_payment', 'message'] },
];

const conn = db();
conn.exec('DELETE FROM evidence_items; DELETE FROM projects;');
for (const s of SEEDS) {
  createProject({ id: s.id, clientName: s.clientName, clientEmail: `${s.clientName.split(' ')[0].toLowerCase()}@example.com`, scope: s.scope, amount: s.amount, currency: 'INR', status: s.status });
  for (const type of s.has) {
    createEvidence({
      projectId: s.id, type, title: `${type.replace(/_/g, ' ')} (${s.clientName})`, source: type === 'paypal_payment' ? 'seed:paypal' : 'seed',
      sha256: calculateSHA256(`seed:${s.id}:${type}`), provenanceLevel: PROV[type] ?? 'self_reported',
    });
  }
}
console.log(`Seeded ${SEEDS.length} projects.`);
