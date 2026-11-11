import { ZodError } from 'zod';

export const jsonError = (status: number, message: string, details?: unknown) =>
  Response.json({ error: { message, details } }, { status });

// Parse a JSON body with a zod schema, returning either the data or a ready-made 400 response.
export async function parseBody<T>(
  request: Request,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: ZodError } },
): Promise<{ data: T } | { response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { response: jsonError(400, 'Request body must be JSON.') };
  }
  const r = schema.safeParse(raw);
  return r.success ? { data: r.data } : { response: jsonError(400, 'Invalid request body.', r.error.flatten()) };
}
