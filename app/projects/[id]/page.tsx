import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getProject } from '@/lib/db/projects';
import { EVIDENCE_LABELS, STATUS_LABELS } from '@/lib/evidence/labels';
import { readOriginal } from '@/lib/evidence/storage';
import type { EvidenceItem } from '@/lib/evidence/types';
import { disputesForCapture, type Dispute } from '@/lib/paypal';
import { disputeNotes, isSampleEvidence, projectPosture } from '@/lib/store';
import { requestPaymentAction } from '@/app/actions';
import { Header, ProvenanceBadge, SampleBadge, Section, money, when } from '@/app/ui';
import { AddEvidenceForm, ConfirmPayPalAction, DeliveryLinkForm, DisputeAnswerForm } from './forms';

const PREVIEW_CHARS = 400;

/** The start of a stored text original, so the seller sees what was filed. */
async function preview(e: EvidenceItem): Promise<string | null> {
  if (!e.storageRef || e.mimeType !== 'text/plain') return null;
  try {
    const text = (await readOriginal(e.storageRef)).toString('utf8');
    return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
  } catch {
    return null;
  }
}

type Statement = { speaker: string; quote: string; meaning: string };
/** Disputes on the project's payment, read from PayPal on each visit; a failed read is shown, not hidden. */
async function loadDisputes(captureId: string | null): Promise<{ items: Dispute[]; error?: string } | null> {
  if (!captureId) return null;
  try {
    return { items: await disputesForCapture(captureId) };
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : String(error) };
  }
}

const words = (code?: string) => (code ? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ') : '');

const statementsOf = (facts: unknown): Statement[] =>
  Array.isArray(facts) ? facts.filter((s): s is Statement => !!s && typeof s === 'object' && typeof (s as Statement).quote === 'string') : [];

export default async function ProjectPage({ params, searchParams }: PageProps<'/projects/[id]'>) {
  await connection();
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();
  const { evidence, gaps, score, sample } = projectPosture(project);
  const previews = await Promise.all(evidence.map(preview));
  const paidNow = (await searchParams).paid === '1';
  const disputes = await loadDisputes(project.paypalCaptureId);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-6 pb-16">
        <div className="mt-8 flex items-start justify-between gap-6">
          <div>
            <p className="text-sm text-pp-muted">
              <Link href="/" className="hover:underline">Projects</Link> / {project.clientName}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-pp-navy">
              {project.title} {sample && <SampleBadge />}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-pp-muted">{project.scope}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">{money(project.amount, project.currency)}</p>
            <p className="text-sm text-pp-muted">{STATUS_LABELS[project.status]}</p>
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
            {!project.paypalCaptureId && !sample && (
              <form action={requestPaymentAction.bind(null, project.id)}>
                <button className="rounded bg-pp-blue px-3 py-1.5 font-semibold text-white hover:bg-pp-blue-dark">
                  {project.paypalOrderId ? 'Open PayPal checkout again' : 'Request payment through PayPal'}
                </button>
              </form>
            )}
            <DeliveryLinkForm projectId={project.id} />
            {project.paypalCaptureId && (
              <>
                <ConfirmPayPalAction projectId={project.id} kind="completion" captureId={project.paypalCaptureId} />
                <ConfirmPayPalAction projectId={project.id} kind="chargeback" captureId={project.paypalCaptureId} />
              </>
            )}
          </div>
          {sample && (
            <p className="mt-3 text-xs text-pp-muted">Sample projects have no real PayPal payment. Create a project to try the PayPal steps.</p>
          )}
        </Section>

        {disputes && (
          <Section title={`PayPal disputes (${disputes.items.length})`}>
            {disputes.error ? (
              <p className="text-sm text-pp-danger">Could not read disputes from PayPal: {disputes.error}</p>
            ) : disputes.items.length === 0 ? (
              <p className="text-sm text-pp-muted">No disputes on this payment.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {disputes.items.map((d) => (
                  <li key={d.dispute_id} className="rounded border border-pp-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{words(d.reason)}</span>
                      <span className="rounded bg-pp-canvas px-2 py-0.5 text-xs">{words(d.status)}</span>
                    </div>
                    <p className="mt-1 text-xs text-pp-muted">
                      {d.dispute_id}
                      {d.dispute_amount ? ` · ${d.dispute_amount.value} ${d.dispute_amount.currency_code}` : ''}
                      {d.create_time ? ` · opened ${when(d.create_time)}` : ''}
                      {d.seller_response_due_date ? ` · respond by ${when(d.seller_response_due_date)}` : ''}
                    </p>
                    {d.status !== 'RESOLVED' && <DisputeAnswerForm projectId={project.id} disputeId={d.dispute_id} draft={disputeNotes(project, evidence)} />}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        <Section title={`Evidence on file (${evidence.length})`}>
          <ol className="space-y-3 text-sm">
            {evidence.map((e, i) => (
              <li key={e.id} className="rounded border border-pp-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{e.title}</span>
                  <span className="text-pp-muted">· {EVIDENCE_LABELS[e.type] ?? e.type}</span>
                  <ProvenanceBadge value={e.provenanceLevel} />
                  {isSampleEvidence(e) && <SampleBadge />}
                </div>
                <p className="mt-1 text-xs text-pp-muted">
                  {when(e.capturedAt)} · source: {e.source}
                  {e.originalFilename ? ` · ${e.originalFilename}` : ''} · sha256 <code title={e.sha256}>{e.sha256.slice(0, 16)}…</code>
                </p>
                {previews[i] && <p className="mt-2 whitespace-pre-wrap break-words text-xs">{previews[i]}</p>}
                <Statements items={statementsOf(e.extractedFacts)} />
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

function Statements({ items }: { items: Statement[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-pp-blue pl-3 text-xs">
      {items.map((s, i) => (
        <li key={i}>
          <q className="font-semibold">{s.quote}</q> <span className="text-pp-muted">— {s.speaker}. {s.meaning}</span>
        </li>
      ))}
    </ul>
  );
}
