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

/**
 * Whether a JVM and the compiled document stages exist is a question about the
 * filesystem, so it is stubbed here — otherwise this test would assert one
 * thing on a machine that has run `npm run build:documents` and another on a
 * machine that has not.
 */
const documents = vi.hoisted(() => ({ available: true, converter: true }));

vi.mock('../../src/integrations/documents/java-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/integrations/documents/java-runtime')>()),
  isDocumentToolchainAvailable: () => documents.available,
}));

vi.mock('../../src/integrations/documents/libreoffice-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/integrations/documents/libreoffice-runtime')>()),
  isDocumentConverterAvailable: () => documents.converter,
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
  const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalOidcToken = process.env.VERCEL_OIDC_TOKEN;

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test/db';
    redis.answers = true;
    documents.available = true;
    documents.converter = true;
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
    if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
    if (originalGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = originalGatewayKey;
    if (originalOidcToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = originalOidcToken;
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
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';

    const body = await (await GET()).json();
    expect(body.checks.unlockThrottleDurable).toBe(true);
    expect(body.checks.unlockThrottleReachable).toBe(true);
    expect(body.checks.sessionSecretDedicated).toBe(true);
    expect(body.checks.blobConfigured).toBe(true);
    expect(body.warnings).toEqual([]);
  });

  it('warns when nothing is configured to store evidence', async () => {
    // The reason this check exists, and it is not "a setting is missing".
    //
    // `createEvidenceBundle` decides a page's evidence is complete from the
    // *local* artifact paths, which the runner always writes. Without a blob
    // token `getArtifactStore()` returns the no-op store, so nothing is
    // uploaded and no URL is recorded — and the run still reports
    // `evidenceStatus: 'complete'` while every later read of that evidence
    // answers `pruned`. A conformance report whose evidence cannot be produced
    // is the failure this product exists to prevent, and until now nothing
    // anywhere said the store was missing.
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    process.env.AUDITOR_SESSION_SECRET = 'session-secret-16chars';
    process.env.CRON_SECRET = 'cron-secret-16chars';
    process.env.KV_REST_API_URL = 'https://kv.test';
    process.env.KV_REST_API_TOKEN = 'kv-token';
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const response = await GET();
    const body = await response.json();

    // Reported, never gating: a deployment auditing to local disk is a working
    // control plane, and 503 would take the console down over it.
    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks.blobConfigured).toBe(false);
    expect(body.warnings.join(' ')).toContain('evidence_storage_not_configured');
  });

  it('reports whether the advisory is configured without warning about it', async () => {
    // Deferred on purpose, so it is a fact to read rather than a complaint to
    // scroll past. A warnings array that always has something in it is one
    // nobody reads, which is how the retention sweep failed eleven nights —
    // the same reason `chaosEnabled` is a plain check.
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    process.env.AUDITOR_SESSION_SECRET = 'session-secret-16chars';
    process.env.CRON_SECRET = 'cron-secret-16chars';
    process.env.KV_REST_API_URL = 'https://kv.test';
    process.env.KV_REST_API_TOKEN = 'kv-token';
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;

    const body = await (await GET()).json();

    expect(body.checks.advisoryConfigured).toBe(false);
    expect(body.warnings).toEqual([]);
  });

  it('stays ready with an empty warnings array when no document toolchain exists', async () => {
    // This is the production state, permanently: document stages need a JVM and
    // a serverless function has none. So it must be a fact in `checks` and
    // nothing more — a warning here would never clear, and the deploy checklist
    // tells an operator to look for `warnings` being empty. The same reasoning
    // as `advisoryConfigured` above, with a stronger case, because this one
    // cannot be switched on by setting a variable.
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    process.env.AUDITOR_SESSION_SECRET = 'session-secret-16chars';
    process.env.CRON_SECRET = 'cron-secret-16chars';
    process.env.KV_REST_API_URL = 'https://kv.test';
    process.env.KV_REST_API_TOKEN = 'kv-token';
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    documents.available = false;
    documents.converter = false;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks.documentToolchainAvailable).toBe(false);
    expect(body.checks.documentConverterAvailable).toBe(false);
    expect(body.warnings).toEqual([]);
  });

  it('reports the document toolchain when it is present', async () => {
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    documents.available = true;

    const body = await (await GET()).json();

    expect(body.checks.documentToolchainAvailable).toBe(true);
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
