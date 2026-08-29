import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createOperatorSessionValue,
  createSessionValue,
  readOperatorSessionClaims,
} from '../../src/app/api/_lib/console-session';
import {
  passkeyRelyingParty,
  passkeyRelyingPartyStatus,
  resolvePrincipal,
  sessionSecret,
  sessionSecretIsShared,
} from '../../src/app/api/_lib/principal';
import { MemoryPlatformStore } from '../../src/integrations/persistence/memory-platform-store';
import type { StoredOperator } from '../../src/domain/platform';

const TOKEN = 'run-token-long-enough-1234';
const SECRET = 'session-secret-long-enough';
const HASH = 'scrypt$16384$8$1$c2FsdA==$aGFzaA==';

const originalToken = process.env.AUDITOR_RUN_TOKEN;
const originalSecret = process.env.AUDITOR_SESSION_SECRET;

async function storeWithOperator(): Promise<{
  store: MemoryPlatformStore;
  operator: StoredOperator;
}> {
  const store = new MemoryPlatformStore();
  await store.upsertOperator({
    id: 'op-alex',
    email: 'alex@example.com',
    name: 'Alex Reed',
    passwordHash: HASH,
  });
  return { store, operator: (await store.getOperator('op-alex'))! };
}

describe('session secret', () => {
  beforeEach(() => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    delete process.env.AUDITOR_SESSION_SECRET;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    if (originalSecret === undefined) delete process.env.AUDITOR_SESSION_SECRET;
    else process.env.AUDITOR_SESSION_SECRET = originalSecret;
  });

  // The fallback is what makes this deployable without a coordinated env
  // change. It is not the desired state, and the product says so elsewhere.
  it('falls back to the run token, and reports that it did', () => {
    expect(sessionSecret()).toBe(TOKEN);
    expect(sessionSecretIsShared()).toBe(true);
  });

  it('prefers a dedicated secret when one is set', () => {
    process.env.AUDITOR_SESSION_SECRET = SECRET;
    expect(sessionSecret()).toBe(SECRET);
    expect(sessionSecretIsShared()).toBe(false);
  });

  // A short secret is not a secret. Falling back to the run token here would
  // silently accept the weak value instead of refusing it.
  it('ignores a too-short dedicated secret rather than using it', () => {
    process.env.AUDITOR_SESSION_SECRET = 'short';
    expect(sessionSecret()).toBe(TOKEN);
  });

  it('has no secret at all when nothing is configured', () => {
    delete process.env.AUDITOR_RUN_TOKEN;
    expect(sessionSecret()).toBeNull();
  });
});

describe('operator session cookie', () => {
  it('round-trips its claims', async () => {
    const { operator } = await storeWithOperator();
    const cookie = createOperatorSessionValue(SECRET, operator);

    expect(readOperatorSessionClaims(cookie, SECRET)).toEqual({
      operatorId: 'op-alex',
      epoch: 1,
      expiresAt: expect.any(Number),
    });
  });

  // The signature covers every field. Editing the operator id is the attack
  // this exists to stop — otherwise any valid cookie names any account.
  it('rejects a cookie whose operator id was swapped', async () => {
    const { operator } = await storeWithOperator();
    const cookie = createOperatorSessionValue(SECRET, operator);
    const tampered = cookie.replace('op-alex', 'op-admin');

    expect(readOperatorSessionClaims(tampered, SECRET)).toBeNull();
  });

  it('rejects a cookie signed with a different secret', async () => {
    const { operator } = await storeWithOperator();
    const cookie = createOperatorSessionValue(SECRET, operator);

    expect(readOperatorSessionClaims(cookie, 'another-secret-entirely')).toBeNull();
  });

  it('rejects an expired cookie', async () => {
    const { operator } = await storeWithOperator();
    const cookie = createOperatorSessionValue(SECRET, operator, Date.now());

    const wayLater = Date.now() + 1000 * 60 * 60 * 24 * 31;
    expect(readOperatorSessionClaims(cookie, SECRET, wayLater)).toBeNull();
  });

  // An id carrying the delimiter could make one field bleed into the next and
  // change which account a signature covers. Refused at mint time.
  it('refuses to mint a cookie for an id containing the delimiter', () => {
    expect(() =>
      createOperatorSessionValue(SECRET, { id: 'op.evil', sessionEpoch: 1 }),
    ).toThrow(/bare token/);
  });

  // The two formats must not be confusable in either direction.
  it('does not read a machine cookie as an operator cookie', () => {
    expect(readOperatorSessionClaims(createSessionValue(TOKEN), TOKEN)).toBeNull();
  });
});

/**
 * "Off" and "misconfigured" are different facts.
 *
 * They used to render identically — the console said passkeys were
 * unavailable and nothing said why — which is exactly the state a deployment
 * lands in when someone pastes a scheme into the id or leaves it off the
 * origin. These cases exist so that silence cannot come back.
 */
describe('passkeyRelyingPartyStatus', () => {
  const original = { id: process.env.AUDITOR_RP_ID, origin: process.env.AUDITOR_RP_ORIGIN };

  function set(id?: string, origin?: string) {
    if (id === undefined) delete process.env.AUDITOR_RP_ID;
    else process.env.AUDITOR_RP_ID = id;
    if (origin === undefined) delete process.env.AUDITOR_RP_ORIGIN;
    else process.env.AUDITOR_RP_ORIGIN = origin;
  }

  afterEach(() => set(original.id, original.origin));

  it('is off when neither is set — a supported way to run', () => {
    set(undefined, undefined);
    expect(passkeyRelyingPartyStatus()).toEqual({ state: 'off' });
  });

  it('is configured when the id is the origin host', () => {
    set('console.example.com', 'https://console.example.com');
    expect(passkeyRelyingPartyStatus()).toEqual({
      state: 'configured',
      rp: { id: 'console.example.com', origin: 'https://console.example.com' },
    });
  });

  it('is configured when the id is a parent of the origin host', () => {
    set('example.com', 'https://console.example.com');
    expect(passkeyRelyingPartyStatus().state).toBe('configured');
  });

  // The slip that produced this function: the origin pasted without a scheme.
  it('names an origin that is not a URL', () => {
    set('console.example.com', 'console.example.com');
    expect(passkeyRelyingPartyStatus()).toEqual({
      state: 'invalid',
      reason: 'origin_unparseable',
    });
  });

  // The other slip: a scheme pasted into the id.
  it('names an id that is not the origin host', () => {
    set('https://console.example.com', 'https://console.example.com');
    expect(passkeyRelyingPartyStatus()).toEqual({
      state: 'invalid',
      reason: 'id_not_host_or_parent',
    });
  });

  it('names an unrelated id rather than accepting it', () => {
    set('somewhere-else.test', 'https://console.example.com');
    expect(passkeyRelyingPartyStatus()).toEqual({
      state: 'invalid',
      reason: 'id_not_host_or_parent',
    });
  });

  // Half-finished is broken, not off: somebody meant to turn this on.
  it.each([
    ['id only', 'console.example.com', undefined],
    ['origin only', undefined, 'https://console.example.com'],
  ])('reports %s as invalid rather than off', (unused, id, origin) => {
    set(id, origin);
    expect(passkeyRelyingPartyStatus()).toEqual({ state: 'invalid', reason: 'half_set' });
  });

  it('keeps passkeyRelyingParty null for every invalid shape', () => {
    set('https://console.example.com', 'https://console.example.com');
    expect(passkeyRelyingParty()).toBeNull();
  });
});

describe('resolvePrincipal', () => {
  beforeEach(() => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    process.env.AUDITOR_SESSION_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    if (originalSecret === undefined) delete process.env.AUDITOR_SESSION_SECRET;
    else process.env.AUDITOR_SESSION_SECRET = originalSecret;
  });

  it('resolves an operator cookie to that operator', async () => {
    const { store, operator } = await storeWithOperator();

    expect(await resolvePrincipal(createOperatorSessionValue(SECRET, operator), () => store)).toEqual({
      kind: 'operator',
      id: 'op-alex',
      name: 'Alex Reed',
      email: 'alex@example.com',
    });
  });

  // The old cookie proves knowledge of the run token, which is a machine
  // credential. Keeping it valid is what lets CI and the hydration harness go
  // on working while humans get accounts.
  it('resolves a run-token cookie to the machine principal', async () => {
    const { store } = await storeWithOperator();

    const principal = await resolvePrincipal(createSessionValue(TOKEN), () => store);
    expect(principal?.kind).toBe('machine');
    expect(principal?.id).toBeUndefined();
  });

  // A signature cannot know someone was disabled five minutes ago. This is the
  // reason the resolution costs a database read at all.
  it('refuses a disabled operator holding a signature that still verifies', async () => {
    const { store, operator } = await storeWithOperator();
    const cookie = createOperatorSessionValue(SECRET, operator);

    await store.setOperatorDisabled('op-alex', true);

    expect(await resolvePrincipal(cookie, () => store)).toBeNull();
  });

  // Per-operator revocation, with no server-side session table.
  it('refuses a cookie minted before the session epoch was bumped', async () => {
    const { store, operator } = await storeWithOperator();
    const cookie = createOperatorSessionValue(SECRET, operator);

    await store.bumpSessionEpoch('op-alex');

    expect(await resolvePrincipal(cookie, () => store)).toBeNull();
  });

  it('refuses a cookie for an operator who no longer exists', async () => {
    const { operator } = await storeWithOperator();
    const cookie = createOperatorSessionValue(SECRET, operator);

    expect(await resolvePrincipal(cookie, () => new MemoryPlatformStore())).toBeNull();
  });

  it('refuses everything when no secret is configured', async () => {
    const { store, operator } = await storeWithOperator();
    const cookie = createOperatorSessionValue(SECRET, operator);
    delete process.env.AUDITOR_RUN_TOKEN;
    delete process.env.AUDITOR_SESSION_SECRET;

    expect(await resolvePrincipal(cookie, () => store)).toBeNull();
  });

  it('refuses an absent cookie', async () => {
    const { store } = await storeWithOperator();
    expect(await resolvePrincipal(null, () => store)).toBeNull();
    expect(await resolvePrincipal('', () => store)).toBeNull();
  });

  /**
   * The reason the store arrives as a factory rather than as a store.
   *
   * `getPlatformStore()` throws without `DATABASE_URL`. Evaluating it to build
   * an argument the v1 and no-cookie paths never read turned a 401 into a 500
   * on any same-origin request, and rendered Next's generic error page where
   * `guard.tsx` should have shown the unlock card — hiding `/console`'s own
   * banner, which names the missing variable and the four steps that fix it.
   *
   * A factory that throws is the honest double here: it stands in for exactly
   * what a deployment without a database does.
   */
  it('never reaches for the store unless the cookie is a v2 one', async () => {
    const absent = () => {
      throw new Error('DATABASE_URL is not set.');
    };

    expect(await resolvePrincipal(null, absent)).toBeNull();
    expect(await resolvePrincipal('', absent)).toBeNull();
    expect(await resolvePrincipal('not-a-cookie-at-all', absent)).toBeNull();
    expect(await resolvePrincipal('v2.op-alex.1.9999999999.badsignature', absent)).toBeNull();

    // The machine path is the one that has to keep working without a database:
    // it is how CI and the hydration harness get in.
    expect((await resolvePrincipal(createSessionValue(TOKEN), absent))?.kind).toBe('machine');
  });

  // ...and the v2 path still does, because revocation depends on it.
  it('does reach for the store when the cookie names an operator', async () => {
    const { store, operator } = await storeWithOperator();
    let calls = 0;

    const counted = () => {
      calls += 1;
      return store;
    };

    await resolvePrincipal(createOperatorSessionValue(SECRET, operator), counted);
    expect(calls).toBe(1);
  });
});
