import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The passkey routes, driven end to end against a stubbed verifier.
 *
 * The crypto itself is not re-tested here — `@simplewebauthn` owns it, and a
 * real assertion needs a real authenticator, which the hydration suite
 * provides with a virtual one. What this file pins is everything *around* the
 * signature: who is allowed to ask, what a refusal says, which cookie comes
 * back, and the ways this feature could quietly damage the sign-in path that
 * already worked.
 */

const verifyAuthentication = vi.fn();
const verifyRegistration = vi.fn();

vi.mock('../../src/integrations/webauthn/verify', () => ({
  buildAuthenticationOptions: async () => ({ challenge: 'test-challenge' }),
  buildRegistrationOptions: async () => ({ challenge: 'test-challenge' }),
  verifyAuthentication: (...args: unknown[]) => verifyAuthentication(...args),
  verifyRegistration: (...args: unknown[]) => verifyRegistration(...args),
}));

const optionsRoute = await import('../../src/app/api/console/passkey/options/route');
const sessionRoute = await import('../../src/app/api/console/passkey/session/route');
const registerOptionsRoute = await import(
  '../../src/app/api/console/passkey/register/options/route'
);
const registerRoute = await import('../../src/app/api/console/passkey/register/route');
const manageRoute = await import('../../src/app/api/console/passkey/route');
const passwordRoute = await import('../../src/app/api/console/session/route');

const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);
const { hashPassword } = await import('../../src/domain/operator-credentials');
const { CONSOLE_COOKIE, readOperatorSessionClaims, createOperatorSessionValue } = await import(
  '../../src/app/api/_lib/console-session'
);

const RUN_TOKEN = 'run-token-long-enough-1234';
const SESSION_SECRET = 'session-secret-long-enough-32ch';
const EMAIL = 'sam@example.test';
const PASSWORD = 'a-perfectly-fine-password';
const CREDENTIAL_ID = 'cred-sam-laptop';

const original = {
  token: process.env.AUDITOR_RUN_TOKEN,
  secret: process.env.AUDITOR_SESSION_SECRET,
  rpId: process.env.AUDITOR_RP_ID,
  rpOrigin: process.env.AUDITOR_RP_ORIGIN,
};

let platform: InstanceType<typeof MemoryPlatformStore>;
/** One throttle bucket per test — see the note in `console-session-route.test.ts`. */
let bucket = 100;

function headers(extra: Record<string, string> = {}) {
  return {
    'content-type': 'application/json',
    origin: 'https://auditor.test',
    'x-vercel-forwarded-for': `10.1.0.${bucket}`,
    ...extra,
  };
}

function post(path: string, body?: unknown, extra: Record<string, string> = {}) {
  return new Request(`https://auditor.test${path}`, {
    method: 'POST',
    headers: headers(extra),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function operatorCookie() {
  return `${CONSOLE_COOKIE}=${createOperatorSessionValue(SESSION_SECRET, {
    id: 'op-sam',
    sessionEpoch: 1,
  })}`;
}

/** The challenge cookie the options route just issued, ready to send back. */
function challengeCookieFrom(response: Response): string {
  const setCookie = response.headers.getSetCookie().find((value) =>
    value.startsWith('auditor_passkey_challenge='),
  );
  return setCookie?.split(';')[0] ?? '';
}

async function seedPasskey(overrides: Record<string, unknown> = {}) {
  await platform.insertOperatorPasskey({
    credentialId: CREDENTIAL_ID,
    operatorId: 'op-sam',
    publicKey: 'cHVibGljLWtleQ',
    signCounter: 0,
    label: 'Sam Laptop',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  });
}

/** Runs a full sign-in ceremony and returns the final response. */
async function signInWithPasskey(credentialId = CREDENTIAL_ID) {
  const options = await optionsRoute.POST(post('/api/console/passkey/options'));
  return sessionRoute.POST(
    post('/api/console/passkey/session', { id: credentialId }, {
      cookie: challengeCookieFrom(options),
    }),
  );
}

beforeEach(async () => {
  bucket += 1;
  vi.clearAllMocks();
  verifyAuthentication.mockResolvedValue({ signCounter: 5 });
  verifyRegistration.mockResolvedValue({
    credentialId: CREDENTIAL_ID,
    publicKey: 'cHVibGljLWtleQ',
    signCounter: 0,
    transports: ['internal'],
  });

  for (const key of [
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ]) {
    delete process.env[key];
  }

  process.env.AUDITOR_RUN_TOKEN = RUN_TOKEN;
  process.env.AUDITOR_SESSION_SECRET = SESSION_SECRET;
  process.env.AUDITOR_RP_ID = 'auditor.test';
  process.env.AUDITOR_RP_ORIGIN = 'https://auditor.test';

  platform = new MemoryPlatformStore();
  setPlatformStore(platform);

  await platform.upsertOperator({
    id: 'op-sam',
    email: EMAIL,
    name: 'Sam Reyes',
    passwordHash: await hashPassword(PASSWORD),
  });
});

afterEach(() => {
  resetPlatformStore();
  for (const [key, value] of [
    ['AUDITOR_RUN_TOKEN', original.token],
    ['AUDITOR_SESSION_SECRET', original.secret],
    ['AUDITOR_RP_ID', original.rpId],
    ['AUDITOR_RP_ORIGIN', original.rpOrigin],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('the sign-in challenge', () => {
  it('issues a challenge and a cookie carrying it', async () => {
    const response = await optionsRoute.POST(post('/api/console/passkey/options'));

    expect(response.status).toBe(200);
    expect(challengeCookieFrom(response)).not.toBe('');
    const cookie = response.headers.getSetCookie()[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  /**
   * The property worth stating: this endpoint takes no email and does no
   * lookup, so unlike the password route it has nothing to enumerate with.
   * The response is identical for every caller.
   */
  it('discloses nothing about who has an account', async () => {
    const first = await optionsRoute.POST(post('/api/console/passkey/options'));
    const second = await optionsRoute.POST(post('/api/console/passkey/options'));

    expect(await first.json()).toMatchObject({ options: { challenge: 'test-challenge' } });
    expect(second.status).toBe(first.status);
  });

  it('refuses a cross-origin request', async () => {
    const response = await optionsRoute.POST(
      post('/api/console/passkey/options', undefined, { origin: 'https://evil.test' }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'console_same_origin_required' });
  });

  it('refuses when no relying party is configured', async () => {
    delete process.env.AUDITOR_RP_ID;

    const response = await optionsRoute.POST(post('/api/console/passkey/options'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'passkeys_not_configured' });
  });

  // A relying-party id that is not the origin's host (or a parent of it) is a
  // misconfiguration the browser would reject anyway. Caught here so it reads
  // as config rather than as every ceremony mysteriously failing.
  it('refuses a relying party whose id does not match its origin', async () => {
    process.env.AUDITOR_RP_ID = 'somewhere-else.test';

    const response = await optionsRoute.POST(post('/api/console/passkey/options'));

    expect(response.status).toBe(503);
  });
});

describe('signing in with a passkey', () => {
  it('mints a session cookie that resolves back to the operator', async () => {
    await seedPasskey();

    const response = await signInWithPasskey();

    expect(response.status).toBe(200);
    const session = response.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${CONSOLE_COOKIE}=`) && !value.includes('Max-Age=0'));
    const value = session?.split(';')[0]?.slice(`${CONSOLE_COOKIE}=`.length) ?? '';

    // The seam that keeps this additive: the same v2 cookie the password path
    // mints, so `resolvePrincipal` and `revoke-sessions` need no changes.
    const claims = readOperatorSessionClaims(value, SESSION_SECRET);
    expect(claims?.operatorId).toBe('op-sam');
    expect(claims?.epoch).toBe(1);
  });

  it('persists the counter the authenticator reported', async () => {
    await seedPasskey();

    await signInWithPasskey();

    expect((await platform.getOperatorPasskeyByCredentialId(CREDENTIAL_ID))?.signCounter).toBe(5);
    expect(
      (await platform.getOperatorPasskeyByCredentialId(CREDENTIAL_ID))?.lastUsedAt,
    ).toBeDefined();
  });

  it('refuses a credential nobody registered', async () => {
    const response = await signInWithPasskey('cred-never-seen');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_credentials' });
  });

  it('refuses when the signature does not verify', async () => {
    await seedPasskey();
    verifyAuthentication.mockResolvedValue(null);

    const response = await signInWithPasskey();

    expect(response.status).toBe(401);
  });

  /**
   * The sharp one. A valid signature from a real device still must not let a
   * disabled operator in — the account state decides, not the credential.
   */
  it('refuses a disabled operator holding a perfectly good passkey', async () => {
    await seedPasskey();
    await platform.setOperatorDisabled('op-sam', true);

    const response = await signInWithPasskey();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'operator_disabled' });
  });

  it('refuses without a challenge cookie', async () => {
    await seedPasskey();

    const response = await sessionRoute.POST(
      post('/api/console/passkey/session', { id: CREDENTIAL_ID }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'passkey_challenge_expired' });
  });

  it('refuses a registration challenge presented to the sign-in route', async () => {
    await seedPasskey();
    const registerOptions = await registerOptionsRoute.POST(
      post('/api/console/passkey/register/options', { password: PASSWORD }, {
        cookie: operatorCookie(),
      }),
    );

    const response = await sessionRoute.POST(
      post('/api/console/passkey/session', { id: CREDENTIAL_ID }, {
        cookie: challengeCookieFrom(registerOptions),
      }),
    );

    expect(response.status).toBe(400);
  });

  it('clears the challenge cookie on the way out', async () => {
    await seedPasskey();

    const response = await signInWithPasskey();

    expect(
      response.headers
        .getSetCookie()
        .some((value) => value.startsWith('auditor_passkey_challenge=') && value.includes('Max-Age=0')),
    ).toBe(true);
  });
});

describe('registering a passkey', () => {
  it('refuses without a session', async () => {
    const response = await registerOptionsRoute.POST(
      post('/api/console/passkey/register/options', { password: PASSWORD }),
    );

    expect(response.status).toBe(401);
  });

  /**
   * The step-up. Being signed in is not enough, because a passkey outlives the
   * session that created it — a stolen cookie must not become permanent
   * access that `revoke-sessions` cannot reach.
   */
  it('refuses a signed-in operator who cannot produce their password', async () => {
    const response = await registerOptionsRoute.POST(
      post('/api/console/passkey/register/options', { password: 'not-the-password' }, {
        cookie: operatorCookie(),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_credentials' });
  });

  it('registers when the password checks out', async () => {
    const options = await registerOptionsRoute.POST(
      post('/api/console/passkey/register/options', { password: PASSWORD }, {
        cookie: operatorCookie(),
      }),
    );
    expect(options.status).toBe(200);

    const response = await registerRoute.POST(
      post('/api/console/passkey/register', { response: { id: CREDENTIAL_ID }, label: 'Laptop' }, {
        cookie: `${operatorCookie()}; ${challengeCookieFrom(options)}`,
      }),
    );

    expect(response.status).toBe(201);
    const stored = await platform.getOperatorPasskeyByCredentialId(CREDENTIAL_ID);
    expect(stored?.operatorId).toBe('op-sam');
    expect(stored?.label).toBe('Laptop');
  });

  it('refuses a label longer than the bound', async () => {
    const options = await registerOptionsRoute.POST(
      post('/api/console/passkey/register/options', { password: PASSWORD }, {
        cookie: operatorCookie(),
      }),
    );

    const response = await registerRoute.POST(
      post(
        '/api/console/passkey/register',
        { response: { id: CREDENTIAL_ID }, label: 'x'.repeat(65) },
        { cookie: `${operatorCookie()}; ${challengeCookieFrom(options)}` },
      ),
    );

    expect(response.status).toBe(400);
  });

  it('refuses to overwrite a credential id already on record', async () => {
    await seedPasskey();
    const options = await registerOptionsRoute.POST(
      post('/api/console/passkey/register/options', { password: PASSWORD }, {
        cookie: operatorCookie(),
      }),
    );

    const response = await registerRoute.POST(
      post('/api/console/passkey/register', { response: { id: CREDENTIAL_ID }, label: 'Again' }, {
        cookie: `${operatorCookie()}; ${challengeCookieFrom(options)}`,
      }),
    );

    expect(response.status).toBe(409);
    expect((await platform.getOperatorPasskeyByCredentialId(CREDENTIAL_ID))?.label).toBe(
      'Sam Laptop',
    );
  });
});

describe('managing passkeys', () => {
  it('lists only your own, and never the public key', async () => {
    await seedPasskey();
    await platform.upsertOperator({
      id: 'op-other',
      email: 'other@example.test',
      name: 'Other',
      passwordHash: await hashPassword(PASSWORD),
    });
    await platform.insertOperatorPasskey({
      credentialId: 'cred-other',
      operatorId: 'op-other',
      publicKey: 'cHVibGljLWtleQ',
      signCounter: 0,
      label: 'Not Yours',
      createdAt: '2026-08-01T00:00:00.000Z',
    });

    const response = await manageRoute.GET(
      new Request('https://auditor.test/api/console/passkey', {
        headers: headers({ cookie: operatorCookie() }),
      }),
    );
    const payload = (await response.json()) as { passkeys: Record<string, unknown>[] };

    expect(payload.passkeys.map((entry) => entry.credentialId)).toEqual([CREDENTIAL_ID]);
    expect(payload.passkeys[0]).not.toHaveProperty('publicKey');
  });

  /** Authorization expressed in the query: another operator's id deletes nothing. */
  it('refuses to remove a credential belonging to someone else', async () => {
    await platform.upsertOperator({
      id: 'op-other',
      email: 'other@example.test',
      name: 'Other',
      passwordHash: await hashPassword(PASSWORD),
    });
    await platform.insertOperatorPasskey({
      credentialId: 'cred-other',
      operatorId: 'op-other',
      publicKey: 'cHVibGljLWtleQ',
      signCounter: 0,
      label: 'Not Yours',
      createdAt: '2026-08-01T00:00:00.000Z',
    });

    const response = await manageRoute.DELETE(
      new Request('https://auditor.test/api/console/passkey', {
        method: 'DELETE',
        headers: headers({ cookie: operatorCookie() }),
        body: JSON.stringify({ credentialId: 'cred-other' }),
      }),
    );

    // 200, deliberately: a different answer would tell the caller whether that
    // credential id exists. What matters is that the row survived.
    expect(response.status).toBe(200);
    expect(await platform.getOperatorPasskeyByCredentialId('cred-other')).not.toBeNull();
  });

  it('removes your own', async () => {
    await seedPasskey();

    await manageRoute.DELETE(
      new Request('https://auditor.test/api/console/passkey', {
        method: 'DELETE',
        headers: headers({ cookie: operatorCookie() }),
        body: JSON.stringify({ credentialId: CREDENTIAL_ID }),
      }),
    );

    expect(await platform.getOperatorPasskeyByCredentialId(CREDENTIAL_ID)).toBeNull();
  });

  it('refuses a cross-origin delete', async () => {
    await seedPasskey();

    const response = await manageRoute.DELETE(
      new Request('https://auditor.test/api/console/passkey', {
        method: 'DELETE',
        headers: headers({ cookie: operatorCookie(), origin: 'https://evil.test' }),
        body: JSON.stringify({ credentialId: CREDENTIAL_ID }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await platform.getOperatorPasskeyByCredentialId(CREDENTIAL_ID)).not.toBeNull();
  });
});

/**
 * The regression this feature could most easily have introduced.
 *
 * `throttleKey` falls back to one shared `global` bucket wherever no trusted
 * proxy sets `x-vercel-forwarded-for`. An unnamespaced passkey counter would
 * share it with password sign-in, and a handful of failed passkey attempts
 * would lock every operator out of both ways in — a new convenience taking
 * down the established one.
 */
describe('throttle isolation', () => {
  it('does not throttle password sign-in through failed passkey attempts', async () => {
    // Comfortably past MAX_ATTEMPTS (8) on the passkey bucket.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await signInWithPasskey('cred-never-seen');
    }

    const password = await passwordRoute.POST(
      new Request('https://auditor.test/api/console/session', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      }),
    );

    expect(password.status).toBe(200);
  });

  it('still throttles the passkey path itself', async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await signInWithPasskey('cred-never-seen');
    }

    const response = await optionsRoute.POST(post('/api/console/passkey/options'));
    expect(response.status).toBe(429);
  });
});
