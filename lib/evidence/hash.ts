import { createHash } from 'node:crypto';

// SHA-256 of the exact original bytes. This proves the stored bytes can be re-checked for
// integrity later; it does NOT prove the content itself is genuine or true.
export function calculateSHA256(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

// Hash a JSON-able payload deterministically (sorted keys) - used to bind approvals to an exact action.
export function hashPayload(payload: unknown): string {
  return calculateSHA256(canonicalJson(payload));
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
