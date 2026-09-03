import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RETENTION_DAYS } from '../../src/integrations/artifacts/blob-store';
import { DEFAULT_MAX_DOCUMENT_BYTES } from '../../src/app/api/_lib/document-upload';
import {
  DEFAULT_HTMLCS_TIMEOUT_MS,
  DEFAULT_MAX_PAGES_PER_RUN,
  DEFAULT_MAX_STARTS_PER_TICK,
} from '../../src/domain/run-limits';
import { RUN_STALE_AFTER_MS } from '../../src/domain/run-staleness';
import {
  DEFAULT_MAX_DOCUMENTS_PER_DAY,
  DEFAULT_MAX_DOCUMENTS_PER_HOUR,
  DEFAULT_MAX_PREVIEWS_PER_DAY,
  DEFAULT_MAX_PREVIEWS_PER_HOUR,
  DEFAULT_MAX_RUNS_PER_DAY,
  DEFAULT_MAX_RUNS_PER_HOUR,
} from '../../src/services/run-budget';

/**
 * The numbers `.env.example` shows as defaults are the code's defaults.
 *
 * `CLAUDE.md` sends people to `.env.example` for "every variable with the
 * reasoning behind it", and a default stated there is read as the truth. It was
 * wrong once already, in the same way twice: `ARTIFACT_RETENTION_DAYS=30`
 * against a code default of 90 — the drift `blob-store.ts` records fixing in
 * `deployment-config.ts`, then still present in the third reader, this file.
 * An operator who copied the example and deleted the line kept evidence three
 * times longer than the file told them.
 *
 * Reads the file rather than running anything, the idiom
 * `tests/deploy/failed-runs-workflow.test.ts` established. Every `# VAR=<int>`
 * line has to be in the table below — a new numbered default that nothing
 * checks is how the next drift starts.
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

const CODE_DEFAULTS: Record<string, number> = {
  ARTIFACT_RETENTION_DAYS: DEFAULT_RETENTION_DAYS,
  AUDITOR_MAX_DOCUMENT_BYTES: DEFAULT_MAX_DOCUMENT_BYTES,
  AUDITOR_MAX_PAGES_PER_RUN: DEFAULT_MAX_PAGES_PER_RUN,
  AUDITOR_HTMLCS_TIMEOUT_MS: DEFAULT_HTMLCS_TIMEOUT_MS,
  AUDITOR_MAX_RUNS_PER_HOUR: DEFAULT_MAX_RUNS_PER_HOUR,
  AUDITOR_MAX_RUNS_PER_DAY: DEFAULT_MAX_RUNS_PER_DAY,
  AUDITOR_MAX_PREVIEWS_PER_HOUR: DEFAULT_MAX_PREVIEWS_PER_HOUR,
  AUDITOR_MAX_PREVIEWS_PER_DAY: DEFAULT_MAX_PREVIEWS_PER_DAY,
  AUDITOR_MAX_DOCUMENTS_PER_HOUR: DEFAULT_MAX_DOCUMENTS_PER_HOUR,
  AUDITOR_MAX_DOCUMENTS_PER_DAY: DEFAULT_MAX_DOCUMENTS_PER_DAY,
  CRON_MAX_STARTS_PER_TICK: DEFAULT_MAX_STARTS_PER_TICK,
  AUDITOR_RUN_STALE_SECONDS: RUN_STALE_AFTER_MS / 1000,
};

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

  it('does not offer the retired advisory key', () => {
    // The advisory runs on the Vercel AI Gateway. A file that still names the
    // vendor key sends an operator to set a variable nothing reads.
    expect(EXAMPLE).not.toContain('ANTHROPIC_API_KEY');
    expect(EXAMPLE).toContain('AI_GATEWAY_API_KEY');
    expect(EXAMPLE).toContain('AUDITOR_ADVISORY_MODEL');
  });
});
