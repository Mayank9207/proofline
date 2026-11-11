'use client';

import { use, useEffect, useState } from 'react';

type Delivery = {
  scope: string;
  clientName: string;
  files: { id: string; title: string; filename: string | null; sha256: string; hasFile: boolean }[];
  acknowledgedAt: string | null;
};

// Client-facing delivery page. Public: it only ever talks to /api/delivery/[token]/...
export default function DeliverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/delivery/${token}`)
      .then(async (r) => (r.ok ? setDelivery((await r.json()).delivery) : setError((await r.json()).error.message)))
      .catch(() => setError('Could not load this delivery.'));
  }, [token]);

  async function acknowledge() {
    setBusy(true);
    const r = await fetch(`/api/delivery/${token}/acknowledge`, { method: 'POST' });
    if (r.ok) setDelivery((d) => d && { ...d, acknowledgedAt: new Date().toISOString() });
    else setError((await r.json()).error.message);
    setBusy(false);
  }

  if (error) return <main className="mx-auto max-w-xl p-8 text-red-700">{error}</main>;
  if (!delivery) return <main className="mx-auto max-w-xl p-8">Loading…</main>;

  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Delivery for {delivery.clientName}</h1>
        <p className="text-gray-600">{delivery.scope}</p>
      </header>
      <ul className="divide-y rounded border">
        {delivery.files.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <div className="font-medium">{f.title}</div>
              <div className="truncate font-mono text-xs text-gray-500">SHA-256 {f.sha256}</div>
            </div>
            {f.hasFile && (
              <a className="text-blue-700 underline" href={`/api/delivery/${token}/files/${f.id}`}>Download</a>
            )}
          </li>
        ))}
      </ul>
      {delivery.acknowledgedAt ? (
        <p className="rounded bg-green-50 p-3 text-green-800">
          You acknowledged this delivery on {new Date(delivery.acknowledgedAt).toLocaleString()}. Thank you.
        </p>
      ) : (
        <div className="space-y-2">
          <button onClick={acknowledge} disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">
            I acknowledge receiving this delivery
          </button>
          <p className="text-xs text-gray-500">This records that the delivery was acknowledged through this private link, with a timestamp.</p>
        </div>
      )}
    </main>
  );
}
