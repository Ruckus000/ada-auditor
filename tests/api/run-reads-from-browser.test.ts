import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The browser has to be able to read a run.
 *
 * These four routes authorized with `isRunAuthorized` — a **bearer token only**
 * — while the browser holds a session cookie. So `RunJourneyButton`'s poll got
 * 401 on every attempt, `if (!response.ok) continue` swallowed it, and it burnt
 * all hundred polls before reporting "Still running — reload later" for a run
 * that may have finished in thirty seconds. Polling instead of a single
 * `router.refresh()` was the entire justification for that component.
 *
 * Nothing caught it: the route tests mocked the principal, and the hydration
 * test asserts the row updates from the *immediate* refresh after the 202,
 * before polling matters. This file is the missing check — it exercises the
 * real `authorizePrincipal`, with a real cookie, and no bearer token anywhere.
 */

const TOKEN = 'run-token-long-enough-1234';

const { GET: getRun } = await import('../../src/app/api/audit/runs/[requestId]/route');
const { GET: listRuns } = await import('../../src/app/api/audit/runs/route');
const { GET: latestRun } = await import('../../src/app/api/audit/runs/latest/route');
const { CONSOLE_COOKIE, createSessionValue } = await import(
  '../../src/app/api/_lib/console-session'
);
const {
  MemoryPlatformStore,
  MemoryRunStore,
  resetPlatformStore,
  resetRunStore,
  setPlatformStore,
  setRunStore,
} = await import('../../src/integrations/persistence');

const originalToken = process.env.AUDITOR_RUN_TOKEN;
const originalSecret = process.env.AUDITOR_SESSION_SECRET;

/** Exactly what the poll sends: same-origin, cookie, and no bearer token. */
function fromBrowser(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      'sec-fetch-site': 'same-origin',
      cookie: `${CONSOLE_COOKIE}=${createSessionValue(TOKEN)}`,
    },
  });
}

describe('reading a run from the browser', () => {
  beforeEach(async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    delete process.env.AUDITOR_SESSION_SECRET;

    // Resolving a cookie means resolving an *operator*, which needs the
    // catalog store. A bearer caller never reaches it — `authorizePrincipal`
    // answers on the token first — which is why only these cases need it.
    setPlatformStore(new MemoryPlatformStore());

    const store = new MemoryRunStore();
    setRunStore(store);
    await store.saveRun({
      requestId: 'req-poll',
      journeyId: 'checkout',
      environment: 'production',
      platform: 'generic',
      evidenceStatus: 'complete',
      ciStatus: 'pass',
      findings: [],
      durationMs: 100,
      createdAt: new Date().toISOString(),
      status: 'complete',
    });
  });

  afterEach(() => {
    resetRunStore();
    resetPlatformStore();
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    if (originalSecret === undefined) delete process.env.AUDITOR_SESSION_SECRET;
    else process.env.AUDITOR_SESSION_SECRET = originalSecret;
  });

  // The one that was broken. Without it the Run now button never learns a run
  // finished, and gives up after five minutes.
  it('lets a cookie-only caller poll a run to its terminal status', async () => {
    const response = await getRun(fromBrowser('/api/audit/runs/req-poll'), {
      params: Promise.resolve({ requestId: 'req-poll' }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).run.status).toBe('complete');
  });

  it('lets a cookie-only caller list runs', async () => {
    const response = await listRuns(fromBrowser('/api/audit/runs?journeyId=checkout'));

    expect(response.status).toBe(200);
  });

  it('lets a cookie-only caller read the latest run', async () => {
    const response = await latestRun(
      fromBrowser('/api/audit/runs/latest?journeyId=checkout&environment=production'),
    );

    expect(response.status).toBe(200);
  });

  // The bearer path is what CI and the scheduler use. Widening to cookies must
  // not have narrowed it.
  it('still lets a bearer-token caller read a run', async () => {
    const response = await getRun(
      new Request('http://localhost/api/audit/runs/req-poll', {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      { params: Promise.resolve({ requestId: 'req-poll' }) },
    );

    expect(response.status).toBe(200);
  });

  it('refuses a caller with neither', async () => {
    const response = await getRun(new Request('http://localhost/api/audit/runs/req-poll'), {
      params: Promise.resolve({ requestId: 'req-poll' }),
    });

    expect(response.status).toBe(401);
  });

  // A cookie alone is not enough: `authorizePrincipal` requires same-origin so
  // another site cannot ride an operator's session.
  it('refuses a cookie presented cross-origin', async () => {
    const response = await getRun(
      new Request('http://localhost/api/audit/runs/req-poll', {
        headers: {
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
          cookie: `${CONSOLE_COOKIE}=${createSessionValue(TOKEN)}`,
        },
      }),
      { params: Promise.resolve({ requestId: 'req-poll' }) },
    );

    expect(response.status).toBe(401);
  });
});
