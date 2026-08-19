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
    expect(body.pages).toEqual([
      { url: 'https://acme.test/', title: 'Acme', statusCode: undefined },
    ]);
    expect(body.screenshot.mimeType).toBe('image/png');
    expect(body.screenshot.base64.length).toBeGreaterThan(0);

    const call = vi.mocked(runJourney).mock.calls[0][0];
    expect(call.skipScan).toBe(true);
    expect(call.omitAxTree).toBe(true);
    expect(call.allowedHosts).toContain('acme.test');

    // The route's own scratch directory for this request must not survive
    // the response — these files exist only long enough to be read back.
    const artifactsDir = join(tmpdir(), 'preview-artifacts', body.requestId);
    expect(existsSync(artifactsDir)).toBe(false);
  });

  it('a failed walk answers the classified code and the step sentence', async () => {
    const cause = new Error('Step 2 ("login") could not click "#go": locator timed out.');
    runJourney.mockRejectedValue(new PartialJourneyError(cause, { pages: [], truncatedPages: 0 }));

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
    runJourney.mockRejectedValue(new PartialJourneyError(cause, { pages: [], truncatedPages: 0 }));

    const response = await POST(request(), params('acme', 'onboarding'));
    const raw = await response.text();
    const body = JSON.parse(raw);

    expect(response.status).toBe(422);
    expect(body.error).toBe('navigation_not_allowed');
    expect(body.detail).toBeUndefined();
    expect(raw).not.toContain('SECRET');
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
      expect(body.screenshot).toBeUndefined();
      expect(body.screenshotOmitted).toBe(true);
    } finally {
      await rm(bigScreenshotPath, { force: true });
    }
  });

  it('writes no run row', async () => {
    runJourney.mockResolvedValue({ pages: [], truncatedPages: 0 });

    const before = await runs.list();
    const response = await POST(request(), params('acme', 'onboarding'));
    const after = await runs.list();

    expect(response.status).toBe(200);
    expect(after).toEqual(before);
  });

  it('spends the run budget', async () => {
    process.env.AUDITOR_MAX_RUNS_PER_HOUR = '1';
    runJourney.mockResolvedValue({ pages: [], truncatedPages: 0 });

    const first = await POST(request(), params('acme', 'onboarding'));
    expect(first.status).toBe(200);

    const second = await POST(request(), params('acme', 'onboarding'));
    const secondBody = await second.json();

    expect(second.status).toBe(429);
    expect(secondBody.error).toBe('run_budget_exceeded');
  });
});
