// Converts JSON Schema into the subset Gemini's function declarations and structured output accept:
// drops keywords Gemini rejects, turns `const` into a one-value `enum`, and turns nullable unions
// into `nullable`. Shared by the Studio adapter (browser) and lib/llm.ts (server).
//
// `$ref` / `$defs` are kept as they are, not inlined. Gemini's Chat Completions endpoint accepts
// them (verified 11 Nov with Studio's `execute_query` schema), and inlining is dangerous: that
// schema's expression type refers to itself 7 times, so copying definitions in place grows
// exponentially. An earlier version inlined to depth 8 (about 7^8 copies), which froze the browser
// tab before the request was sent and then crashed it - the "stuck on Thinking, Stop does nothing"
// bug. This version is a single linear walk over the schema.
//
// Known Gemini limit: forcing a tool call (`tool_choice: 'required'` or a named function) with a
// large schema like `execute_query` is rejected with 400 "invalid argument". Unforced calls work.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Json = Record<string, any>;

const DROP_KEYS = new Set([
  '$schema', '$id', '$comment', 'additionalProperties', 'unevaluatedProperties', 'patternProperties',
  'propertyNames', 'not', 'if', 'then', 'else', 'dependentSchemas', 'dependentRequired', 'contains',
  'prefixItems', 'strict', 'examples', 'default',
]);
const KEEP_FORMATS = new Set(['date-time', 'enum']);

const isUndefinedSentinel = (s: any) => s && typeof s === 'object' && Object.keys(s).length === 1 && s.not && Object.keys(s.not).length === 0;

export function sanitizeSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out: Json = {};
  for (const [key, value] of Object.entries(schema)) {
    if (DROP_KEYS.has(key)) continue;
    if (key === 'format' && !KEEP_FORMATS.has(String(value))) continue;
    if (key === 'const') {
      out.enum = [value];
      continue;
    }
    if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((t) => t !== 'null');
      out.type = types[0] ?? 'string';
      if (types.length !== value.length) out.nullable = true;
      continue;
    }
    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      const branches = (value as any[]).filter((b) => !isUndefinedSentinel(b) && !(b?.type === 'null' && Object.keys(b).length === 1));
      const nullable = branches.length !== (value as any[]).length;
      if (branches.length === 1) {
        Object.assign(out, sanitizeSchema(branches[0]));
        if (nullable) out.nullable = true;
      } else if (branches.length > 1) {
        out.anyOf = branches.map(sanitizeSchema);
        if (nullable) out.nullable = true;
      }
      continue;
    }
    if ((key === 'properties' || key === '$defs' || key === 'definitions') && value && typeof value === 'object') {
      // Maps of name -> schema: clean each schema, keep every name.
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeSchema(v)]));
      continue;
    }
    out[key] = value && typeof value === 'object' ? sanitizeSchema(value) : value;
  }
  if (out.properties && !out.type) out.type = 'object';
  if (Array.isArray(out.required) && out.properties) out.required = out.required.filter((k: string) => k in out.properties);
  return out;
}
