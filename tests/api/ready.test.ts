import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The readiness probe asks the throttle store whether it answers, so this
 * stands in for the network. `redisAnswers` is what the endpoint is now able
 * to distinguish: a deployment pointed at Redis, and a deployment pointed at
 * Redis that is actually there. Production had the first while reporting the
 * second, and every sign-in returned 500 behind an empty `warnings` array.
 */
const redis = vi.hoisted(() => ({ answers: true }));

vi.mock('../../src/app/api/_lib/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/app/api/_lib/redis')>()),
  createRedisClient: () => ({
    get: async () => {
      if (!redis.answers) throw new Error('getaddrinfo ENOTFOUND kv.test');
      return null;
    },
    incr: async () => 1,
    expire: async () => undefined,
    del: async () => undefined,
  }),
}));

const { GET } = await import('../../src/app/api/ready/route');

describe('GET /api/ready', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;
  const originalChaos = process.env.CHAOS_ENABLED;
  const originalDatabase = process.env.DATABASE_URL;
  const originalKvUrl = process.env.KV_REST_API_URL;
  const originalKvToken = process.env.KV_REST_API_TOKEN;
  const originalSessionSecret = process.env.AUDITOR_SESSION_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test/db';
    redis.answers = true;
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
    if (originalSessionSecret === undefined) delete process.env.AUDITOR_SESSION_SECRET;
    else process.env.AUDITOR_SESSION_SECRET = originalSessionSecret;
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
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
    expect(body.warnings.join(' ')).toContain('counters_in_memory');
  });

  it('reports no warning once everything degradable is configured', async () => {
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    process.env.AUDITOR_SESSION_SECRET = 'session-secret-16chars';
    process.env.CRON_SECRET = 'cron-secret-16chars';
    process.env.KV_REST_API_URL = 'https://kv.test';
    process.env.KV_REST_API_TOKEN = 'kv-token';

    const body = await (await GET()).json();
    expect(body.checks.unlockThrottleDurable).toBe(true);
    expect(body.checks.unlockThrottleReachable).toBe(true);
    expect(body.checks.sessionSecretDedicated).toBe(true);
    expect(body.warnings).toEqual([]);
  });

  it('warns when the configured throttle store does not answer', async () => {
    // The gap that let production report `ready` with an empty warnings array
    // while every sign-in returned 500: the variables were set, and nothing
    // ever asked the host they named whether it was there.
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    process.env.AUDITOR_SESSION_SECRET = 'session-secret-16chars';
    process.env.CRON_SECRET = 'cron-secret-16chars';
    process.env.KV_REST_API_URL = 'https://kv.test';
    process.env.KV_REST_API_TOKEN = 'kv-token';
    redis.answers = false;

    const body = await (await GET()).json();

    expect(body.checks.unlockThrottleDurable).toBe(true);
    expect(body.checks.unlockThrottleReachable).toBe(false);
    expect(body.warnings.join(' ')).toContain('unlock_throttle_unreachable');
    // Still ready: the throttle degrades to memory rather than failing, so
    // this is a hole rather than an outage.
    expect(body.status).toBe('ready');
  });

  // Reported, never gating. A deployment with no operator accounts at all,
  // driven entirely by CI with the run token, is working — not down.
  it('warns but stays ready when the session key is borrowed from the run token', async () => {
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    delete process.env.AUDITOR_SESSION_SECRET;

    const response = await GET();
    const body = await response.json();

    expect(body.checks.sessionSecretDedicated).toBe(false);
    expect(body.warnings.join(' ')).toContain('session_secret_shared_with_run_token');
    expect(response.status).not.toBe(503);
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
  it('warns, because the checklist is "an empty warnings array"', async () => {
    // `docs/env.md` tells the operator to verify exactly that, and chaos was
    // reported in `checks` but produced no warning — so a production
    // deployment able to serve scripted audit outcomes passed the check. The
    // shared `afterEach` restores CHAOS_ENABLED, so this does not clean up
    // after itself and stay dirty when an expectation throws.
    process.env.CHAOS_ENABLED = 'true';

    const body = await (await GET()).json();

    expect(body.checks.chaosEnabled).toBe(true);
    expect(body.warnings.join(' ')).toContain('chaos_enabled');
  });

});
