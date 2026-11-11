// Server-side AI configuration: the single place that decides which provider answers.
//
// Every AI call (the Studio chat via app/api/ai/chat, and lib/llm.ts) speaks OpenAI-style
// Chat Completions, which both providers accept, so the browser never needs to know the provider.
// Gemini wins when GEMINI_API_KEY is set; otherwise OpenAI when an OpenAI key is set; otherwise
// AI is off. Keys are read only here: nothing has a NEXT_PUBLIC_ prefix, so none reaches the
// browser bundle.

export type AiProvider = 'gemini' | 'openai';

export type ChatTarget = {
  provider: AiProvider;
  url: string;
  key: string;
  model: string;
};

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';

let logged = false;

/** Where Chat Completions requests go, or undefined when no key is configured. */
export function chatTarget(): ChatTarget | undefined {
  const geminiKey = process.env.GEMINI_API_KEY;
  // AG_STUDIO_OPENAI_API_KEY wins over the generic OPENAI_API_KEY so a project key in .env.local
  // can't be shadowed by one exported in the shell.
  const openAiKey = process.env.AG_STUDIO_OPENAI_API_KEY || process.env.OPENAI_API_KEY;

  const target: ChatTarget | undefined = geminiKey
    ? { provider: 'gemini', url: GEMINI_URL, key: geminiKey, model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL }
    : openAiKey
      ? {
          provider: 'openai',
          url: OPENAI_URL,
          key: openAiKey,
          model: (process.env.OPENAI_MODELS ?? '').split(',')[0]?.trim() || DEFAULT_OPENAI_MODEL,
        }
      : undefined;

  if (!logged) {
    logged = true;
    console.log(target ? `[AI] provider: ${target.provider}, model: ${target.model}` : '[AI] disabled: set GEMINI_API_KEY in .env.local');
  }
  return target;
}

/** The Studio chat is shown only when a provider is configured. */
export const aiEnabled = () => chatTarget() !== undefined;

/**
 * Adjust a Chat Completions body for the provider. Gemini attaches `extra_content` (its thought
 * signature) to tool calls and needs it back; OpenAI rejects that field, and newer OpenAI models
 * take `max_completion_tokens` instead of `max_tokens`.
 */
export function forProvider(target: ChatTarget, body: Record<string, unknown>, maxTokens: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body, model: target.model };
  if (target.provider === 'gemini') {
    out.max_tokens = maxTokens;
    return out;
  }
  out.max_completion_tokens = maxTokens;
  if (Array.isArray(out.messages)) {
    out.messages = (out.messages as Record<string, unknown>[]).map((m) =>
      Array.isArray(m.tool_calls)
        ? { ...m, tool_calls: (m.tool_calls as Record<string, unknown>[]).map(({ extra_content: _drop, ...call }) => call) }
        : m,
    );
  }
  return out;
}
