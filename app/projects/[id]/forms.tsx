'use client';

import { useActionState, useState } from 'react';
import { addEvidenceAction, recordCompletionAction, sandboxChargebackAction, type ActionResult } from '@/app/actions';
import { EVIDENCE_TYPES } from '@/lib/evidence';

function Message({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <p className={`mt-2 text-sm ${state.ok ? 'text-pp-success' : 'text-pp-danger'}`}>{state.message}</p>;
}

export function AddEvidenceForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(addEvidenceAction.bind(null, projectId), null);
  return (
    <form action={action} className="grid gap-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <select name="type" defaultValue="auto" className="rounded border border-pp-border px-3 py-2">
          <option value="auto">Let AI classify it</option>
          {Object.entries(EVIDENCE_TYPES)
            .filter(([k]) => !['paypal_payment', 'paypal_completion', 'dispute_event'].includes(k))
            .map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
        </select>
        <input name="title" placeholder="Title (optional)" className="rounded border border-pp-border px-3 py-2" />
      </div>
      <textarea
        name="content"
        rows={4}
        placeholder="Paste a chat, an email or a note: the client agreeing the scope, approving a draft, confirming delivery…"
        className="rounded border border-pp-border px-3 py-2"
      />
      <label className="text-pp-muted">
        Or a delivered file (Proofline keeps its sha256 fingerprint, not the file):{' '}
        <input type="file" name="file" className="ml-2" />
      </label>
      <button disabled={pending} className="justify-self-start rounded bg-pp-blue px-4 py-2 font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-50">
        {pending ? 'Saving…' : 'Add evidence'}
      </button>
      <Message state={state} />
    </form>
  );
}

// PayPal writes need an explicit confirm that shows exactly what will be sent.
export function ConfirmPayPalAction({
  projectId,
  kind,
  captureId,
}: {
  projectId: string;
  kind: 'completion' | 'chargeback';
  captureId: string;
}) {
  const [open, setOpen] = useState(false);
  const run = kind === 'completion' ? recordCompletionAction : sandboxChargebackAction;
  const [state, action, pending] = useActionState(async () => run(projectId), null);
  const payload =
    kind === 'completion'
      ? `POST /v1/shipping/trackers-batch\n{ "trackers": [{ "transaction_id": "${captureId}", "status": "COMPLETED" }] }`
      : `POST /v2/customer-support/process-chargeback (sandbox only)\n{ "transaction_id": "${captureId}" }`;
  const label = kind === 'completion' ? 'Record service completed in PayPal' : 'Simulate a chargeback (sandbox)';

  return (
    <div className="text-sm">
      {!open ? (
        <button onClick={() => setOpen(true)} className="rounded border border-pp-blue px-3 py-1.5 font-semibold text-pp-blue hover:bg-pp-highlight">
          {label}
        </button>
      ) : (
        <form action={action} className="rounded border border-pp-border bg-pp-canvas p-3">
          <p className="font-semibold">This will send to PayPal:</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{payload}</pre>
          <div className="mt-3 flex gap-2">
            <button disabled={pending} className="rounded bg-pp-blue px-3 py-1.5 font-semibold text-white disabled:opacity-50">
              {pending ? 'Sending…' : 'Approve and send'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded px-3 py-1.5 text-pp-muted">
              Cancel
            </button>
          </div>
          <Message state={state} />
        </form>
      )}
    </div>
  );
}
