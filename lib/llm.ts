// Structured AI calls for Proofline (evidence extraction, notice mapping) with a JSON schema.
// Same Chat Completions path and provider choice as the Studio chat (lib/ai.ts chatTarget);
// keys never leave the server.
//
// Every result is stored by the sha256 of its task + model + input. The same input is answered
// from that store, which makes demos repeatable and lets the app run with AI_MODE=replay and no
// key: recorded answers are served, anything new returns null and the UI says AI is unavailable.

import { getDb, now } from './db';
import { chatTarget, forProvider } from './ai';
import { sanitizeSchema } from './gemini-schema';
import { sha256 } from './evidence';

type JsonSchema = Record<string, unknown>;

export async function structured<T>(task: string, instructions: string, input: string, schema: JsonSchema): Promise<T | null> {
  const target = chatTarget();
  const model = target?.model ?? 'none';
  const key = sha256(JSON.stringify({ task, model, instructions, input }));
  const db = getDb();
  const cached = db.prepare('SELECT output FROM ai_runs WHERE input_sha256 = ?').get(key) as { output: string } | undefined;
  if (cached) return JSON.parse(cached.output) as T;
  if (process.env.AI_MODE === 'replay' || !target) return null;

  // Gemini needs the schema reduced to the subset it accepts; OpenAI takes it strictly as written.
  const responseFormat =
    target.provider === 'gemini'
      ? { type: 'json_schema', json_schema: { name: task, schema: sanitizeSchema(schema) } }
      : { type: 'json_schema', json_schema: { name: task, schema, strict: true } };
  const body = forProvider(
    target,
    {
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
      response_format: responseFormat,
    },
    4000,
  );
  const res = await fetch(target.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[AI] ${task} failed (${target.provider} ${res.status}): ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  // Gemini sometimes wraps JSON in a code fence.
  const text = json.choices?.[0]?.message?.content?.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  if (!text) return null;
  db.prepare('INSERT OR REPLACE INTO ai_runs (input_sha256, task, model, output, created_at) VALUES (?, ?, ?, ?, ?)').run(
    key, task, model, text, now(),
  );
  return JSON.parse(text) as T;
}

/** Keep only quotes that appear word for word in the source; the AI cannot cite what isn't there. */
export const quoteIsVerbatim = (quote: string, source: string) => {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return quote.trim().length > 0 && norm(source).includes(norm(quote));
};
