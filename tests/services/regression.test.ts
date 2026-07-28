import { describe, expect, it } from 'vitest';
import type { StoredRunRecord } from '../../src/domain/persistence';
import { compareToBaseline } from '../../src/services/regression';

function makeRecord(
  requestId: string,
  findings: StoredRunRecord['findings'],
): StoredRunRecord {
  return {
    requestId,
    journeyId: 'demo-login',
    environment: 'staging',
    platform: 'generic',
    evidenceStatus: 'complete',
    ciStatus: 'pass',
    findings,
    durationMs: 10,
    createdAt: '2026-07-28T12:00:00.000Z',
  };
}

describe('compareToBaseline', () => {
  it('reports no regression when deterministic findings are unchanged', () => {
    const finding = {
      code: 'missing-image-alt',
      severity: 'critical',
      source: 'deterministic',
    };

    const summary = compareToBaseline(
      makeRecord('current', [finding]),
      makeRecord('baseline', [finding]),
    );

    expect(summary.status).toBe('none');
    expect(summary.newFindings).toHaveLength(0);
    expect(summary.resolvedFindings).toHaveLength(0);
    expect(summary.unchangedCount).toBe(1);
  });

  it('fails regression when new critical deterministic findings appear', () => {
    const summary = compareToBaseline(
      makeRecord('current', [
        {
          code: 'missing-image-alt',
          severity: 'critical',
          source: 'deterministic',
        },
      ]),
      makeRecord('baseline', []),
    );

    expect(summary.status).toBe('fail');
    expect(summary.newFindings).toHaveLength(1);
  });

  it('warns on new major deterministic findings', () => {
    const summary = compareToBaseline(
      makeRecord('current', [
        {
          code: 'low-contrast',
          severity: 'major',
          source: 'deterministic',
        },
      ]),
      makeRecord('baseline', []),
    );

    expect(summary.status).toBe('warn');
  });

  it('ignores advisory findings for regression status', () => {
    const summary = compareToBaseline(
      makeRecord('current', [
        {
          code: 'ai-label-review',
          severity: 'advisory',
          source: 'ai-advisory',
        },
      ]),
      makeRecord('baseline', []),
    );

    expect(summary.status).toBe('none');
    expect(summary.newFindings).toHaveLength(0);
  });
});
