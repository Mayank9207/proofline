import { connection } from 'next/server';
import { SAMPLE_NOTICE } from '@/lib/ai-tasks';
import { listPostures } from '@/lib/store';
import { Header } from '@/app/ui';
import { NoticeForm } from './notice-form';

// Paste what PayPal sent (a limitation, a payment hold or a dispute) and see each request mapped to
// the evidence already on file, what is missing, and which requests are not about fulfilment at all.
// The AI only identifies the requests and quotes them; coverage is decided from the ledger.
export default async function NoticePage() {
  await connection();
  const postures = listPostures();
  // Start on the paid project with the most money at risk: the case a notice usually concerns.
  const preferred =
    postures.filter((p) => p.paid && p.gaps.length > 0).sort((a, b) => b.project.amount - a.project.amount)[0] ?? postures[0];
  const projects = postures.map(({ project, sample }) => ({ id: project.id, title: project.title, client: project.clientName, sample }));

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-6 pb-16">
        <div className="mt-8">
          <h1 className="text-2xl font-semibold text-pp-navy">Map a PayPal notice to your evidence</h1>
          <p className="mt-2 max-w-3xl text-pp-muted">
            Paste the email or Resolution Center message PayPal sent. Proofline lists each thing PayPal asks for, quotes the
            notice word for word, and shows what you already have on file for it, what is missing, and which requests are not
            about fulfilment at all.
          </p>
        </div>
        <NoticeForm projects={projects} defaultProjectId={preferred?.project.id ?? ''} sampleNotice={SAMPLE_NOTICE} />
      </main>
    </>
  );
}
