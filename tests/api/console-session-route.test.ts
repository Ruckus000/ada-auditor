import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { POST } = await import('../../src/app/api/console/session/route');
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);
const { hashPassword } = await import('../../src/domain/operator-credentials');
const { CONSOLE_COOKIE, readOperatorSessionClaims } = await import(
  '../../src/app/api/_lib/console-session'
);

/**
 * Signing in.
 *
 * This route had no test at all. `console-session.test.ts` covers the cookie
 * helpers — signing, expiry, tamper — and stops at the door: nothing drove the
 * handler that decides whether a person gets in. That is the one route gating
 * the entire product, and its absence showed the day a sign-in failed and
 * there was no way to tell a wrong password from a throttled request, a CSRF
 * rejection, or a platform error page returned before the app ever saw it.
 * Each of those is a different fix, and the failure looks identical from the
 * outside.
 *
 * So this asserts the status *codes*, not just success and failure. The codes
 * are the diagnosis.
 */

const RUN_TOKEN = 'run-token-long-enough-1234';
const SESSION_SECRET = 'session-secret-long-enough-32ch';
const EMAIL = 'sam@example.test';
const PASSWORD = 'a-perfectly-fine-password';

const original = {
  token: process.env.AUDITOR_RUN_TOKEN,
  secret: process.env.AUDITOR_SESSION_SECRET,
};

let platform: InstanceType<typeof MemoryPlatformStore>;

/**
 * Each test gets its own throttle bucket.
 *
 * The key is derived from `x-vercel-forwarded-for`, falling back to one global
 * bucket. Without a distinct address per test, the failures each test
 * deliberately causes would accumulate into the next one and start returning
 * 429 — a suite that fails in file order and passes in isolation.
 */
let bucket = 0;

function signIn(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('https://auditor.test/api/console/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://auditor.test',
        'x-vercel-forwarded-for': `10.0.0.${bucket}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  bucket += 1;
  process.env.AUDITOR_RUN_TOKEN = RUN_TOKEN;
  process.env.AUDITOR_SESSION_SECRET = SESSION_SECRET;

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

  if (original.token === undefined) delete process.env.AUDITOR_RUN_TOKEN;
  else process.env.AUDITOR_RUN_TOKEN = original.token;

  if (original.secret === undefined) delete process.env.AUDITOR_SESSION_SECRET;
  else process.env.AUDITOR_SESSION_SECRET = original.secret;
});

describe('POST /api/console/session, as an operator', () => {
  it('signs in and names the person in the cookie', async () => {
    const response = await signIn({ email: EMAIL, password: PASSWORD });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      operator: { id: 'op-sam', name: 'Sam Reyes' },
    });

    // The cookie has to resolve back to *this* operator — that is what makes
    // an action attributable, and a session that authenticates nobody in
    // particular would satisfy a laxer assertion.
    const cookie = response.headers.get('set-cookie') ?? '';
    const value = cookie.split(`${CONSOLE_COOKIE}=`)[1]?.split(';')[0] ?? '';

    expect(readOperatorSessionClaims(decodeURIComponent(value), SESSION_SECRET)).toMatchObject({
      operatorId: 'op-sam',
      epoch: 1,
    });
  });

  it('refuses a wrong password', async () => {
    const response = await signIn({ email: EMAIL, password: 'not-the-password' });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_credentials' });
  });

  it('answers an unknown account exactly as it answers a wrong password', async () => {
    // Anything else is a user-enumeration oracle on the one endpoint where it
    // matters. The route verifies against a dummy hash for this reason.
    const unknown = await signIn({ email: 'nobody@example.test', password: PASSWORD });
    const wrong = await signIn({ email: EMAIL, password: 'not-the-password' });

    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.json()).toMatchObject({ error: 'invalid_credentials' });
  });

  it('tells a disabled operator so, rather than blaming their password', async () => {
    // They are not guessing — they had an account and it was switched off.
    // "Wrong password" would send them to reset a password that is fine.
    await platform.setOperatorDisabled('op-sam', true);

    const response = await signIn({ email: EMAIL, password: PASSWORD });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'operator_disabled' });
  });

  it.each([
    ['a different case', 'SAM@Example.TEST'],
    ['surrounding whitespace', `  ${EMAIL}  `],
  ])('accepts an email with %s', async (_label, typed) => {
    // Email is what a person types, and they type it inconsistently.
    expect((await signIn({ email: typed, password: PASSWORD })).status).toBe(200);
  });
});

describe('POST /api/console/session, as a machine', () => {
  it('accepts the run token', async () => {
    const response = await signIn({ token: RUN_TOKEN });

    expect(response.status).toBe(200);
    // No operator: a machine credential resolves to nobody in particular, and
    // that is the whole reason operator accounts exist beside it.
    await expect(response.json()).resolves.not.toHaveProperty('operator');
  });

  it('refuses a wrong token', async () => {
    const response = await signIn({ token: 'wrong-token-but-long-enough' });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_token' });
  });
});

describe('POST /api/console/session, refusals that are not about credentials', () => {
  /**
   * These three are why the test exists. All four failures render the same way
   * in the browser, and each one has a different fix — so the code is the
   * diagnosis, and the code is what is asserted.
   */
  it('refuses a cross-origin post, which is the CSRF guard and not a bad password', async () => {
    const response = await signIn(
      { email: EMAIL, password: PASSWORD },
      { origin: 'https://attacker.example' },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'console_same_origin_required',
    });
  });

  it('throttles after repeated failures, and says so distinctly', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await signIn({ email: EMAIL, password: 'not-the-password' });
    }

    // The correct password now, and it still does not get in.
    const response = await signIn({ email: EMAIL, password: PASSWORD });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: 'too_many_attempts' });
  });

  it('clears the count on a success, so a typo does not spend the budget', async () => {
    await signIn({ email: EMAIL, password: 'not-the-password' });
    expect((await signIn({ email: EMAIL, password: PASSWORD })).status).toBe(200);

    for (let attempt = 0; attempt < 7; attempt += 1) {
      await signIn({ email: EMAIL, password: 'not-the-password' });
    }

    expect((await signIn({ email: EMAIL, password: PASSWORD })).status).toBe(200);
  });

  it('refuses everything when no run token is configured', async () => {
    // Fail closed: with nothing to authenticate against, nobody is
    // authenticated — including the operator path, which does not use the run
    // token but does depend on a signing key derived from it.
    delete process.env.AUDITOR_RUN_TOKEN;

    const response = await signIn({ email: EMAIL, password: PASSWORD });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'auditor_run_token_not_configured',
    });
  });
});
