import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RETENTION_DAYS } from '../../src/integrations/artifacts/blob-store';
import { DEFAULT_MAX_DOCUMENT_BYTES } from '../../src/app/api/_lib/document-upload';
import {
  DEFAULT_EXPECT_TIMEOUT_MS,
  DEFAULT_HTMLCS_TIMEOUT_MS,
  DEFAULT_MAX_PAGES_PER_RUN,
  DEFAULT_MAX_STARTS_PER_TICK,
  DEFAULT_STEP_TIMEOUT_MS,
  DEFAULT_WALK_BUDGET_MS,
} from '../../src/domain/run-limits';
import { RUN_STALE_AFTER_MS } from '../../src/domain/run-staleness';
import {
  DEFAULT_MAX_DISCOVERIES_PER_DAY,
  DEFAULT_MAX_DISCOVERIES_PER_HOUR,
  DEFAULT_MAX_DOCUMENTS_PER_DAY,
  DEFAULT_MAX_DOCUMENTS_PER_HOUR,
  DEFAULT_MAX_PREVIEWS_PER_DAY,
  DEFAULT_MAX_PREVIEWS_PER_HOUR,
  DEFAULT_MAX_RUNS_PER_DAY,
  DEFAULT_MAX_RUNS_PER_HOUR,
} from '../../src/services/run-budget';

/**
 * `.env.example` names every variable the code reads, and the numbers it
 * shows as defaults are the code's defaults.
 *
 * `CLAUDE.md` sends people to `.env.example` for "every variable with the
 * reasoning behind it", and what is stated there is read as the truth. Both
 * halves had drifted: `ARTIFACT_RETENTION_DAYS=30` against a code default of
 * 90 — the same drift `blob-store.ts` records fixing in `deployment-config.ts`
 * — and eight variables the code reads that the file never mentioned, so an
 * operator copying it could not have found them.
 *
 * Reads the tree rather than running it, the idiom
 * `tests/deploy/failed-runs-workflow.test.ts` established. Every `# VAR=<int>`
 * line has to be in the table below, and every name the code reads has to be
 * in the file — in both directions, so a retired variable fails as loudly as
 * a missing one.
 */

const EXAMPLE = readFileSync('.env.example', 'utf8');

/** Each `# NAME=123` line, whether or not it is commented out. */
function statedDefaults(): Map<string, number> {
  const out = new Map<string, number>();
  for (const match of EXAMPLE.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=(\d+)\s*$/gm)) {
    out.set(match[1]!, Number(match[2]));
  }
  return out;
}

/** Every `NAME=` line, with or without a value, commented out or not. */
function statedNames(): Set<string> {
  return new Set([...EXAMPLE.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]!));
}

const CODE_DEFAULTS: Record<string, number> = {
  ARTIFACT_RETENTION_DAYS: DEFAULT_RETENTION_DAYS,
  AUDITOR_MAX_DOCUMENT_BYTES: DEFAULT_MAX_DOCUMENT_BYTES,
  AUDITOR_MAX_PAGES_PER_RUN: DEFAULT_MAX_PAGES_PER_RUN,
  AUDITOR_WALK_BUDGET_MS: DEFAULT_WALK_BUDGET_MS,
  AUDITOR_STEP_TIMEOUT_MS: DEFAULT_STEP_TIMEOUT_MS,
  AUDITOR_EXPECT_TIMEOUT_MS: DEFAULT_EXPECT_TIMEOUT_MS,
  AUDITOR_HTMLCS_TIMEOUT_MS: DEFAULT_HTMLCS_TIMEOUT_MS,
  AUDITOR_MAX_RUNS_PER_HOUR: DEFAULT_MAX_RUNS_PER_HOUR,
  AUDITOR_MAX_RUNS_PER_DAY: DEFAULT_MAX_RUNS_PER_DAY,
  AUDITOR_MAX_PREVIEWS_PER_HOUR: DEFAULT_MAX_PREVIEWS_PER_HOUR,
  AUDITOR_MAX_PREVIEWS_PER_DAY: DEFAULT_MAX_PREVIEWS_PER_DAY,
  AUDITOR_MAX_DOCUMENTS_PER_HOUR: DEFAULT_MAX_DOCUMENTS_PER_HOUR,
  AUDITOR_MAX_DOCUMENTS_PER_DAY: DEFAULT_MAX_DOCUMENTS_PER_DAY,
  AUDITOR_MAX_DISCOVERIES_PER_HOUR: DEFAULT_MAX_DISCOVERIES_PER_HOUR,
  AUDITOR_MAX_DISCOVERIES_PER_DAY: DEFAULT_MAX_DISCOVERIES_PER_DAY,
  CRON_MAX_STARTS_PER_TICK: DEFAULT_MAX_STARTS_PER_TICK,
  AUDITOR_RUN_STALE_SECONDS: RUN_STALE_AFTER_MS / 1000,
};

/**
 * Names the code reads that are nobody's configuration: the platform injects
 * the first group, the operating system and the toolchain own the second.
 * They are listed once, here, rather than padding the example with lines no
 * one should set.
 */
const NOT_CONFIGURATION = new Set([
  'VERCEL',
  'VERCEL_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_OIDC_TOKEN',
  'AWS_LAMBDA_FUNCTION_NAME',
  'NODE_ENV',
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LD_LIBRARY_PATH',
  'JAVA_HOME',
  'SOFFICE_PATH',
]);

/** Built from a reference at runtime (`AUDIT_CREDENTIAL_<REF>_<FIELD>`), so no literal exists. */
const TEMPLATE_PREFIX = 'AUDIT_CREDENTIAL_';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Every variable name the code reads, by the four ways it reads one:
 * `process.env.NAME`, `process.env['NAME']`, `env.NAME` on an `Env`
 * parameter, and a quoted name handed to a helper (`hourEnv:
 * 'AUDITOR_MAX_RUNS_PER_HOUR'`, `intFromEnv(env, 'CRON_SECRET', …)`). The
 * quoted form is held to this project's prefixes and needs the closing quote,
 * so a template fragment such as `AUDITOR_MAX_${…}` cannot match.
 */
function namesTheCodeReads(): Set<string> {
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
    /\benv\.([A-Z][A-Z0-9_]*)/g,
    /['"]((?:AUDITOR|CRON|ARTIFACT|KV_REST|UPSTASH|BLOB|DATABASE|AI_GATEWAY|CHAOS|OPERATOR)_[A-Z0-9_]+)['"]/g,
  ];
  const out = new Set<string>();
  for (const file of [...sourceFiles('src'), ...sourceFiles('scripts')]) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) out.add(match[1]!);
    }
  }
  return out;
}

describe('.env.example', () => {
  const stated = statedDefaults();

  it('states every numbered default this test knows, and no other', () => {
    // Both directions: a default dropped from the file is a variable nobody
    // will find, and a number added to the file is a claim nothing checks.
    expect([...stated.keys()].sort()).toEqual(Object.keys(CODE_DEFAULTS).sort());
  });

  it.each(Object.entries(CODE_DEFAULTS))('%s shows the code default', (name, value) => {
    expect(stated.get(name)).toBe(value);
  });

  it('names every variable the code reads, and nothing the code does not', () => {
    const read = [...namesTheCodeReads()].filter((name) => !NOT_CONFIGURATION.has(name));
    const named = statedNames();

    expect(read.length, 'the extractor found nothing').toBeGreaterThan(20);
    expect(read.filter((name) => !named.has(name)).sort(), 'read by the code, absent from the file').toEqual([]);
    expect(
      [...named].filter((name) => !name.startsWith(TEMPLATE_PREFIX) && !read.includes(name)).sort(),
      'in the file, read by nothing',
    ).toEqual([]);
    // The credential pair is built from a reference at runtime; the file
    // shows the shape with an example reference.
    expect(EXAMPLE).toContain(TEMPLATE_PREFIX);
  });

  it('offers the gateway variables and nowhere names the retired vendor key', () => {
    // The advisory runs on the Vercel AI Gateway. The vendor key was retired
    // from the code and lingered in three documents after it; the third was
    // the trigger for this guard, the same way retention earned its own.
    expect(EXAMPLE).toContain('AI_GATEWAY_API_KEY');
    expect(EXAMPLE).toContain('AUDITOR_ADVISORY_MODEL');

    const documents = ['.env.example', 'CLAUDE.md', 'AGENTS.md', 'docs/env.md', ...sourceFiles('src')];
    for (const file of documents) {
      const text = readFileSync(file, 'utf8');
      for (const retired of ['ANTHROPIC_API_KEY', 'claude-opus-5', '@anthropic-ai']) {
        expect(text.includes(retired), `${file} names ${retired}`).toBe(false);
      }
    }
  });
});
