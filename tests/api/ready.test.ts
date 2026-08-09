import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '../../src/app/api/ready/route';

describe('GET /api/ready', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;
  const originalChaos = process.env.CHAOS_ENABLED;
  const originalDatabase = process.env.DATABASE_URL;
  const originalKvUrl = process.env.KV_REST_API_URL;
  const originalKvToken = process.env.KV_REST_API_TOKEN;

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test/db';
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    if (originalChaos === undefined) delete process.env.CHAOS_ENABLED;
    else process.env.CHAOS_ENABLED = originalChaos;
    if (originalDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabase;
    if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalKvUrl;
    if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalKvToken;
  });

  it('is ready when AUDITOR_RUN_TOKEN meets MIN_TOKEN_LENGTH', async () => {
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ready');
    expect(body.checks.auditorRunTokenConfigured).toBe(true);
  });

  it('is not ready without a run store', async () => {
    // `createRunStore()` throws without DATABASE_URL, which fails closed — but
    // it fails on the first audit someone tries, long after the deploy that
    // broke it. Readiness is what turns that into a deploy-time signal.
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    delete process.env.DATABASE_URL;

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.runStoreConfigured).toBe(false);
    // The token is fine — a caller must be able to tell these two apart, or an
    // operator goes looking for the wrong problem.
    expect(body.checks.auditorRunTokenConfigured).toBe(true);
  });

  it('warns about an in-memory unlock throttle without failing readiness', async () => {
    // Redis used to be required because the run store needed it. Nothing
    // forces it to exist now, so a deploy can reach production with the
    // throttle counting attempts per instance. That is a real weakness and
    // should be visible — but it is not an outage, and serving 503 to every
    // operator over it would be worse than the weakness.
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ready');
    expect(body.checks.unlockThrottleDurable).toBe(false);
    expect(body.warnings.join(' ')).toContain('unlock_throttle_in_memory');
  });

  it('reports no warning once the throttle is durable', async () => {
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    process.env.KV_REST_API_URL = 'https://kv.test';
    process.env.KV_REST_API_TOKEN = 'kv-token';

    const body = await (await GET()).json();
    expect(body.checks.unlockThrottleDurable).toBe(true);
    expect(body.warnings).toEqual([]);
  });

  it('is not ready when the configured token is too short for auth', async () => {
    process.env.AUDITOR_RUN_TOKEN = 'short';

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.auditorRunTokenConfigured).toBe(false);
  });

  it('is not ready when the token is missing', async () => {
    delete process.env.AUDITOR_RUN_TOKEN;

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.auditorRunTokenConfigured).toBe(false);
  });
});
