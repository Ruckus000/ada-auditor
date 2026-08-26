import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advisoryModel,
  createAiAdvisoryFinding,
  isAiAdvisoryConfigured,
  requestAiAdvisory,
  SYSTEM_PROMPT,
  type AdvisoryPage,
} from '../../src/services/ai-advisory';
import type { AxeScanResult } from '../../src/services/deterministic-audit';

const EMPTY_AXE: AxeScanResult = { violations: [], incomplete: [] };

const PAGE = { url: 'https://app.example.com/dashboard', title: 'Dashboard' };

/**
 * Stands in for the one network call.
 *
 * The seam used to be a vendor client object with a `messages.create` method.
 * There is no vendor client any more — the model is a `provider/model` string
 * the gateway resolves — so the seam is the call itself, and `null` is how it
 * reports every answer that was not a usable tool call.
 */
function stubCall(findings: Array<{ issue: string; confidence: number }> | null) {
  const call = vi.fn().mockResolvedValue(findings);
  return { call, spy: call };
}

function advisoryPage(overrides: Partial<AdvisoryPage> = {}): AdvisoryPage {
  return {
    page: PAGE,
    axTree: [{ role: 'heading', name: 'Dashboard', level: 1 }],
    axe: EMPTY_AXE,
    ...overrides,
  };
}

function advisoryInput(overrides: Partial<Parameters<typeof requestAiAdvisory>[0]> = {}) {
  return {
    pages: [advisoryPage()],
    minConfidence: 0.7,
    ...overrides,
  };
}

describe('isAiAdvisoryConfigured', () => {
  const original = process.env.AI_GATEWAY_API_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  });

  const originalOidc = process.env.VERCEL_OIDC_TOKEN;

  afterEach(() => {
    if (originalOidc === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = originalOidc;
  });

  it('is off with no way to reach the gateway', () => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    expect(isAiAdvisoryConfigured()).toBe(false);
  });

  it('is on with an explicit gateway key', () => {
    delete process.env.VERCEL_OIDC_TOKEN;
    process.env.AI_GATEWAY_API_KEY = 'gw-test';
    expect(isAiAdvisoryConfigured()).toBe(true);
  });

  it('is on with only an OIDC token, because a Vercel deployment mints one', () => {
    // The deployed case needs no configuration at all, which is the reason
    // this is not a "is a key set" check.
    delete process.env.AI_GATEWAY_API_KEY;
    process.env.VERCEL_OIDC_TOKEN = 'oidc-test';
    expect(isAiAdvisoryConfigured()).toBe(true);
  });
});

describe('the off sentinel', () => {
  const originals = {
    model: process.env.AUDITOR_ADVISORY_MODEL,
    key: process.env.AI_GATEWAY_API_KEY,
    oidc: process.env.VERCEL_OIDC_TOKEN,
  };

  afterEach(() => {
    for (const [env, value] of [
      ['AUDITOR_ADVISORY_MODEL', originals.model],
      ['AI_GATEWAY_API_KEY', originals.key],
      ['VERCEL_OIDC_TOKEN', originals.oidc],
    ] as const) {
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
  });

  it('turns the pass off even when both auth sources are present', () => {
    // Auth became ambient in #103 — a Vercel deployment always holds an OIDC
    // token — so "no key" stopped being a way to say no. This is the way.
    process.env.AI_GATEWAY_API_KEY = 'gw-test';
    process.env.VERCEL_OIDC_TOKEN = 'oidc-test';
    process.env.AUDITOR_ADVISORY_MODEL = 'off';
    expect(isAiAdvisoryConfigured()).toBe(false);
  });

  it('is case-insensitive, because an env var is typed by hand', () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-test';
    process.env.AUDITOR_ADVISORY_MODEL = ' OFF ';
    expect(isAiAdvisoryConfigured()).toBe(false);
  });

  it('leaves a real model string on', () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-test';
    process.env.AUDITOR_ADVISORY_MODEL = 'openai/gpt-5.4';
    expect(isAiAdvisoryConfigured()).toBe(true);
  });

  it('wins over an injected call, spending nothing', async () => {
    // Off is a statement about where evidence may go, and a test double is
    // still a place — the sentinel is checked before the seam.
    process.env.AUDITOR_ADVISORY_MODEL = 'off';
    const { call, spy } = stubCall([{ issue: 'x', confidence: 1 }]);
    await expect(requestAiAdvisory(advisoryInput({ call }))).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('requestAiAdvisory', () => {
  const original = process.env.AI_GATEWAY_API_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  });

  it('returns findings above the contract confidence threshold', async () => {
    const { call } = stubCall([
        { issue: 'Alt text "image1" does not describe the image.', confidence: 0.9 },
      ]);

    const findings = await requestAiAdvisory(advisoryInput({ call }));

    expect(findings).toEqual([
      {
        code: 'ai-advisory',
        severity: 'advisory',
        source: 'ai-advisory',
        gateable: false,
        message: 'Alt text "image1" does not describe the image.',
        confidence: 0.9,
      },
    ]);
  });

  it('applies minReport as a live gate', async () => {
    // This threshold used to compare two constants, so its result was fixed
    // when it was written. It now filters real, varying confidences.
    const { call } = stubCall([
        { issue: 'Certain issue.', confidence: 0.95 },
        { issue: 'Borderline issue.', confidence: 0.5 },
      ]);

    const findings = await requestAiAdvisory(advisoryInput({ call, minConfidence: 0.7 }));

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('Certain issue.');
  });

  it('never gates a run', async () => {
    const { call } = stubCall([{ issue: 'Something.', confidence: 1 }]);

    const findings = await requestAiAdvisory(advisoryInput({ call }));

    expect(findings.every((f) => f.gateable === false)).toBe(true);
    expect(findings.every((f) => f.severity === 'advisory')).toBe(true);
  });

  it('returns nothing when there is no way to reach the gateway and no call is injected', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;

    expect(await requestAiAdvisory(advisoryInput())).toEqual([]);
  });

  it('degrades to no advisory when the API errors, rather than failing the run', async () => {
    const call = vi.fn().mockRejectedValue(new Error('503 overloaded'));

    await expect(requestAiAdvisory(advisoryInput({ call }))).resolves.toEqual([]);
  });

  it('handles a refusal, which the call reports as no usable answer', async () => {
    // A refusal used to arrive as an empty `content` array that would throw if
    // indexed blindly, turning a soft outcome into a failed audit. It is now
    // one `null`, alongside every other unusable answer.
    const { call } = stubCall(null);

    await expect(requestAiAdvisory(advisoryInput({ call }))).resolves.toEqual([]);
  });

  it('handles a response that called no tool', async () => {
    const { call } = stubCall(null);

    await expect(requestAiAdvisory(advisoryInput({ call }))).resolves.toEqual([]);
  });

  it('accepts an empty findings list as a valid answer', async () => {
    const { call } = stubCall([]);

    await expect(requestAiAdvisory(advisoryInput({ call }))).resolves.toEqual([]);
  });

  it('defaults to a gateway model string, overridable by configuration', () => {
    // This used to assert a hardcoded vendor model id on a request object. The
    // model is now a `provider/model` string the gateway resolves, so what is
    // worth pinning is that it stays a gateway slug and stays configurable —
    // swapping model must not need a code change.
    const original = process.env.AUDITOR_ADVISORY_MODEL;
    try {
      delete process.env.AUDITOR_ADVISORY_MODEL;
      expect(advisoryModel()).toContain('/');

      process.env.AUDITOR_ADVISORY_MODEL = 'openai/gpt-5.4';
      expect(advisoryModel()).toBe('openai/gpt-5.4');
    } finally {
      if (original === undefined) delete process.env.AUDITOR_ADVISORY_MODEL;
      else process.env.AUDITOR_ADVISORY_MODEL = original;
    }
  });

  it('frames the page evidence as untrusted data rather than instructions', () => {
    // A page is third-party content and this prompt is the only thing between
    // it and prompt injection, so it is asserted directly rather than read off
    // a request object that no longer exists.
    expect(SYSTEM_PROMPT).toContain('untrusted');
    expect(SYSTEM_PROMPT).toContain('not instructions');
  });

  it('sends every page of evidence to the one call', async () => {
    const { call, spy } = stubCall([]);

    await requestAiAdvisory(
      advisoryInput({
        call,
        pages: [
          advisoryPage({
            axe: {
              violations: [],
              incomplete: [
                {
                  id: 'color-contrast',
                  impact: 'serious',
                  tags: ['wcag2aa', 'wcag143'],
                  help: 'Elements must meet contrast ratio thresholds',
                  helpUrl: 'https://example.test/color-contrast',
                  nodes: [{ html: '<p id="x">text</p>', target: ['#x'] }],
                },
              ],
            },
          }),
        ],
      }),
    );

    const content = spy.mock.calls[0][0] as string;

    expect(content).toContain('<accessibility_tree>');
    expect(content).toContain('<checks_needing_review>');
    expect(content).toContain('color-contrast');
  });

  it('reviews the whole journey in a single call, not one per page', async () => {
    // Per-page calls would cost N× and, worse, could never see the issues that
    // only exist across pages — navigation named differently on two screens,
    // heading structure drifting partway through the flow.
    const { call, spy } = stubCall([]);

    await requestAiAdvisory(
      advisoryInput({
        call,
        pages: [
          advisoryPage({ page: { url: 'https://app.example.com/login', title: 'Login' } }),
          advisoryPage({
            page: { url: 'https://app.example.com/violations', title: 'Violations' },
          }),
          advisoryPage({ page: { url: 'https://app.example.com/done', title: 'Done' } }),
        ],
      }),
    );

    expect(spy).toHaveBeenCalledOnce();

    const content = spy.mock.calls[0][0] as string;
    expect(content).toContain('https://app.example.com/login');
    expect(content).toContain('https://app.example.com/violations');
    expect(content).toContain('https://app.example.com/done');
    // Order is preserved, so "between page 1 and page 2" means something.
    expect(content.indexOf('/login')).toBeLessThan(content.indexOf('/violations'));
    expect(content.indexOf('/violations')).toBeLessThan(content.indexOf('/done'));
  });

  it('does not spend a model call when no page was captured', async () => {
    const { call, spy } = stubCall([]);

    await expect(requestAiAdvisory(advisoryInput({ call, pages: [] }))).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('createAiAdvisoryFinding', () => {
  it('shapes a finding as non-gating advisory', () => {
    expect(createAiAdvisoryFinding({ message: 'x', confidence: 0.8 })).toEqual({
      code: 'ai-advisory',
      severity: 'advisory',
      source: 'ai-advisory',
      gateable: false,
      message: 'x',
      confidence: 0.8,
    });
  });
});
