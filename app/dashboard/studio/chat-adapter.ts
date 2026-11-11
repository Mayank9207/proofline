// Chat Completions adapter for AG Studio's AI (works with Gemini and OpenAI).
//
// Studio speaks an OpenAI Responses-shaped protocol (AgLlmRequest in, AG-UI events out). Both
// providers accept OpenAI-style *Chat Completions*, so this adapter translates:
//
//   AgLlmRequest  -> chat { messages, tools, tool_choice, response_format }  -> /api/ai/chat
//   chat SSE chunks -> AG-UI events (text + tool calls) and a final AgLlmResponse
//
// The proxy at app/api/ai/chat picks the provider and adds the key server-side; nothing secret is
// in the browser, and the browser doesn't know which provider answers.
//
// Gemini 3 attaches a "thought signature" to each tool call and requires it back on the next turn.
// Studio's conversation items don't carry it, so this module remembers it by tool-call id. For
// history it never saw (e.g. a thread restored after reload) it sends Gemini's documented
// placeholder, which skips the check.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgAiToolSchema,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from 'ag-studio';
import { sanitizeSchema } from '@/lib/gemini-schema';

type Json = Record<string, any>;

const SKIP_SIGNATURE = 'skip_thought_signature_validator';
const MAX_TOOL_OUTPUT = 12_000;
const signatures = new Map<string, unknown>();

// --- Studio conversation -> chat messages -------------------------------------------------

const textOf = (content: any[] | undefined) =>
  (content ?? [])
    .map((c) => (c.type === 'text' ? c.text : c.type === 'refusal' ? c.refusal : c.type === 'file' ? `[file ${c.filename ?? ''}]` : ''))
    .filter(Boolean)
    .join('\n');

function toMessages(instructions: string | undefined, items: AgAiConversationItem[]): Json[] {
  const messages: Json[] = [];
  if (instructions) messages.push({ role: 'system', content: instructions });
  let assistant: Json | null = null;
  const flush = () => {
    if (assistant) messages.push(assistant);
    assistant = null;
  };

  for (const raw of items) {
    const item = raw as any;
    if (item.kind === 'input' && item.type === 'message') {
      flush();
      const role = item.role === 'system' || item.role === 'developer' ? 'system' : 'user';
      messages.push({ role, content: textOf(item.content) });
    } else if (item.type === 'function_call_output') {
      flush();
      const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
      messages.push({
        role: 'tool',
        tool_call_id: item.callId,
        // Very large tool results (whole schemas, big row sets) make Gemini slow or stall; keep
        // the start, which carries the structure, and say it was cut.
        content: output.length > MAX_TOOL_OUTPUT ? `${output.slice(0, MAX_TOOL_OUTPUT)}\n…[truncated ${output.length - MAX_TOOL_OUTPUT} characters]` : output,
      });
    } else if (item.kind === 'output' && item.type === 'message') {
      assistant ??= { role: 'assistant', content: '' };
      assistant.content = [assistant.content, textOf(item.content)].filter(Boolean).join('\n');
    } else if (item.kind === 'output' && item.type === 'function_call') {
      assistant ??= { role: 'assistant', content: '' };
      const isFirst = !assistant.tool_calls;
      assistant.tool_calls ??= [];
      const extra = signatures.get(item.callId) ?? (isFirst ? { google: { thought_signature: SKIP_SIGNATURE } } : undefined);
      assistant.tool_calls.push({
        id: item.callId,
        type: 'function',
        function: { name: item.name, arguments: item.arguments || '{}' },
        ...(extra ? { extra_content: extra } : {}),
      });
    }
    // Reasoning items are Studio-side only; Gemini keeps its own via signatures.
  }
  flush();
  return messages.map((m) => (m.role === 'assistant' && !m.content ? { ...m, content: null } : m));
}

// Tool schemas are re-sent every turn; clean each one once and reuse it.
const toolCache = new Map<string, Json>();

// Extra guidance for tools a model tends to call with the wrong argument shape.
const TOOL_HINTS: Record<string, string> = {
  delegate_to:
    ' Argument shape: "type" must be an OBJECT naming the agent, for example {"type": {"id": "data"}, "instructions": "..."}. Never pass "type" as a plain string.',
};

function toTools(tools: AgAiToolSchema[] = []) {
  return tools
    .filter((t: any) => t.kind !== 'provided')
    .map((t: any) => {
      const key = `${t.name}|${t.description ?? ''}|${JSON.stringify(t.parameters ?? null)}`;
      let tool = toolCache.get(key);
      if (!tool) {
        tool = {
          type: 'function',
          function: {
            name: t.name,
            description: (t.description ?? '') + (TOOL_HINTS[t.name] ?? ''),
            parameters: sanitizeSchema(t.parameters ?? { type: 'object', properties: {} }),
          },
        };
        toolCache.set(key, tool);
      }
      return tool;
    });
}

// Repair argument shapes a model commonly gets wrong, before Studio validates them.
function repairArgs(name: string, args: Json): Json {
  if (name === 'delegate_to' && typeof args.type === 'string') {
    log('repaired delegate_to target', args.type);
    return { ...args, type: { id: args.type } };
  }
  return args;
}

// Only Studio's own failure shapes count: a `{ success: false, issues }` result, a tool that threw
// ("AI tool 'x' failed: …"), a failed hand-off, or an unknown tool. Plain data that happens to
// contain the word "failed" (a project note, a status) is not a failure.
const STUDIO_FAILURE = /"success"\s*:\s*false|AI tool '[^']*' failed:|Delegation failed:|Unknown tool/;

const isFailedOutput = (output: unknown) => STUDIO_FAILURE.test(typeof output === 'string' ? output : JSON.stringify(output ?? ''));

/**
 * If the conversation ends with the same tool call failing twice in a row, return the tool and
 * reason, so the adapter can stop instead of letting the model repeat it forever.
 */
function repeatedFailure(items: AgAiConversationItem[]): { name: string; reason: string } | null {
  const results = new Map<string, unknown>();
  for (const it of items as any[]) if (it.type === 'function_call_output') results.set(it.callId, it.output);
  const calls = (items as any[]).filter((it) => it.kind === 'output' && it.type === 'function_call');
  const [prev, last] = calls.slice(-2);
  if (!prev || !last) return null;
  if (prev.name !== last.name || (prev.arguments ?? '') !== (last.arguments ?? '')) return null;
  const a = results.get(prev.callId);
  const b = results.get(last.callId);
  if (!isFailedOutput(a) || !isFailedOutput(b)) return null;
  const text = typeof b === 'string' ? b : JSON.stringify(b);
  return { name: last.name, reason: text.replace(/\s+/g, ' ').slice(0, 200) };
}

function toToolChoice(choice: AgLlmRequest['toolChoice']) {
  if (!choice) return undefined;
  if (typeof choice === 'string') return choice;
  return { type: 'function', function: { name: choice.name } };
}

function toResponseFormat(format: AgLlmRequest['responseFormat']) {
  const f = format as any;
  if (!f || f.type === 'text') return undefined;
  return { type: 'json_schema', json_schema: { name: f.name ?? 'response', description: f.description, schema: sanitizeSchema(f.schema) } };
}

// --- Stream translation ---------------------------------------------------------------------
//
// Text streams to Studio as it arrives. Tool calls are buffered and handed over only once the turn
// has ended, complete (name + full arguments), so Studio never sees a partial call. Studio decides
// what to run from `response.output`, so every call must be there too.

type ToolState = { id: string; name: string; args: string };

const log = (...args: unknown[]) => console.log('[Proofline AI]', ...args);

class ChatStreamTranslator {
  readonly messageId = `msg_${Math.random().toString(36).slice(2, 10)}`;
  text = '';
  textOpen = false;
  tools = new Map<number, ToolState>();
  usage: Json | undefined;
  model: string | undefined;

  translate(chunk: Json): AgAiEvent[] {
    const events: AgAiEvent[] = [];
    if (chunk.usage) this.usage = chunk.usage;
    if (chunk.model) this.model = chunk.model;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? choice.message ?? {};
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        if (!this.textOpen) {
          this.textOpen = true;
          events.push({ type: 'TEXT_MESSAGE_START', messageId: this.messageId, role: 'assistant' } as AgAiEvent);
        }
        this.text += delta.content;
        events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: this.messageId, delta: delta.content } as AgAiEvent);
      }
      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? this.tools.size;
        let state = this.tools.get(index);
        if (!state) {
          state = { id: call.id ?? `call_${index}_${Math.random().toString(36).slice(2, 8)}`, name: '', args: '' };
          this.tools.set(index, state);
        }
        if (call.id) state.id = call.id;
        if (call.function?.name) state.name = call.function.name;
        if (typeof call.function?.arguments === 'string') state.args += call.function.arguments;
        if (call.extra_content) signatures.set(state.id, call.extra_content);
      }
    }
    return events;
  }

  /** The tool calls Gemini made, with arguments guaranteed to be valid JSON. */
  calls(): ToolState[] {
    return [...this.tools.values()]
      .filter((t) => t.name)
      .map((t) => {
        let args = t.args.trim() || '{}';
        try {
          args = JSON.stringify(repairArgs(t.name, JSON.parse(args)));
        } catch {
          console.error('[Proofline AI] tool arguments were not valid JSON; sending {} instead', t.name, args.slice(0, 200));
          args = '{}';
        }
        return { ...t, args };
      });
  }

  finish(): { events: AgAiEvent[]; response: AgLlmResponse } {
    const events: AgAiEvent[] = [];
    const calls = this.calls();
    if (!this.textOpen && calls.length === 0) {
      // A turn with neither text nor a tool call would leave Studio with nothing to show or run.
      console.error('[Proofline AI] the model returned an empty turn');
      const note = 'I could not produce an answer for that. Please try again or rephrase the question.';
      this.textOpen = true;
      this.text = note;
      events.push({ type: 'TEXT_MESSAGE_START', messageId: this.messageId, role: 'assistant' } as AgAiEvent);
      events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: this.messageId, delta: note } as AgAiEvent);
    }
    if (this.textOpen) events.push({ type: 'TEXT_MESSAGE_END', messageId: this.messageId } as AgAiEvent);
    for (const t of calls) {
      log('tool call', t.name, t.args.slice(0, 200));
      events.push({ type: 'TOOL_CALL_START', toolCallId: t.id, toolCallName: t.name } as AgAiEvent);
      events.push({ type: 'TOOL_CALL_ARGS', toolCallId: t.id, delta: t.args } as AgAiEvent);
      events.push({ type: 'TOOL_CALL_END', toolCallId: t.id } as AgAiEvent);
    }
    const output: AgAiOutputItem[] = [];
    if (this.text) {
      output.push({
        id: this.messageId,
        kind: 'output',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'text', text: this.text, annotations: [] }],
      } as unknown as AgAiOutputItem);
    }
    for (const t of calls) {
      output.push({ id: t.id, kind: 'output', type: 'function_call', callId: t.id, name: t.name, arguments: t.args, status: 'completed' } as unknown as AgAiOutputItem);
    }
    const response: AgLlmResponse = {
      id: `resp_${Date.now().toString(36)}`,
      createdAt: Math.floor(Date.now() / 1000),
      model: this.model,
      output,
      status: 'completed',
      usage: this.usage
        ? { inputTokens: this.usage.prompt_tokens, outputTokens: this.usage.completion_tokens, totalTokens: this.usage.total_tokens }
        : undefined,
    } as AgLlmResponse;
    return { events, response };
  }
}

// --- Request runner -----------------------------------------------------------------------

// Client-side watchdog: no turn may wait longer than this, whatever happens upstream.
const TURN_WATCHDOG_MS = 100_000;

/** POST one turn and feed every SSE chunk to the translator. Returns the text events to stream. */
async function* fetchTurn(endpoint: string, body: Json, translator: ChatStreamTranslator, signal: AbortSignal): AsyncIterableIterator<AgAiEvent> {
  const res = await fetch(`${endpoint}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = function* (line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    const chunk = JSON.parse(payload);
    if (chunk.error) throw new Error(chunk.error.message ?? 'Model stream error');
    yield* translator.translate(chunk);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) yield* handle(line);
  }
  // The last chunk may arrive without a trailing newline; it often carries the tool call.
  buffer += decoder.decode();
  if (buffer.trim()) yield* handle(buffer);
}

function runRequest(endpoint: string, request: AgLlmRequest, signal?: AbortSignal): AgLlmResponseHandler {
  const prepStarted = performance.now();
  const body: Json = {
    messages: toMessages(request.instructions, request.input),
    stream: true,
    stream_options: { include_usage: true },
  };
  const tools = toTools(request.tools);
  const forced = typeof request.toolChoice === 'object' ? request.toolChoice.name : undefined;
  if (tools.length > 0) {
    body.tools = tools;
    const choice = toToolChoice(request.toolChoice);
    if (choice) body.tool_choice = choice;
  }
  const responseFormat = toResponseFormat(request.responseFormat);
  if (responseFormat) body.response_format = responseFormat;

  let resolveComplete!: (r: AgLlmResponse) => void;
  let rejectComplete!: (e: Error) => void;
  const complete = new Promise<AgLlmResponse>((resolve, reject) => {
    resolveComplete = resolve;
    rejectComplete = reject;
  });
  // Observed here so an abandoned stream never becomes an unhandled rejection.
  void complete.catch(() => {});

  async function* stream(): AsyncIterableIterator<AgAiEvent> {
    // Stop (Studio's signal) or the watchdog, whichever comes first, ends the turn.
    const turnSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(TURN_WATCHDOG_MS)]);
    let translator = new ChatStreamTranslator();
    try {
      const failure = repeatedFailure(request.input);
      if (failure) {
        // Don't ask the model again: it would repeat the same failing call. End the run with a reason.
        console.error('[Proofline AI] stopping: tool failed twice in a row', failure.name, failure.reason);
        translator.text = `I stopped because the step "${failure.name}" failed twice in a row: ${failure.reason}`;
        translator.textOpen = true;
        yield { type: 'TEXT_MESSAGE_START', messageId: translator.messageId, role: 'assistant' } as AgAiEvent;
        yield { type: 'TEXT_MESSAGE_CONTENT', messageId: translator.messageId, delta: translator.text } as AgAiEvent;
        const { events, response } = translator.finish();
        yield* events;
        resolveComplete(response);
        return;
      }
      log('turn start', {
        messages: body.messages.length,
        tools: tools.map((t) => t.function.name).join(','),
        forced: forced ?? null,
        prepMs: Math.round(performance.now() - prepStarted),
      });
      yield* fetchTurn(endpoint, body, translator, turnSignal);
      // Studio sometimes forces a specific tool (e.g. a sub-agent's closing `complete_task`). If the
      // model ignored it, ask once more requiring a tool call, so the sub-agent can finish.
      if (forced && !translator.calls().some((c) => c.name === forced) && !translator.text) {
        log('forced tool not called; retrying with tool_choice=required', forced);
        translator = new ChatStreamTranslator();
        yield* fetchTurn(endpoint, { ...body, tool_choice: 'required' }, translator, turnSignal);
      }
      const { events, response } = translator.finish();
      yield* events;
      log('turn end', { text: translator.text.length, toolCalls: response.output.filter((o) => (o as { type: string }).type === 'function_call').length });
      resolveComplete(response);
    } catch (error) {
      const stopped = signal?.aborted;
      const message = stopped ? 'Stopped.' : turnSignal.aborted ? 'The AI took too long to answer. Please try again.' : error instanceof Error ? error.message : String(error);
      console.error('[Proofline AI] turn failed:', message);
      rejectComplete(new Error(message));
    }
  }

  const iterator = stream();
  return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
}

export function chatAdapter(options: { endpoint?: string } = {}): AgLlmAdapter {
  const endpoint = options.endpoint ?? '/api/ai';
  return {
    executeTurn: (request: AgLlmRequest, opts?: { signal?: AbortSignal }) => runRequest(endpoint, request, opts?.signal),
  };
}
