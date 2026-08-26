import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The preview route replays a journey's stored steps through the real
 * runner, skipping the audit. Mocking `runJourney` (rather than the whole
 * browser layer) keeps this suite about the route's own decisions — who may
 * call it, whose journey it is, which steps are runnable, what the runner is
 * asked for, and how a failure is reported — without launching Chromium.
 */

const { runJourney } = vi.hoisted(() => ({ runJourney: vi.fn() }));
vi.mock('../../src/integrations/browser/journey-runner', () => ({ runJourney }));

// The routes resolve a principal now rather than asking "is there a
// session?". Mocking that seam keeps these tests about the route; the
// cookie/token machinery has its own suite in tests/api/principal.test.ts.
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const { POST } = await import(
  '../../src/app/api/platform/clients/[clientId]/journeys/[journeyId]/preview/route'
);
const {
  MemoryPlatformStore,
  MemoryRunStore,
  resetPlatformStore,
  resetRunStore,
  setPlatformStore,
  setRunStore,
} = await import('../../src/integrations/persistence');
const { resetRunCounter } = await import('../../src/app/api/_lib/run-counter');
const { PartialJourneyError } = await import('../../src/integrations/browser/partial-run');
const { UnsafeTargetError } = await import('../../src/integrations/browser/target-url');

const OPERATOR = {
  kind: 'operator' as const,
  id: 'op-1',
  name: 'Alex Reed',
  email: 'alex@example.com',
};

// A 1x1 PNG, real bytes rather than a stub string, so reading it back and
// base64-encoding it exercises the actual file path this route takes.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const screenshotPath = join(tmpdir(), 'journey-preview-test.png');

beforeAll(async () => {
  await writeFile(screenshotPath, PNG_BYTES);
});

afterAll(async () => {
  await rm(screenshotPath, { force: true });
});

function params(clientId: string, journeyId: string) {
  return { params: Promise.resolve({ clientId, journeyId }) };
}

function rawRequest(clientId: string, journeyId: string, headers: Record<string, string>): Request {
  return new Request(
    `http://localhost/api/platform/clients/${clientId}/journeys/${journeyId}/preview`,
    { method: 'POST', headers },
  );
}

/** Same-origin with a session: how the screen calls it. */
function request(clientId = 'acme', journeyId = 'onboarding'): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return rawRequest(clientId, journeyId, {
    origin: 'http://localhost',
    'sec-fetch-site': 'same-origin',
  });
}

let platform: InstanceType<typeof MemoryPlatformStore>;
let runs: InstanceType<typeof MemoryRunStore>;

describe('POST /api/platform/clients/[clientId]/journeys/[journeyId]/preview', () => {
  const originalMaxRunsPerHour = process.env.AUDITOR_MAX_RUNS_PER_HOUR;
  const originalMaxPreviewsPerHour = process.env.AUDITOR_MAX_PREVIEWS_PER_HOUR;

  beforeEach(async () => {
    runJourney.mockReset();
    principalFromRequest.mockReset();
    principalFromRequest.mockResolvedValue(OPERATOR);

    platform = new MemoryPlatformStore();
    runs = new MemoryRunStore();
    setPlatformStore(platform);
    setRunStore(runs);

    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({
      id: 'onboarding',
      clientId: 'acme',
      name: 'Onboarding',
      targetUrl: 'https://acme.test/',
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });
  });

  afterEach(() => {
    // The run budget counter is a module singleton; without this it
    // accumulates across tests in this file and eventually refuses one.
    resetRunCounter();
    resetPlatformStore();
    resetRunStore();
    if (originalMaxRunsPerHour === undefined) delete process.env.AUDITOR_MAX_RUNS_PER_HOUR;
    else process.env.AUDITOR_MAX_RUNS_PER_HOUR = originalMaxRunsPerHour;
    // Restored too, or the ceiling of 1 set by the preview-budget test leaks
    // into every test after it and refuses walks those tests expect to run.
    if (originalMaxPreviewsPerHour === undefined) delete process.env.AUDITOR_MAX_PREVIEWS_PER_HOUR;
    else process.env.AUDITOR_MAX_PREVIEWS_PER_HOUR = originalMaxPreviewsPerHour;
  });

  it('refuses an unauthenticated request', async () => {
    const call = request();
    principalFromRequest.mockResolvedValue(null);

    const response = await POST(call, params('acme', 'onboarding'));

    expect(response.status).toBe(401);
    expect(runJourney).not.toHaveBeenCalled();
  });

  it('refuses a cookie carried cross-origin', async () => {
    // A session cookie travels on cross-site posts too. Without the
    // same-origin check, any page could trigger a preview walk of a client's
    // authenticated pages.
    principalFromRequest.mockResolvedValue(OPERATOR);
    const response = await POST(
      rawRequest('acme', 'onboarding', {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      params('acme', 'onboarding'),
    );

    expect(response.status).toBe(401);
    expect(runJourney).not.toHaveBeenCalled();
  });

  it("refuses another client's journey", async () => {
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await platform.upsertJourney({
      id: 'theirs',
      clientId: 'other',
      name: 'Theirs',
      targetUrl: 'https://other.test/',
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });

    const response = await POST(request('acme', 'theirs'), params('acme', 'theirs'));

    expect(response.status).toBe(404);
    expect(runJourney).not.toHaveBeenCalled();
  });

  it('refuses an unrunnable journey with the refusal code', async () => {
    await platform.upsertJourney({
      id: 'onboarding',
      clientId: 'acme',
      name: 'Onboarding',
      targetUrl: 'https://acme.test/',
      steps: [],
    });

    const response = await POST(request(), params('acme', 'onboarding'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('journey_has_no_steps');
    expect(runJourney).not.toHaveBeenCalled();
  });

  it('refuses stored steps that are not valid steps', async () => {
    await platform.upsertJourney({
      id: 'onboarding',
      clientId: 'acme',
      name: 'Onboarding',
      targetUrl: 'https://acme.test/',
      steps: [{ banana: 1 }],
    });

    const response = await POST(request(), params('acme', 'onboarding'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('invalid_journey_steps');
    expect(runJourney).not.toHaveBeenCalled();
  });

  it('carries a screenshot on every page it could afford, last page first', async () => {
    // The budget is shared across the whole response, so which pages get a
    // picture is decided by what is left — and the route spends it from the
    // last page backwards, because the page a walk ended on is the one most
    // likely to explain what happened. Two pages fit here, the first does not.
    const nearlyWholeBudget = join(tmpdir(), 'journey-preview-two-thirds.png');
    await writeFile(nearlyWholeBudget, Buffer.alloc(1_400_000, 1));

    try {
      runJourney.mockResolvedValue({
        pages: [
          {
            page: { url: 'https://acme.test/one', route: '/one', title: 'One' },
            html: '',
            axe: { violations: [], incomplete: [] },
            axTree: [],
            artifacts: { screenshotPath: nearlyWholeBudget },
            pageKey: 'p001',
            timing: { totalMs: 100 },
          },
          {
            page: { url: 'https://acme.test/two', route: '/two', title: 'Two' },
            html: '',
            axe: { violations: [], incomplete: [] },
            axTree: [],
            artifacts: { screenshotPath: nearlyWholeBudget },
            pageKey: 'p002',
            timing: { totalMs: 100 },
          },
          {
            page: { url: 'https://acme.test/three', route: '/three', title: 'Three' },
            html: '',
            axe: { violations: [], incomplete: [] },
            axTree: [],
            artifacts: { screenshotPath },
            pageKey: 'p003',
            timing: { totalMs: 100 },
          },
        ],
        truncatedPages: 0,
      });

      const response = await POST(request(), params('acme', 'onboarding'));
      const body = await response.json();

      expect(response.status).toBe(200);
      // Order is preserved: the response reads as the path the walk took, even
      // though the budget was spent in the opposite direction.
      expect(body.pages.map((page: { title: string }) => page.title)).toEqual([
        'One',
        'Two',
        'Three',
      ]);

      // The last two fit; the first is told it exists rather than left silent.
      expect(body.pages[2].screenshot.mimeType).toBe('image/png');
      expect(body.pages[1].screenshot.base64.length).toBeGreaterThan(0);
      expect(body.pages[0].screenshot).toBeUndefined();
      expect(body.pages[0].screenshotOmitted).toBe(true);

      // And the ceiling this is all in service of still holds.
      expect(JSON.stringify(body).length).toBeLessThan(4_500_000);
    } finally {
      await rm(nearlyWholeBudget, { force: true });
    }
  });

  it('walks the stored steps and answers pages plus a screenshot', async () => {
    runJourney.mockResolvedValue({
      pages: [
        {
          page: { url: 'https://acme.test/', route: '/', title: 'Acme' },
          html: '',
          axe: { violations: [], incomplete: [] },
          axTree: [],
          artifacts: { screenshotPath },
          pageKey: 'p001-root',
          timing: { totalMs: 900 },
        },
      ],
      truncatedPages: 0,
    });

    const response = await POST(request(), params('acme', 'onboarding'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0].url).toBe('https://acme.test/');
    expect(body.pages[0].title).toBe('Acme');
    expect(body.pages[0].statusCode).toBeUndefined();
    // The evidence rides on the page it was taken on, not on the envelope.
    expect(body.pages[0].screenshot.mimeType).toBe('image/png');
    expect(body.pages[0].screenshot.base64.length).toBeGreaterThan(0);

    const call = vi.mocked(runJourney).mock.calls[0][0];
    expect(call.skipScan).toBe(true);
    expect(call.omitAxTree).toBe(true);
    expect(call.allowedHosts).toContain('acme.test');

    // The route's own scratch directory for this request must not survive
    // the response — these files exist only long enough to be read back.
    const artifactsDir = join(tmpdir(), 'preview-artifacts', body.requestId);
    expect(existsSync(artifactsDir)).toBe(false);
  });

  it('verifies with the same stored credentials a real run would type', async () => {
    // The preview exists to answer "will this walk work". Resolving from the
    // env fallback while the run resolves from the store would let the
    // preview vouch for a login the audit never types, so the route builds
    // the same map the run handler does — and, being a response full of
    // operator-facing detail, must never echo a value out of it.
    const USER_SENTINEL = 'preview-user-sentinel@example.com';
    const PASS_SENTINEL = 'hunter2-sentinel-preview';

    await platform.upsertJourney({
      id: 'login-journey',
      clientId: 'acme',
      name: 'Login',
      targetUrl: 'https://acme.test/',
      steps: [
        { action: 'navigate', type: 'goto', path: '/login' },
        { action: 'login', type: 'fill', selector: '#u', credentialRef: 'portal', field: 'user' },
        { action: 'login', type: 'fill', selector: '#p', credentialRef: 'portal', field: 'pass' },
      ],
    });
    await platform.setClientCredential('acme', 'portal', {
      user: USER_SENTINEL,
      pass: PASS_SENTINEL,
    });

    runJourney.mockResolvedValue({ pages: [], truncatedPages: 0 });

    const response = await POST(request('acme', 'login-journey'), params('acme', 'login-journey'));

    expect(response.status).toBe(200);
    expect(vi.mocked(runJourney).mock.calls[0][0].credentials).toEqual({
      portal: { user: USER_SENTINEL, pass: PASS_SENTINEL },
    });
    const serialised = JSON.stringify(await response.json());
    expect(serialised).not.toContain(USER_SENTINEL);
    expect(serialised).not.toContain(PASS_SENTINEL);
  });

  it('leaves the credentials map off a journey that names no refs', async () => {
    runJourney.mockResolvedValue({ pages: [], truncatedPages: 0 });

    await POST(request(), params('acme', 'onboarding'));

    expect(vi.mocked(runJourney).mock.calls[0][0]).not.toHaveProperty('credentials');
  });

  it('a failed walk answers the classified code and the step sentence', async () => {
    const cause = new Error('Step 2 ("login") could not click "#go": locator timed out.');
    runJourney.mockRejectedValue(new PartialJourneyError(cause, { pages: [], truncatedPages: 0, settleWaitMs: 0 }));

    const response = await POST(request(), params('acme', 'onboarding'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
    expect(body.detail).toBe('Step 2 ("login") could not click "#go": locator timed out.');
  });

  /**
   * The important regression: `PartialJourneyError` wraps whatever killed the
   * walk, and most causes are not safe to echo verbatim. `UnsafeTargetError`
   * from `assertPeerAddressAllowed` embeds the full page URL — query string
   * included, which is exactly where an SSO authorization code or a
   * password-reset token lives. `detail` must stay gated on the classified
   * code, not merely on the error being a `PartialJourneyError`.
   */
  it('does not leak a navigation refusal message that carries a live URL', async () => {
    const cause = new UnsafeTargetError(
      'Navigation to https://acme.test/cb?code=SECRET connected to 10.0.0.1, a private or reserved address.',
    );
    runJourney.mockRejectedValue(new PartialJourneyError(cause, { pages: [], truncatedPages: 0, settleWaitMs: 0 }));

    const response = await POST(request(), params('acme', 'onboarding'));
    const raw = await response.text();
    const body = JSON.parse(raw);

    expect(response.status).toBe(422);
    expect(body.error).toBe('navigation_not_allowed');
    expect(body.detail).toBeUndefined();
    expect(raw).not.toContain('SECRET');
  });

  /**
   * The leak the test above did not cover, and the reason it did not.
   *
   * That test proves a *differently classified* error is withheld. This one is
   * the same class the route deliberately echoes: `journey_step_failed`. The
   * old comment justified echoing it on the grounds that such a message is
   * "by construction" built from the runner's own sentence — true of the
   * template, false of what `attemptStep` interpolated into it. A click wraps
   * its navigation settle, so Chromium's `net::ERR_… at https://host/cb?code=…`
   * became the `because` half of a sentence that matches the classifier's
   * anchor, and went to the operator verbatim.
   *
   * Asserted on the raw response text, not the parsed field: a secret that
   * escaped into any other part of the body would still be a leak.
   */
  it('reduces a URL carried inside the step sentence it does echo', async () => {
    const cause = new Error(
      'Step 2 ("login") could not click "#go": net::ERR_ABORTED at https://acme.test/cb?code=SECRET.',
    );
    runJourney.mockRejectedValue(new PartialJourneyError(cause, { pages: [], truncatedPages: 0, settleWaitMs: 0 }));

    const response = await POST(request(), params('acme', 'onboarding'));
    const raw = await response.text();
    const body = JSON.parse(raw);

    expect(response.status).toBe(422);
    expect(body.error).toBe('journey_step_failed');
    expect(raw).not.toContain('SECRET');
    expect(raw).not.toContain('code=');
    // The diagnostic survives the reduction — an operator still learns which
    // step failed, on what selector, and that the navigation aborted.
    expect(body.detail).toBe(
      'Step 2 ("login") could not click "#go": net::ERR_ABORTED at https://acme.test/cb.',
    );
  });

  it('omits a screenshot that would blow the response past the platform ceiling', async () => {
    const bigScreenshotPath = join(tmpdir(), 'journey-preview-test-oversized.png');
    await writeFile(bigScreenshotPath, Buffer.alloc(3_500_000, 1));

    try {
      runJourney.mockResolvedValue({
        pages: [
          {
            page: { url: 'https://acme.test/', route: '/', title: 'Acme' },
            html: '',
            axe: { violations: [], incomplete: [] },
            axTree: [],
            artifacts: { screenshotPath: bigScreenshotPath },
            pageKey: 'p001-root',
            timing: { totalMs: 900 },
          },
        ],
        truncatedPages: 0,
      });

      const response = await POST(request(), params('acme', 'onboarding'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pages[0].screenshot).toBeUndefined();
      expect(body.pages[0].screenshotOmitted).toBe(true);
    } finally {
      await rm(bigScreenshotPath, { force: true });
    }
  });

  it('writes no run row', async () => {
    runJourney.mockResolvedValue({ pages: [], truncatedPages: 0, settleWaitMs: 0 });

    const before = await runs.list();
    const response = await POST(request(), params('acme', 'onboarding'));
    const after = await runs.list();

    expect(response.status).toBe(200);
    expect(after).toEqual(before);
  });

  it('spends the preview budget', async () => {
    // Previews are not free — browser time against a client's live site is a
    // real cost, and an uncounted variant would be the loophole.
    process.env.AUDITOR_MAX_PREVIEWS_PER_HOUR = '1';
    runJourney.mockResolvedValue({ pages: [], truncatedPages: 0, settleWaitMs: 0 });

    const first = await POST(request(), params('acme', 'onboarding'));
    expect(first.status).toBe(200);

    const second = await POST(request(), params('acme', 'onboarding'));
    const secondBody = await second.json();

    expect(second.status).toBe(429);
    expect(secondBody.error).toBe('run_budget_exceeded');
  });

  it('does not spend the audit budget', async () => {
    // The point of the split. Authoring is a loop — ten or twenty walks while
    // shaping one journey's steps — and auditing is a decision. On one shared
    // counter the loop could drain the hour's audits without running a single
    // one, and the scheduler would then refuse a real client's audit because
    // somebody was typing. An audit ceiling of one must not refuse a second
    // preview.
    process.env.AUDITOR_MAX_RUNS_PER_HOUR = '1';
    runJourney.mockResolvedValue({ pages: [], truncatedPages: 0, settleWaitMs: 0 });

    expect((await POST(request(), params('acme', 'onboarding'))).status).toBe(200);
    expect((await POST(request(), params('acme', 'onboarding'))).status).toBe(200);
    expect((await POST(request(), params('acme', 'onboarding'))).status).toBe(200);
  });
});
