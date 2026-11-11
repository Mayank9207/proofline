// Small shared pieces for Proofline's pages.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PROVENANCE, type Provenance } from '@/lib/evidence';

const PROVENANCE_STYLE: Record<Provenance, string> = {
  system_verified: 'bg-green-100 text-green-800',
  client_confirmed: 'bg-blue-100 text-blue-800',
  self_reported: 'bg-amber-100 text-amber-800',
};

export function ProvenanceBadge({ value }: { value: Provenance }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PROVENANCE_STYLE[value] ?? 'bg-gray-100'}`}>
      {PROVENANCE[value] ?? value}
    </span>
  );
}

export function SampleBadge() {
  return (
    <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700" title="Seeded demo data, not from PayPal">
      Sample
    </span>
  );
}

export function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b border-pp-border bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="text-lg font-bold text-pp-navy">
          Proofline
        </Link>
        <nav className="flex gap-5 text-sm font-semibold">
          <Link href="/" className="hover:text-pp-blue">Projects</Link>
          <Link href="/dashboard" className="hover:text-pp-blue">Command center</Link>
          <Link href="/notice" className="hover:text-pp-blue">Map a PayPal notice</Link>
        </nav>
        {children}
      </div>
    </header>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-8 rounded-lg border border-pp-border bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold text-pp-navy">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const money = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
