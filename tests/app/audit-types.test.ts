import { describe, expect, it } from 'vitest';
import {
  countBySource,
  groupFindingsByPage,
  parseAuditResponse,
  parseFindings,
  parsePages,
  type AuditResult,
} from '../../src/app/components/audit-types';
import { describeApiError } from '../../src/app/components/glossary';

describe('parseFindings', () => {
  it('keeps findings that have no message', () => {
    // Regression entries are StoredFinding records: code/severity/source only.
    // Requiring a message here silently emptied the "new findings" list while
    // the regression headline still reported a new critical issue.
    const findings = parseFindings([
      { code: 'missing-image-alt', severity: 'critical', source: 'deterministic' },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('missing-image-alt');
    expect(findings[0].message).toBeUndefined();
  });

  it('drops entries with no code', () => {
    expect(parseFindings([{ severity: 'critical' }, null, 'nope'])).toEqual([]);
  });

  it('defaults an unknown severity to minor and an unknown source to deterministic', () => {
    const [finding] = parseFindings([{ code: 'x', severity: 'catastrophic', source: 'psychic' }]);
    expect(finding.severity).toBe('minor');
    expect(finding.source).toBe('deterministic');
  });

  it('returns an empty list for a non-array', () => {
    expect(parseFindings(undefined)).toEqual([]);
    expect(parseFindings({})).toEqual([]);
  });
});

describe('parseAuditResponse', () => {
  const payload = {
    requestId: 'req-1',
    journeyId: 'demo-login',
    environment: 'staging',
    platform: 'generic',
    evidenceStatus: 'complete',
    ciStatus: 'fail',
    durationMs: 42,
    pages: [
      { url: 'https://a.example/login', route: '/login', title: 'Login', evidenceStatus: 'complete' },
    ],
    findings: [
      {
        code: 'missing-image-alt',
        severity: 'critical',
        message: 'Image is missing alt text.',
        source: 'deterministic',
        pageUrl: 'https://a.example/login',
      },
      {
        code: 'ai-advisory',
        severity: 'advisory',
        message: 'Check labels.',
        source: 'ai-advisory',
        gateable: false,
        confidence: 0.84,
      },
    ],
    regression: {
      status: 'fail',
      baselineRequestId: 'req-0',
      newFindings: [
        { code: 'missing-image-alt', severity: 'critical', source: 'deterministic' },
      ],
      resolvedFindings: [],
      unchangedCount: 2,
    },
  };

  it('maps ciStatus onto verdict and preserves the full findings list', () => {
    const result = parseAuditResponse(payload, 200, true, false);

    expect(result.verdict).toBe('fail');
    expect(result.evidenceStatus).toBe('complete');
    expect(result.findings).toHaveLength(2);
    expect(result.durationMs).toBe(42);
    expect(result.simulated).toBe(false);
  });

  it('carries the page each finding was found on through to the console', () => {
    const result = parseAuditResponse(payload, 200, true, false);

    expect(result.pages?.map((p) => p.title)).toEqual(['Login']);
    expect(result.findings[0].pageUrl).toBe('https://a.example/login');
    // Advisory findings have no page — they are produced once per journey.
    expect(result.findings[1].pageUrl).toBeUndefined();
  });

  it('keeps the regression diff intact, including message-less new findings', () => {
    const result = parseAuditResponse(payload, 200, true, false);

    expect(result.regression?.status).toBe('fail');
    expect(result.regression?.newFindings).toHaveLength(1);
    expect(result.regression?.unchangedCount).toBe(2);
  });

  it('leaves verdict undefined for an error response', () => {
    const result = parseAuditResponse(
      { error: 'auditor_run_token_not_configured', requestId: 'req-2' },
      503,
      false,
      false,
    );

    expect(result.verdict).toBeUndefined();
    expect(result.error).toBe('auditor_run_token_not_configured');
    expect(result.findings).toEqual([]);
  });

  it('tolerates a completely empty payload', () => {
    const result = parseAuditResponse({}, 500, false, false);
    expect(result.findings).toEqual([]);
    expect(result.regression).toBeUndefined();
  });
});

describe('parsePages', () => {
  it('reads the pages a run audited, in order', () => {
    const pages = parsePages([
      { url: 'https://a.example/login', route: '/login', title: 'Login', evidenceStatus: 'complete' },
      { url: 'https://a.example/cart', route: '/cart', title: 'Cart', evidenceStatus: 'degraded' },
    ]);

    expect(pages?.map((p) => p.title)).toEqual(['Login', 'Cart']);
    expect(pages?.[1].evidenceStatus).toBe('degraded');
  });

  it('falls back to the URL when route or title are missing', () => {
    const pages = parsePages([{ url: 'https://a.example/x' }]);

    expect(pages?.[0].route).toBe('https://a.example/x');
    expect(pages?.[0].title).toBe('https://a.example/x');
    expect(pages?.[0].evidenceStatus).toBeUndefined();
  });

  it('drops entries with no URL and returns undefined for a non-array', () => {
    expect(parsePages([{ title: 'nope' }, null])).toEqual([]);
    expect(parsePages(undefined)).toBeUndefined();
  });
});

describe('groupFindingsByPage', () => {
  function result(overrides: Partial<AuditResult> = {}): AuditResult {
    return {
      httpStatus: 200,
      ok: true,
      findings: [],
      simulated: false,
      ...overrides,
    };
  }

  const LOGIN = { url: 'https://a.example/login', route: '/login', title: 'Login' };
  const CART = { url: 'https://a.example/cart', route: '/cart', title: 'Cart' };

  it('groups by page in visit order, not in the order findings arrived', () => {
    const groups = groupFindingsByPage(
      result({
        pages: [LOGIN, CART],
        findings: parseFindings([
          { code: 'cart-rule', severity: 'critical', source: 'deterministic', pageUrl: CART.url },
          { code: 'login-rule', severity: 'major', source: 'deterministic', pageUrl: LOGIN.url },
        ]),
      }),
    );

    expect(groups.map((g) => g.page?.title)).toEqual(['Login', 'Cart']);
    expect(groups[0].findings[0].code).toBe('login-rule');
  });

  it('puts advisory findings under the journey rather than a page', () => {
    // The advisory pass reads every page at once, so its findings belong to no
    // single page — filing them under one would be a claim we cannot support.
    const groups = groupFindingsByPage(
      result({
        pages: [LOGIN],
        findings: parseFindings([
          { code: 'login-rule', severity: 'major', source: 'deterministic', pageUrl: LOGIN.url },
          { code: 'ai-advisory', severity: 'advisory', source: 'ai-advisory', message: 'x' },
        ]),
      }),
    );

    expect(groups).toHaveLength(2);
    expect(groups[1].page).toBeNull();
    expect(groups[1].findings[0].source).toBe('ai-advisory');
  });

  it('omits a page the run audited and found nothing on', () => {
    const groups = groupFindingsByPage(
      result({
        pages: [LOGIN, CART],
        findings: parseFindings([
          { code: 'cart-rule', severity: 'critical', source: 'deterministic', pageUrl: CART.url },
        ]),
      }),
    );

    expect(groups.map((g) => g.page?.title)).toEqual(['Cart']);
  });

  it('never drops a finding whose page the run did not list', () => {
    // Showing it under an unfamiliar URL beats losing it entirely.
    const groups = groupFindingsByPage(
      result({
        pages: [LOGIN],
        findings: parseFindings([
          { code: 'stray', severity: 'critical', source: 'deterministic', pageUrl: 'https://a.example/gone' },
        ]),
      }),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].page?.url).toBe('https://a.example/gone');
  });

  it('handles a response with no pages at all', () => {
    const groups = groupFindingsByPage(
      result({
        findings: parseFindings([
          { code: 'a', severity: 'critical', source: 'deterministic', pageUrl: LOGIN.url },
        ]),
      }),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].page?.url).toBe(LOGIN.url);
  });
});

describe('countBySource', () => {
  it('counts blocking findings as critical deterministic ones only', () => {
    const counts = countBySource(
      parseFindings([
        { code: 'a', severity: 'critical', message: 'a', source: 'deterministic' },
        { code: 'b', severity: 'major', message: 'b', source: 'deterministic' },
        { code: 'ai-advisory', severity: 'advisory', message: 'c', source: 'ai-advisory' },
      ]),
    );

    expect(counts.total).toBe(3);
    expect(counts.deterministic).toHaveLength(2);
    expect(counts.advisory).toHaveLength(1);
    expect(counts.blocking).toHaveLength(1);
  });
});

describe('describeApiError', () => {
  it('explains a known error code and gives an actionable fix', () => {
    const copy = describeApiError('auditor_run_token_not_configured', 503);
    expect(copy.title).toBe('The server has no run token');
    expect(copy.fix).toContain('AUDITOR_RUN_TOKEN');
  });

  it('explains the stable run-failure codes the handler returns', () => {
    expect(describeApiError('journey_not_in_scope', 422).fix).toContain('demo-login');
    expect(describeApiError('action_not_allowed', 422).title).toContain('forbids');
    expect(describeApiError('invalid_step_id', 422).title).toContain('step name');
  });

  it('treats httpStatus 0 as a transport failure', () => {
    expect(describeApiError(undefined, 0).title).toBe('Could not reach the server');
  });

  it('falls back to a generic explanation for an unrecognised code', () => {
    const copy = describeApiError('some_new_error_code', 422);
    expect(copy.title).toBe('The run did not finish');
    expect(copy.fix).toContain('trace ID');
  });
});
