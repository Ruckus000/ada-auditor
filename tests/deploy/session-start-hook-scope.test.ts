import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * When the container bootstrap runs is a claim `.claude/settings.json` makes
 * and nothing checks — the same shape as
 * `browser-routes-are-packaged.test.ts`, which exists because
 * `next.config.mjs` knows which routes carry a browser and no code does.
 *
 * A `SessionStart` hook with no `matcher` fires on all four sources:
 * `startup`, `resume`, `clear`, `compact`. This one shipped that way, so every
 * compaction re-ran `npm install` and the Chromium probe. `clear` and
 * `compact` happen inside a container `startup` or `resume` already
 * provisioned, so there is nothing to do — and compaction happens mid-task,
 * which makes it a package install running against the same `node_modules` as
 * whatever else is in flight.
 *
 * `resume` is deliberately kept. A session outlives the container it started
 * in, so a resumed one can land somewhere with nothing installed — the exact
 * condition this hook exists for. Being wrong about that costs every browser
 * path in the repo, dying at `browserType.launch`; being wrong the other way
 * costs about a second.
 *
 * Read as text rather than imported, because it is configuration for a tool
 * outside this repo. eslint ignores `.claude/**` — agent worktrees live there —
 * so this test is the only thing that will ever look at it.
 */

type SessionStartEntry = { matcher?: string; hooks: { type: string; command: string }[] };

const SETTINGS = join('.claude', 'settings.json');

const settings = JSON.parse(readFileSync(SETTINGS, 'utf8')) as {
  hooks?: { SessionStart?: SessionStartEntry[] };
};

const entries = settings.hooks?.SessionStart ?? [];

describe('the session-start hook is scoped to sessions that can be cold', () => {
  it('registers exactly one SessionStart entry, and it runs the bootstrap', () => {
    expect(entries).toHaveLength(1);
    expect(entries[0].hooks.map((hook) => hook.command)).toEqual([
      '$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh',
    ]);
  });

  /**
   * Without this the entry matches everything, which is how it shipped.
   */
  it('names the sources it wants rather than defaulting to all of them', () => {
    expect(entries[0].matcher).toBeDefined();
  });

  it('runs on startup and on resume, because either can be a fresh container', () => {
    const sources = (entries[0].matcher ?? '').split('|');

    expect(sources).toContain('startup');
    expect(sources).toContain('resume');
  });

  it('does not run on clear or compact, where the container is already set up', () => {
    const sources = (entries[0].matcher ?? '').split('|');

    // compact is the one that matters: it fires mid-task.
    expect(sources).not.toContain('compact');
    expect(sources).not.toContain('clear');
  });
});
