// Sample data: a fictional freelance illustrator with six commissions at different stages. Every
// row is marked seeded = 1 and shown as "Sample" in the UI. Names and emails are invented.

import type { DatabaseSync } from 'node:sqlite';
import { sha256, type EvidenceType, type Provenance, type ProjectStatus } from './evidence';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

type SeedEvidence = [type: EvidenceType, title: string, content: string, provenance: Provenance, daysAgo: number];

type SeedProject = {
  id: string;
  title: string;
  client: [name: string, email: string];
  scope: string;
  price: number;
  status: ProjectStatus;
  paidDaysAgo?: number;
  deliveredDaysAgo?: number;
  evidence: SeedEvidence[];
};

const PROJECTS: SeedProject[] = [
  {
    id: 'prj_logo',
    title: 'Logo and brand mark',
    client: ['Dana Whitfield', 'dana@harbor-coffee.example'],
    scope: 'Primary logo, monochrome variant and favicon. Two revision rounds. Delivery as SVG and PNG within 10 days.',
    price: 450,
    status: 'completed',
    paidDaysAgo: 24,
    deliveredDaysAgo: 15,
    evidence: [
      ['scope_agreement', 'Brief accepted by client', 'Dana: "Confirmed — logo, mono version and favicon, two revisions, $450. Go ahead."', 'client_confirmed', 26],
      ['paypal_payment', 'PayPal payment captured', 'Capture of USD 450.00 for project prj_logo.', 'system_verified', 24],
      ['client_approval', 'Concept B approved', 'Dana: "Concept B is the one. Please refine the wordmark spacing."', 'self_reported', 19],
      ['delivery_file', 'harbor-logo-final.zip', 'harbor-logo-final.zip: logo.svg, logo-mono.svg, favicon.png', 'system_verified', 15],
      ['client_acknowledgment', 'Client confirmed receipt', 'Delivery link opened and receipt confirmed by the client.', 'client_confirmed', 15],
      ['paypal_completion', 'Order marked completed in PayPal', 'Service recorded as completed on the PayPal transaction.', 'system_verified', 15],
    ],
  },
  {
    id: 'prj_character',
    title: 'Character illustration (full body)',
    client: ['Rui Tanaka', 'rui.tanaka@example.com'],
    scope: 'One full-body character illustration with simple background, 4000px, commercial use for a game pitch deck.',
    price: 320,
    status: 'delivered',
    paidDaysAgo: 12,
    deliveredDaysAgo: 2,
    evidence: [
      ['scope_agreement', 'Commission terms from DM', 'Rui: "Full body, simple bg, 4000px, commercial use OK — $320 works."', 'self_reported', 14],
      ['paypal_payment', 'PayPal payment captured', 'Capture of USD 320.00 for project prj_character.', 'system_verified', 12],
      ['message', 'Sketch feedback', 'Rui: "Love the pose. Can the jacket be dark green?"', 'self_reported', 8],
      ['delivery_file', 'rui-character-final.png', 'rui-character-final.png 4000x5600', 'system_verified', 2],
    ],
  },
  {
    id: 'prj_hero',
    title: 'Website hero illustration',
    client: ['Priya Raman', 'priya@lumen-studio.example'],
    scope: 'Wide hero illustration for a landing page, light theme, delivered as layered PSD and web PNG.',
    price: 600,
    status: 'paid',
    paidDaysAgo: 3,
    evidence: [
      ['paypal_payment', 'PayPal payment captured', 'Capture of USD 600.00 for project prj_hero.', 'system_verified', 3],
    ],
  },
  {
    id: 'prj_ui',
    title: 'Mobile app UI redesign (3 screens)',
    client: ['Marco Bellini', 'marco@tiny-habits.example'],
    scope: 'Redesign onboarding, home and settings screens in Figma, one revision round.',
    price: 900,
    status: 'acknowledged',
    paidDaysAgo: 20,
    deliveredDaysAgo: 6,
    evidence: [
      ['scope_agreement', 'Signed scope document', 'Scope: onboarding, home, settings; one revision; $900; Figma file delivery.', 'client_confirmed', 22],
      ['paypal_payment', 'PayPal payment captured', 'Capture of USD 900.00 for project prj_ui.', 'system_verified', 20],
      ['delivery_file', 'Figma file shared', 'Figma file "Tiny Habits redesign v2" shared with client.', 'self_reported', 6],
      ['client_acknowledgment', 'Client confirmed receipt', 'Delivery link opened and receipt confirmed by the client.', 'client_confirmed', 5],
    ],
  },
  {
    id: 'prj_album',
    title: 'Album cover artwork',
    client: ['Noor Haddad', 'noor.h@example.com'],
    scope: 'Square album cover, 3000px, painted style, text-free version included.',
    price: 380,
    status: 'delivered',
    paidDaysAgo: 9,
    deliveredDaysAgo: 4,
    evidence: [
      ['paypal_payment', 'PayPal payment captured', 'Capture of USD 380.00 for project prj_album.', 'system_verified', 9],
      ['message', 'Client asked for warmer colours', 'Noor: "Could the sky be warmer, more orange?"', 'self_reported', 6],
    ],
  },
  {
    id: 'prj_emotes',
    title: 'Twitch emote pack (6 emotes)',
    client: ['Sam Okafor', 'sam.okafor@example.com'],
    scope: 'Six emotes at 112/56/28px, transparent PNG, one revision per emote.',
    price: 180,
    status: 'agreed',
    evidence: [
      ['scope_agreement', 'Terms agreed in chat', 'Sam: "6 emotes, all three sizes, $180 — deal."', 'self_reported', 1],
    ],
  },
];

export function seed(db: DatabaseSync) {
  const insertProject = db.prepare(`INSERT INTO projects
    (id, title, client_name, client_email, scope, price, currency, status, paid_at, delivered_at, created_at, seeded)
    VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, 1)`);
  const insertEvidence = db.prepare(`INSERT INTO evidence
    (id, project_id, type, title, content, sha256, source, provenance, captured_at, seeded)
    VALUES (?, ?, ?, ?, ?, ?, 'sample', ?, ?, 1)`);

  db.exec('BEGIN');
  try {
    for (const p of PROJECTS) {
      insertProject.run(
        p.id, p.title, p.client[0], p.client[1], p.scope, p.price, p.status,
        p.paidDaysAgo === undefined ? null : daysAgo(p.paidDaysAgo),
        p.deliveredDaysAgo === undefined ? null : daysAgo(p.deliveredDaysAgo),
        daysAgo(30),
      );
      p.evidence.forEach(([type, title, content, provenance, ago], i) => {
        insertEvidence.run(`${p.id}_ev${i}`, p.id, type, title, content, sha256(content), provenance, daysAgo(ago));
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
