'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { mapNoticeAction } from '@/app/actions';
import { nextStepFor } from '@/lib/evidence/labels';
import type { NoticeItem } from '@/lib/ai-tasks';

type ProjectOption = { id: string; title: string; client: string; sample: boolean };

export function NoticeForm({ projects, defaultProjectId, sampleNotice }: { projects: ProjectOption[]; defaultProjectId: string; sampleNotice: string }) {
  const [state, action, pending] = useActionState(mapNoticeAction, null);
  const [notice, setNotice] = useState(sampleNotice);
  const [projectId, setProjectId] = useState(defaultProjectId);
  const isSample = notice === sampleNotice;

  return (
    <>
      <form action={action} className="mt-6 grid gap-3 rounded-lg border border-pp-border bg-white p-5 text-sm">
        <label className="grid gap-1">
          <span className="font-semibold text-pp-navy">Which project is this notice about?</span>
          <select name="projectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border border-pp-border px-3 py-2">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.client}{p.sample ? ' (sample)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="flex items-center gap-2 font-semibold text-pp-navy">
            The notice
            {isSample && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800" title="Written for the demo; not a real PayPal message">
                Simulated sample notice
              </span>
            )}
          </span>
          <textarea name="notice" rows={9} value={notice} onChange={(e) => setNotice(e.target.value)} className="rounded border border-pp-border px-3 py-2 font-mono text-xs" />
        </label>
        <div className="flex items-center gap-4">
          <button disabled={pending || !notice.trim()} className="rounded bg-pp-blue px-4 py-2 font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-50">
            {pending ? 'Reading the notice…' : 'Map to my evidence'}
          </button>
          {!isSample && (
            <button type="button" onClick={() => setNotice(sampleNotice)} className="text-pp-blue hover:underline">
              Use the sample notice
            </button>
          )}
        </div>
        {state?.error && <p className="text-pp-danger">{state.error}</p>}
      </form>

      {state?.items && <Results items={state.items} projectId={projectId} />}
    </>
  );
}

function Results({ items, projectId }: { items: NoticeItem[]; projectId: string }) {
  if (items.length === 0) return <p className="mt-6 text-sm text-pp-muted">No requests found in this notice.</p>;
  const fulfilment = items.filter((i) => i.fulfilment);
  const covered = fulfilment.filter((i) => i.missing.length === 0).length;

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-pp-navy">
        PayPal asks for {items.length} thing{items.length === 1 ? '' : 's'}: {covered} of {fulfilment.length} fulfilment request
        {fulfilment.length === 1 ? '' : 's'} fully covered
        {items.length > fulfilment.length ? `, ${items.length - fulfilment.length} not about fulfilment` : ''}
      </h2>
      <ol className="mt-3 space-y-3">
        {items.map((item, i) => (
          <li key={i} className="rounded-lg border border-pp-border bg-white p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-pp-navy">{item.label}</span>
              <Status item={item} />
            </div>
            <blockquote className="mt-2 border-l-2 border-pp-border pl-3 text-pp-muted">
              “{item.quote}”{' '}
              {item.quoteVerified ? (
                <span className="text-xs font-semibold text-pp-success">quoted word for word</span>
              ) : (
                <span className="text-xs font-semibold text-pp-danger">not found word for word in the notice: check it</span>
              )}
            </blockquote>
            <p className="mt-2">{item.explanation}</p>

            {item.covered.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-pp-muted">On file</p>
                <ul className="mt-1 space-y-1">
                  {item.covered.map((c) => (
                    <li key={c.evidenceId}>
                      <span className="text-pp-success">✓</span> {c.label}: {c.title} <span className="text-xs text-pp-muted">({c.provenance})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {item.missing.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-pp-muted">Missing</p>
                <ul className="mt-1 space-y-1">
                  {item.missing.map((m) => (
                    <li key={m.type}>
                      <span className="text-pp-danger">✗</span> <span className="font-semibold">{m.label}.</span> {nextStepFor(m.type)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-xs text-pp-muted">
              {item.note}{' '}
              <a href={item.source} target="_blank" rel="noreferrer" className="text-pp-blue hover:underline">PayPal source</a>
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm">
        <Link href={`/projects/${projectId}`} className="font-semibold text-pp-blue hover:underline">Open the project to close the gaps →</Link>
      </p>
    </section>
  );
}

function Status({ item }: { item: NoticeItem }) {
  if (!item.fulfilment) return <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">Not fulfilment evidence</span>;
  if (item.missing.length === 0) return <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Covered</span>;
  if (item.covered.length > 0) return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Partly covered</span>;
  return <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-pp-danger">Missing</span>;
}
