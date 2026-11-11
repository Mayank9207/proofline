import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/db';

// Files live under data/evidence (never under public/). The stored name is a server-generated id,
// NEVER derived from the user's filename, so path traversal via filenames is impossible.
const ROOT = path.join(DATA_DIR, 'evidence');

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'application/zip',
]);

export async function storeOriginal(projectId: string, evidenceId: string, bytes: Buffer): Promise<string> {
  const dir = path.join(ROOT, projectId.replace(/[^a-zA-Z0-9_-]/g, ''));
  await mkdir(dir, { recursive: true });
  const ref = path.join(dir, evidenceId);
  await writeFile(ref, bytes, { flag: 'wx' }); // exclusive: never overwrite an existing original
  return path.relative(DATA_DIR, ref);
}

export const readOriginal = (ref: string) => readFile(path.join(DATA_DIR, ref));
export const removeOriginal = (ref: string) => rm(path.join(DATA_DIR, ref), { force: true });
