import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rule this file enforces: structured events go through `services/logger`.
 *
 * Five call sites each built their own JSON envelope, and they had already
 * drifted — `persistence/index.ts` keyed its event `event` while everything
 * else keyed it `type`, so a log query filtering on `type` silently missed the
 * warning that says nothing is being persisted. Nothing catches that class of
 * drift except a check on the source, because every one of those lines is
 * individually valid code that passes every other test.
 *
 * This is the same idiom the deployment-config suite already uses to assert no
 * setting renders a secret: grep the tree and assert about what is there.
 */

const ROOTS = ['src', 'scripts'];
const ALLOWED = [join('src', 'services', 'logger.ts')];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('structured logging', () => {
  it('has no hand-built JSON log envelopes outside the logger', () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        if (ALLOWED.includes(file)) continue;

        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (!/console\.(log|warn|error)\(/.test(line)) return;

          // Only a console call whose argument is a JSON envelope is an
          // offender. Plain human-readable console output — the scripts'
          // "CHAOS FAIL: …" lines — is deliberate and stays. The envelope may
          // be on the same line or wrapped onto the next two.
          if (lines.slice(index, index + 3).join('\n').includes('JSON.stringify({')) {
            offenders.push(`${file}:${index + 1}`);
          }
        });
      }
    }

    expect(offenders.join('\n')).toBe('');
  });
});
