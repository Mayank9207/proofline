import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { getProject, projectPosture } from '@/lib/store';
import { EVIDENCE_TYPES } from '@/lib/evidence';
import { createDeliveryLinkAction, requestPaymentAction } from '@/app/actions';
import { Header, ProvenanceBadge, SampleBadge, Section, money, when } from '@/app/ui';
import { AddEvidenceForm, ConfirmPayPalAction } from './forms';

export default async function ProjectPage({ params, searchParams }: PageProps<'/projects/[id]'>) {
  await connection();
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();
  const { items, gaps, score } = projectPosture(project);
  const paidNow = (await searchParams).paid === '1';
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-6 pb-16">
        <div className="mt-8 flex items-start justify-between gap-6">
          <div>
            <p className="text-sm text-pp-muted">
              <Link href="/" className="hover:underline">Projects</Link> / {project.client_name}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-pp-navy">
              {project.title} {project.seeded === 1 && <SampleBadge />}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-pp-muted">{project.scope}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">{money(project.price, project.currency)}</p>
            <p className="text-sm capitalize text-pp-muted">{project.status.replace('_', ' ')}</p>
            <p className={`mt-1 text-sm font-semibold ${gaps.length ? 'text-pp-danger' : 'text-pp-success'}`}>
              Evidence {Math.round(score * 100)}% complete
            </p>
          </div>
        </div>

        {paidNow && <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800">Payment captured through PayPal and recorded as evidence.</p>}

        <Section title={gaps.length ? `Missing evidence (${gaps.length})` : 'Nothing missing'}>
          {gaps.length === 0 ? (
            <p className="text-sm text-pp-success">Everything required at this stage is on file.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {gaps.map((g) => (
                <li key={g.type}>
                  <span className="font-semibold text-pp-danger">{g.label}.</span> {g.nextStep}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Actions">
          <div className="flex flex-wrap items-start gap-4 text-sm">
            {!project.paypal_capture_id && project.seeded === 0 && (
              <form action={requestPaymentAction.bind(null, project.id)}>
                <button className="rounded bg-pp-blue px-3 py-1.5 font-semibold text-white hover:bg-pp-blue-dark">
                  {project.paypal_order_id ? 'Open PayPal checkout again' : 'Request payment through PayPal'}
                </button>
              </form>
            )}
            {project.delivery_token ? (
              <div>
                <p className="font-semibold">Client delivery link</p>
                <code className="text-xs break-all">{`${origin}/d/${project.delivery_token}`}</code>
              </div>
            ) : (
              <form action={createDeliveryLinkAction.bind(null, project.id)}>
                <button className="rounded border border-pp-blue px-3 py-1.5 font-semibold text-pp-blue hover:bg-pp-highlight">Create client delivery link</button>
              </form>
            )}
            {project.paypal_capture_id && (
              <>
                <ConfirmPayPalAction projectId={project.id} kind="completion" captureId={project.paypal_capture_id} />
                <ConfirmPayPalAction projectId={project.id} kind="chargeback" captureId={project.paypal_capture_id} />
              </>
            )}
          </div>
          {project.seeded === 1 && (
            <p className="mt-3 text-xs text-pp-muted">Sample projects have no real PayPal payment. Create a project to try the PayPal steps.</p>
          )}
        </Section>

        <Section title={`Evidence on file (${items.length})`}>
          <ol className="space-y-3 text-sm">
            {items.map((e) => (
              <li key={e.id} className="rounded border border-pp-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{e.title}</span>
                  <span className="text-pp-muted">· {EVIDENCE_TYPES[e.type] ?? e.type}</span>
                  <ProvenanceBadge value={e.provenance} />
                  {e.seeded === 1 && <SampleBadge />}
                </div>
                <p className="mt-1 text-xs text-pp-muted">
                  {when(e.captured_at)} · source: {e.source} · sha256 <code title={e.sha256}>{e.sha256.slice(0, 16)}…</code>
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-xs">{e.content.length > 400 ? `${e.content.slice(0, 400)}…` : e.content}</p>
                {e.facts && <Facts facts={e.facts} />}
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Add evidence">
          <AddEvidenceForm projectId={project.id} />
        </Section>
      </main>
    </>
  );
}

function Facts({ facts }: { facts: string }) {
  const statements = JSON.parse(facts) as { speaker: string; quote: string; meaning: string }[];
  if (!Array.isArray(statements) || statements.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-pp-blue pl-3 text-xs">
      {statements.map((s, i) => (
        <li key={i}>
          <q className="font-semibold">{s.quote}</q> <span className="text-pp-muted">— {s.speaker}. {s.meaning}</span>
        </li>
      ))}
    </ul>
  );
}
