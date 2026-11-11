import Link from 'next/link';
import { connection } from 'next/server';
import { STATUS_LABELS } from '@/lib/evidence/labels';
import { listPostures } from '@/lib/store';
import { createProjectAction } from './actions';
import { Header, SampleBadge, Section, money } from './ui';

export default async function Home() {
  await connection();
  const postures = listPostures();
  const atRisk = postures.filter((x) => x.paid && x.gaps.length > 0);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-6 pb-16">
        <div className="mt-8">
          <h1 className="text-2xl font-semibold text-pp-navy">Your PayPal-paid work, ready to prove</h1>
          <p className="mt-2 max-w-3xl text-pp-muted">
            When PayPal holds a payment, reviews an account or opens a dispute, sellers of digital work are asked for proof of
            fulfillment that usually lives in scattered chats. Proofline keeps that proof on file for every project as the work
            happens, with where each item came from and a fingerprint that shows it hasn’t changed.
          </p>
          <p className="mt-3 text-sm font-semibold text-pp-danger">
            {atRisk.length} paid project{atRisk.length === 1 ? '' : 's'} missing evidence ·{' '}
            {money(atRisk.reduce((s, x) => s + x.project.amount, 0))} at risk
          </p>
        </div>

        <Section title="Projects" aside={<Link className="text-sm font-semibold text-pp-blue" href="/dashboard">Open the command center →</Link>}>
          <table className="w-full text-sm">
            <thead className="text-left text-pp-muted">
              <tr>
                <th className="py-2">Project</th>
                <th>Client</th>
                <th>Status</th>
                <th className="text-right">Price</th>
                <th className="text-right">Evidence</th>
                <th>Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pp-border">
              {postures.map(({ project: p, evidence, gaps, score, sample }) => (
                <tr key={p.id}>
                  <td className="py-2">
                    <Link className="font-semibold text-pp-blue hover:underline" href={`/projects/${p.id}`}>{p.title}</Link>{' '}
                    {sample && <SampleBadge />}
                  </td>
                  <td>{p.clientName}</td>
                  <td>{STATUS_LABELS[p.status]}</td>
                  <td className="text-right">{money(p.amount, p.currency)}</td>
                  <td className="text-right">{evidence.length} · {Math.round(score * 100)}%</td>
                  <td className={gaps.length ? 'text-pp-danger' : 'text-pp-success'}>
                    {gaps.length ? gaps.map((g) => g.label).join(', ') : 'Nothing missing'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="New project">
          <form action={createProjectAction} className="grid grid-cols-2 gap-3 text-sm">
            <input required name="title" placeholder="Project title" className="rounded border border-pp-border px-3 py-2" />
            <input required name="price" type="number" min="1" step="0.01" placeholder="Price (USD)" className="rounded border border-pp-border px-3 py-2" />
            <input required name="clientName" placeholder="Client name" className="rounded border border-pp-border px-3 py-2" />
            <input name="clientEmail" type="email" placeholder="Client email (optional)" className="rounded border border-pp-border px-3 py-2" />
            <textarea required name="scope" rows={3} placeholder="Agreed scope: what you will deliver, by when, how many revisions" className="col-span-2 rounded border border-pp-border px-3 py-2" />
            <button className="col-span-2 justify-self-start rounded bg-pp-blue px-4 py-2 font-semibold text-white hover:bg-pp-blue-dark">Create project</button>
          </form>
        </Section>
      </main>
    </>
  );
}
