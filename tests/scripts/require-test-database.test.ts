import { describe, expect, it } from 'vitest';
import {
  requireTestDatabaseUrl,
  TEST_DATABASE_ENV,
} from '../../scripts/require-test-database';

/**
 * The guard that keeps the store contract off production.
 *
 * Tested here rather than through `vitest.db.config.ts`, because a config file
 * cannot be imported and asserted on — and a refusal nobody exercises is a
 * paragraph, not a gate. The case that matters is the third one: the fix a
 * reader reaches for first is `?? env.DATABASE_URL`, and that is precisely the
 * line that blanked production evidence pointers.
 */
describe('requireTestDatabaseUrl', () => {
  it('returns the dedicated test database when it is set', () => {
    const result = requireTestDatabaseUrl({ [TEST_DATABASE_ENV]: 'postgres://branch/db' });

    expect(result).toEqual({ ok: true, url: 'postgres://branch/db' });
  });

  it('refuses when it is unset, and says how to fix it', () => {
    const result = requireTestDatabaseUrl({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(TEST_DATABASE_ENV);
    expect(result.message).toContain('.env.test.local');
    // The refusal has to explain the danger, not just name a missing key —
    // otherwise the reader's first move is to paste DATABASE_URL in.
    expect(result.message).toContain('clearArtifactsBefore');
    expect(result.message).toContain('claimDueJourneys');
  });

  it('refuses an empty or whitespace value rather than handing it to neon()', () => {
    for (const value of ['', '   ']) {
      expect(requireTestDatabaseUrl({ [TEST_DATABASE_ENV]: value }).ok).toBe(false);
    }
  });

  /**
   * The regression this file exists for. `DATABASE_URL` is production on every
   * developer machine, because `.env.local` is a `vercel env pull` of the
   * production environment.
   */
  it('never falls back to DATABASE_URL', () => {
    const result = requireTestDatabaseUrl({ DATABASE_URL: 'postgres://production/db' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain('postgres://production/db');
  });
});
