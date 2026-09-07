import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rule this file enforces: nothing in the document-remediation spike
 * formats a child-process failure by hand.
 *
 * `[V]` Every runner in that directory reported a failed child as
 * `(e.stderr?.toString() || String(e)).split('\n')[0]` — nine call sites. That
 * reads only `stderr`, so a tool printing its reason to **stdout** is reported
 * as nothing, and it keeps only the first line, so what survives is
 * `Command failed: <argv>` — the command line the reader already has. It is the
 * defect `scripts/run-command.ts` exists for, in a directory that file cannot
 * reach.
 *
 * ## Why a second guard, and why only this one
 *
 * `exec-failures-are-not-swallowed.test.ts` is about `scripts/` and the
 * `promisify(execFile)` it owns; its whole doc-comment is written in those
 * terms. This is a different root, a different formatter and a different call
 * shape (`execFileSync`), so it gets its own file rather than three more
 * conditionals in that one.
 *
 * ESLint is deliberately **not** extended to cover this. `experiments/**` sits
 * in `eslint.config.mjs` `ignores` on purpose — "the trade a spike is allowed
 * to make" — and CLAUDE.md says so in as many words. A test can hold one
 * invariant here without revoking that exemption wholesale.
 *
 * ## What this cannot see
 *
 * A runner that catches a failure and reports nothing at all. The signature
 * matched below is hand-formatting, not silence; a bare `catch {}` is a
 * different bug and needs a different check.
 */

const ROOT = join('experiments', 'document-remediation');

/** The module allowed to describe a child failure for the runners. */
const FORMATTER = join(ROOT, 'exec-failure.mjs');

/**
 * The blind corpus gets its own, because it may import only `node:` builtins
 * and its own siblings — `blind-corpus-keys-are-independent.test.ts` enforces
 * that so the answer keys can never be derived by the product. Reaching for
 * `../exec-failure.mjs` from there fails that test, and the bright line is
 * worth more than the duplication.
 */
const CORPUS_FORMATTER = join(ROOT, 'blind-corpus', 'failure-line.mjs');

/**
 * Its tests, which quote the old broken expression on purpose. Exempted by
 * path for the same reason `FORMATTER` is: the definition and the proof of the
 * rule both have to be able to name what the rule forbids.
 */
const FORMATTER_TEST = join(ROOT, 'exec-failure.test.mjs');

/**
 * Generated corpora and run output, not source. Skipped for determinism and
 * speed — these hold thousands of PDFs and JSON reports.
 */
const ARTEFACT_DIRS =
  /^(out|corpus|holdout|real|word-corpus|vendor|node_modules|dist|classes)/;

/**
 * Reading a caught error's `stderr` is the swallow's signature. `stdout` is
 * NOT banned: `blind-corpus/verify.mjs` reads `error.stdout` on qpdf's exit 3,
 * which is a successful read reported as a warning, and consuming that output
 * is the opposite of discarding it.
 */
const HAND_FORMATTING = /\.stderr\b/;

/** `String(e).split(…)` in any of its shapes, including the parenthesised one. */
const FIRST_LINE_OF_ERROR = /String\(\s*(?:e|err|error)\s*\)[\s\S]{0,40}?\.split\(/;

/**
 * Deliberate exceptions, each with the reason it is safe. Matched in BOTH
 * directions below: an entry that stops matching anything fails, so a stale
 * exemption cannot quietly cover whatever is added to that file next.
 */
const ALLOWED_HAND_FORMATTING: Array<{ file: string; snippet: string; why: string }> = [];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (ARTEFACT_DIRS.test(entry)) continue;
      out.push(...sourceFiles(path));
    } else if (/\.m[jt]s$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('child-process failures in the document-remediation spike', () => {
  const files = sourceFiles(ROOT);
  const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
  const formatters = new Set([FORMATTER, FORMATTER_TEST, CORPUS_FORMATTER]);
  const scanned = [...sources].filter(([file]) => !formatters.has(file));

  it('scans a non-empty tree that contains the formatter', () => {
    // A scan that examined nothing must not pass.
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain(FORMATTER);
    expect(files).toContain(CORPUS_FORMATTER);
  });

  it('extracts real call sites, so a broken scan cannot pass vacuously', () => {
    const callers = scanned.filter(([, text]) => text.includes('execFileSync(')).length;
    expect(callers).toBeGreaterThan(0);
  });

  it('has no hand-formatted child failure outside the formatter', () => {
    const offenders = scanned
      .filter(([file, text]) => {
        if (!HAND_FORMATTING.test(text) && !FIRST_LINE_OF_ERROR.test(text)) return false;
        return !ALLOWED_HAND_FORMATTING.some(
          (allowed) => allowed.file === file && text.includes(allowed.snippet),
        );
      })
      .map(([file]) => file);

    expect(
      offenders.join('\n'),
      'Use describeExecFailure()/summariseExecFailure() from ' +
        `${FORMATTER}. Reading only \`stderr\` discards a tool that printed its ` +
        'reason to stdout, and the first line of String(error) is the argv.',
    ).toBe('');
  });

  it('keeps the formatter reachable rather than orphaned', () => {
    for (const formatter of ['exec-failure.mjs', 'failure-line.mjs']) {
      const importers = scanned.filter(([, text]) => text.includes(formatter)).length;
      expect(importers, `${formatter} is imported by nothing`).toBeGreaterThan(0);
    }
  });

  it('has an allowlist with no entry that matches nothing', () => {
    const stale = ALLOWED_HAND_FORMATTING.filter(
      (allowed) => !(sources.get(allowed.file) ?? '').includes(allowed.snippet),
    ).map((allowed) => `${allowed.file}  ${allowed.snippet}`);

    expect(
      stale.join('\n'),
      'This allowlist entry matches no code. If the call was removed, remove the ' +
        'entry; if it was rewritten, re-key it and re-check that it is still safe.',
    ).toBe('');
  });
});
