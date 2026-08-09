import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loads `.env.local` into `process.env` for standalone scripts.
 *
 * Next.js loads `.env.local` on its own; `tsx` does not. Without this, every
 * script that needs a Vercel-provisioned variable (`DATABASE_URL`, the blob
 * token) silently sees `undefined` and fails somewhere far from the cause.
 *
 * Values already present in the real environment win, so CI — which injects
 * variables rather than writing a file — is unaffected.
 */
export function loadEnvLocal(cwd = process.cwd()): void {
  let raw: string;
  try {
    raw = readFileSync(join(cwd, '.env.local'), 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
