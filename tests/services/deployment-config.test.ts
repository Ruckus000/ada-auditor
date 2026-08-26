import { describe, expect, it } from 'vitest';
import { readDeploymentConfig, type Env } from '../../src/services/deployment-config';

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
      ANTHROPIC_API_KEY: 'sk-ant-SECRET',
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
      value: 'off',
      degraded: false,
    });
  });

  it('falls back rather than throwing on a nonsensical number', () => {
    expect(
      get({ AUDITOR_MAX_PAGES_PER_RUN: 'lots' }, 'pageCap')?.value,
    ).toBe('20');
    expect(get({ ARTIFACT_RETENTION_DAYS: '-4' }, 'retention')?.value).toBe(
      '30 days',
    );
  });

  it('reports the document toolchain without ever counting it as degraded', () => {
    // Absence is the design of this slice, not a weakness: document stages need
    // a JVM and a serverless function has none. Marking it degraded would add a
    // permanent entry to the operator's warning count for a capability that was
    // never promised on that host — the same reason `/api/ready` reports it and
    // raises no warning.
    const find = (available: boolean) =>
      readDeploymentConfig({}, { documentToolchainAvailable: available }).settings.find(
        (setting) => setting.key === 'documents',
      );

    expect(find(true)?.value).toBe('available');
    expect(find(true)?.degraded).toBe(false);
    expect(find(false)?.value).toBe('not available here');
    expect(find(false)?.degraded).toBe(false);
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
});
