import { describe, expect, it } from 'vitest';
import { readDeploymentConfig, type Env } from '../../src/services/deployment-config';
import { DEFAULT_RETENTION_DAYS } from '../../src/integrations/artifacts/blob-store';
import {
  DEFAULT_MAX_PAGES_PER_RUN,
  DEFAULT_WALK_BUDGET_MS,
} from '../../src/domain/run-limits';

function get(env: Env, key: string) {
  return readDeploymentConfig(env).settings.find((setting) => setting.key === key);
}

describe('readDeploymentConfig', () => {
  it('never puts a secret in a value', () => {
    // Every one of these is read for presence, and the screen renders `value`
    // verbatim. A leak here is a token on a web page.
    const env = {
      DATABASE_URL: 'postgres://user:hunter2@host/db',
      BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_SECRET',
      AI_GATEWAY_API_KEY: 'gw-SECRET',
      KV_REST_API_URL: 'https://kv.example',
      AUDITOR_RUN_TOKEN: 'a-very-secret-token',
    };

    const values = readDeploymentConfig(env).settings.map((setting) => setting.value).join(' ');

    expect(values).not.toContain('hunter2');
    expect(values).not.toContain('SECRET');
    expect(values).not.toContain('a-very-secret-token');
    expect(values).not.toContain('kv.example');
  });

  it('calls out a run store that is not durable', async () => {
    expect(get({}, 'database')?.degraded).toBe(true);
    expect(get({ AUDITOR_STORE: 'memory' }, 'database')).toMatchObject({
      value: 'in memory',
      degraded: true,
    });
    expect(
      get({ DATABASE_URL: 'postgres://host/db' }, 'database'),
    ).toMatchObject({ value: 'Postgres', degraded: false });
  });

  it('treats chaos injection as a degradation, not a feature', () => {
    // A production deployment that accepts scripted audit results can be told
    // what to report. That belongs on the warning list.
    expect(get({ CHAOS_ENABLED: 'true' }, 'chaos')?.degraded).toBe(true);
    expect(get({}, 'chaos')?.degraded).toBe(false);
  });

  it('does not treat a missing advisory key as a degradation', () => {
    // Advisory findings never gate a build, and their absence is never a run
    // failure. Flagging it would train an operator to ignore the warnings.
    expect(get({}, 'advisory')).toMatchObject({
      value: 'off (unreachable)',
      degraded: false,
    });
  });

  it('falls back rather than throwing on a nonsensical number', () => {
    expect(get({ AUDITOR_MAX_PAGES_PER_RUN: 'lots' }, 'pageCap')?.value).toBe(
      String(DEFAULT_MAX_PAGES_PER_RUN),
    );
    expect(get({ ARTIFACT_RETENTION_DAYS: '-4' }, 'retention')?.value).toBe(
      `${DEFAULT_RETENTION_DAYS} days`,
    );
  });

  it('reports the retention the pruner actually applies', () => {
    // This screen said 30 days while `blob-store.ts` kept evidence for 90, on
    // the one screen whose stated purpose is to show where the truth lives — so
    // an operator read that a client's evidence expires three times sooner than
    // it does. Asserted against the exported constant rather than a literal,
    // because a literal here is what let the two drift in the first place.
    expect(get({}, 'retention')?.value).toBe(`${DEFAULT_RETENTION_DAYS} days`);
    expect(get({ ARTIFACT_RETENTION_DAYS: '14' }, 'retention')?.value).toBe('14 days');
  });

  it('reports the walk budget as the first of two bounds', () => {
    // A page cap cannot bound a duration, so the screen that says what this
    // deployment is configured to do has to name both. Seconds rather than
    // milliseconds: the reader is deciding whether it fits inside a function.
    expect(get({}, 'walkBudget')?.value).toBe(`${DEFAULT_WALK_BUDGET_MS / 1000}s`);
    expect(get({ AUDITOR_WALK_BUDGET_MS: '60000' }, 'walkBudget')?.value).toBe('60s');
    expect(get({ AUDITOR_WALK_BUDGET_MS: 'soon' }, 'walkBudget')?.value).toBe(
      `${DEFAULT_WALK_BUDGET_MS / 1000}s`,
    );
    expect(get({}, 'walkBudget')?.degraded).toBe(false);
  });

  it('accepts a whole number written with a decimal point', () => {
    // The local parser demanded `Number.isInteger`, so `20.0` read as unset
    // here while the runner floored it and honoured it — the screen disagreeing
    // with the thing it describes.
    expect(get({ AUDITOR_MAX_PAGES_PER_RUN: '25.0' }, 'pageCap')?.value).toBe('25');
  });

  it('reports the document toolchain without ever counting it as degraded', () => {
    // Absence is the design of this slice, not a weakness: document stages need
    // a JVM and a serverless function has none. Marking it degraded would add a
    // permanent entry to the operator's warning count for a capability that was
    // never promised on that host — the same reason `/api/ready` reports it and
    // raises no warning.
    const find = (java: boolean, soffice: boolean) =>
      readDeploymentConfig({}, {
        documentToolchainAvailable: java,
        documentConverterAvailable: soffice,
      }).settings.find((setting) => setting.key === 'documents');

    expect(find(true, true)?.value).toBe('available');
    expect(find(false, false)?.value).toBe('not available here');
    // Naming which half is missing is the difference between installing the
    // right thing and guessing.
    expect(find(true, false)?.value).toBe('PDF stages only');
    expect(find(true, false)?.detail).toMatch(/LibreOffice/);
    expect(find(false, true)?.value).toBe('converter only');
    expect(find(false, true)?.detail).toMatch(/JDK/);

    // Never degraded, in any combination: absence is the design of this slice.
    for (const [j, s2] of [[true, true], [true, false], [false, true], [false, false]] as const) {
      expect(find(j, s2)?.degraded, `${j}/${s2}`).toBe(false);
    }
    // The unanswered case renders as absent rather than throwing or claiming
    // availability nothing checked.
    expect(readDeploymentConfig({}).settings.find((s) => s.key === 'documents')?.value).toBe(
      'not available here',
    );
  });

  it('counts what is degraded', () => {
    const clean = readDeploymentConfig({
      DATABASE_URL: 'postgres://host/db',
      BLOB_READ_WRITE_TOKEN: 'x',
      KV_REST_API_URL: 'https://kv',
      AUDITOR_SESSION_SECRET: 'session-secret-16chars',
      CRON_SECRET: 'cron-secret-16chars',
    });

    expect(clean.degradedCount).toBe(0);
    expect(readDeploymentConfig({}).degradedCount).toBeGreaterThan(0);
  });

  it('tells apart advisory off-by-decision from off-by-unreachable', () => {
    // Conflating the two sends an operator hunting for a missing key that was
    // never the reason it is off.
    expect(get({ AI_GATEWAY_API_KEY: 'gw', AUDITOR_ADVISORY_MODEL: 'off' }, 'advisory')?.value).toBe(
      'off (by configuration)',
    );
    expect(get({}, 'advisory')?.value).toBe('off (unreachable)');
    expect(get({ AI_GATEWAY_API_KEY: 'gw' }, 'advisory')?.value).toBe('on');
  });
});

describe('the passkey row', () => {
  function row(env: Record<string, string | undefined>) {
    return readDeploymentConfig(env).settings.find((setting) => setting.key === 'passkeys');
  }

  it('is off, and not degraded, when neither variable is set', () => {
    const passkeys = row({});
    expect(passkeys?.value).toBe('off');
    // Password sign-in is a supported way to run, and every preview deploy is
    // expected to look like this. Flagging it would cry wolf everywhere.
    expect(passkeys?.degraded).toBe(false);
  });

  it('is available when the id is the origin host', () => {
    const passkeys = row({
      AUDITOR_RP_ID: 'console.example.com',
      AUDITOR_RP_ORIGIN: 'https://console.example.com',
    });
    expect(passkeys?.value).toBe('available');
    expect(passkeys?.degraded).toBe(false);
  });

  /**
   * The state this row was rewritten for. Both variables set and disagreeing
   * used to render as "off" — identical to a deployment that never wanted
   * passkeys — so an operator who had configured them had nowhere to learn
   * they had not.
   */
  it.each([
    ['a scheme in the id', 'https://console.example.com', 'https://console.example.com'],
    ['an origin with no scheme', 'console.example.com', 'console.example.com'],
    ['an unrelated id', 'somewhere-else.test', 'https://console.example.com'],
    ['only the id set', 'console.example.com', undefined],
  ])('flags %s as misconfigured, not off', (unused, id, origin) => {
    const passkeys = row({ AUDITOR_RP_ID: id, AUDITOR_RP_ORIGIN: origin });
    expect(passkeys?.value).toBe('misconfigured');
    expect(passkeys?.degraded).toBe(true);
    expect(passkeys?.detail).toContain('do not agree');
  });
});
