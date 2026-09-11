/**
 * Resolves the database the store contract is allowed to touch.
 *
 * The contract suite does **not** run against `DATABASE_URL`, and the
 * difference is not cosmetic. Three of its cases call store methods that take
 * no scope and therefore mutate rows the suite never wrote:
 *
 * - `clearArtifactsBefore` blanks `run_pages.artifacts` for *every* run past
 *   the cutoff. It has already destroyed evidence pointers on production once.
 * - `reconcileStaleRuns` flips *every* `running` row to `failed`.
 * - `claimDueJourneys` stamps `journeys.last_scheduled_at`, so the next real
 *   cron tick skips that client's scheduled audit.
 *
 * The `CONTRACT_PREFIX` machinery confines the rows this suite *inserts*. It
 * cannot confine those three, and no amount of prefixing will.
 *
 * Pure, and separate from `vitest.db.config.ts`, so the refusal is a unit test
 * rather than a paragraph nobody runs — the same reason `split-statements.ts`
 * is its own module. The regression it guards against is somebody adding
 * `?? env.DATABASE_URL` here in six months.
 */

export type TestDatabaseResolution = { ok: true; url: string } | { ok: false; message: string };

export const TEST_DATABASE_ENV = 'DATABASE_URL_TEST';

const REFUSAL = `TEST:DB FAIL: ${TEST_DATABASE_ENV} is not set.

This suite does not run against DATABASE_URL. Three of its cases call store
methods that take no scope, so they mutate rows the suite never wrote:

  clearArtifactsBefore  blanks run_pages.artifacts for EVERY run past the
                        cutoff — it has destroyed production evidence once
  reconcileStaleRuns    flips EVERY \`running\` row to failed/run_timed_out
  claimDueJourneys      stamps journeys.last_scheduled_at, so the next real
                        cron tick skips that client's scheduled audit

Prefixed fixtures confine the rows this suite INSERTS. They do not confine
those three. Point ${TEST_DATABASE_ENV} at a dedicated Neon branch, never at
production:

  1. create a branch (Neon console, or \`neonctl branches create\`)
  2. put its connection string in .env.test.local as ${TEST_DATABASE_ENV}
     — that file, not .env.local, which \`vercel env pull\` overwrites
  3. DATABASE_URL="$${TEST_DATABASE_ENV}" npm run migrate

See docs/env.md.`;

/**
 * `Record`, not `NodeJS.ProcessEnv`. This reads one key, and `ProcessEnv`
 * carries a required `NODE_ENV` — see the `next typegen` note in `CLAUDE.md` —
 * so demanding it would make every test case construct a whole environment to
 * ask about one variable. `process.env` satisfies this.
 */
export function requireTestDatabaseUrl(
  env: Record<string, string | undefined>,
): TestDatabaseResolution {
  const url = env[TEST_DATABASE_ENV];

  // Whitespace-only counts as unset. A key present with an empty value is what
  // a half-written `.env.test.local` looks like, and falling through on it
  // would hand `neon()` an empty string instead of saying what is wrong.
  if (url === undefined || url.trim() === '') {
    return { ok: false, message: REFUSAL };
  }

  return { ok: true, url };
}
