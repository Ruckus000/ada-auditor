import { describe, expect, it } from 'vitest';
import {
  countBySource,
  parseAuditResponse,
  parseFindings,
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
    findings: [
      {
        code: 'missing-image-alt',
        severity: 'critical',
        message: 'Image is missing alt text.',
        source: 'deterministic',
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
