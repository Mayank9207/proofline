import { chatTarget, forProvider } from '@/lib/ai';

// The one AI endpoint the browser talks to. AG Studio's chat adapter
// (app/dashboard/studio/chat-adapter.ts) POSTs an OpenAI-style Chat Completions body here; this
// picks the provider and key from .env.local (lib/ai.ts chatTarget), pins the model, caps output
// and streams the provider's reply straight back. No key ever reaches the browser.

// Bounds the cost of a single turn, whatever the client asks for.
const MAX_OUTPUT_TOKENS = 16_000;
// A turn that takes longer than this is reported as an error instead of spinning forever.
const TURN_TIMEOUT_MS = 90_000;

// Provider overload / transient server errors get two quick retries before the user sees them.
const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1_000, 2_500];

let turnCounter = 0;

const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

/** Wait `ms`, or reject as soon as `signal` aborts (Stop or timeout). */
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

export async function POST(request: Request) {
  const target = chatTarget();
  if (!target) return error(503, 'The AI assistant is not configured: set GEMINI_API_KEY in .env.local.');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Request body must be JSON.');
  }

  const turn = ++turnCounter;
  const payload = JSON.stringify(forProvider(target, body, MAX_OUTPUT_TOKENS));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const started = Date.now();
  console.log(
    `[AI] turn ${turn} start (${target.provider}): ${messages.length} messages (last: ${(messages.at(-1) as { role?: string } | undefined)?.role ?? '-'}), ` +
      `${Array.isArray(body.tools) ? body.tools.length : 0} tools, ${payload.length} bytes` +
      (body.tool_choice ? `, tool_choice=${JSON.stringify(body.tool_choice)}` : ''),
  );

  // Stopping the chat in Studio aborts the browser request, which cancels this one (and any retry
  // wait) too. The timeout covers all attempts together.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]);
  let upstream: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      upstream = await fetch(target.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.key}` },
        body: payload,
        signal,
      });
      // Gemini answers 503 "high demand" in bursts; a short wait usually clears it. Quota errors
      // (429) are not retried: waiting would only spend more of the quota.
      if (!RETRY_STATUSES.has(upstream.status) || attempt >= RETRY_DELAYS_MS.length) break;
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`[AI] turn ${turn} ${target.provider} ${upstream.status}; retrying in ${delay} ms`);
      await upstream.body?.cancel();
      await sleep(delay, signal);
    } catch (e) {
      if (request.signal.aborted) {
        console.log(`[AI] turn ${turn} cancelled by the browser (Stop) after ${Date.now() - started} ms`);
        return error(499, 'Stopped.');
      }
      const timedOut = signal.aborted;
      const cause = e instanceof Error && e.cause ? ` (cause: ${(e.cause as { code?: string; message?: string }).code ?? (e.cause as Error).message})` : '';
      console.error(`[AI] turn ${turn} ${timedOut ? `timed out after ${TURN_TIMEOUT_MS} ms` : `failed: ${String(e)}${cause}`}`);
      return error(504, timedOut ? 'The AI took too long to answer. Try again or ask a narrower question.' : String(e));
    }
  }

  if (!upstream.ok) {
    // Errors come back as JSON (Gemini sometimes wraps them in an array). Log enough to diagnose a
    // rejected tool schema, and hand the adapter a plain { error: { message } }.
    const text = await upstream.text();
    let message = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text);
      const e = Array.isArray(parsed) ? parsed[0]?.error : parsed.error;
      if (e?.message) message = e.message;
    } catch {}
    console.error(`[AI] turn ${turn} ${target.provider} ${upstream.status}: ${message}`);
    return error(upstream.status, `${target.provider} ${upstream.status}: ${message}`);
  }

  // Pass the stream through unchanged, noting what came back so a stuck chat can be diagnosed.
  const decoder = new TextDecoder();
  let bytes = 0;
  let sawText = false;
  let toolCalls = 0;
  const toolNames: string[] = [];
  let finish = '-';
  let promptTokens = '';
  let tail = '';
  const inspect = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      const text = tail + decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      tail = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        if (line.includes('"content":"') && !line.includes('"content":""')) sawText = true;
        toolCalls += (line.match(/"function":\{/g) ?? []).length;
        for (const m of line.matchAll(/"name":"([A-Za-z0-9_.-]+)"/g)) toolNames.push(m[1]);
        const f = line.match(/"finish_reason":"([a-z_]+)"/);
        if (f) finish = f[1];
        const u = line.match(/"prompt_tokens":(\d+)/);
        if (u) promptTokens = u[1];
      }
      controller.enqueue(chunk);
    },
    flush() {
      console.log(
        `[AI] turn ${turn} end: ${Date.now() - started} ms, ${bytes} bytes, finish=${finish}, text=${sawText ? 'yes' : 'no'}, tool calls=${toolCalls}${toolNames.length ? ` [${toolNames.join(', ')}]` : ''}` +
          (promptTokens ? `, prompt tokens=${promptTokens}` : ''),
      );
    },
  });

  return new Response(upstream.body!.pipeThrough(inspect), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream', 'Cache-Control': 'no-store' },
  });
}
