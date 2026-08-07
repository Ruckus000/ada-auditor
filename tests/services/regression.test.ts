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

  it('keeps the same rule and selector apart when they occur on two pages', () => {
    // A shared header template breaks `image-alt` on `#nav-logo` on every page
    // it appears. Without the page in the key those collapse into one entry —
    // the same class of bug that adding the selector fixed, one level up.
    const onLogin = {
      code: 'image-alt',
      severity: 'critical',
      source: 'deterministic',
      selector: '#nav-logo',
      pageUrl: 'https://app.example.com/login',
    };
    const onDashboard = { ...onLogin, pageUrl: 'https://app.example.com/dashboard' };

    const summary = compareToBaseline(
      makeRecord('current', [onLogin, onDashboard]),
      makeRecord('baseline', [onLogin]),
    );

    expect(summary.status).toBe('fail');
    expect(summary.newFindings).toHaveLength(1);
    expect(summary.newFindings[0].pageUrl).toBe('https://app.example.com/dashboard');
    expect(summary.unchangedCount).toBe(1);
  });

  it('reports a finding that moved to a different page as resolved and new', () => {
    const summary = compareToBaseline(
      makeRecord('current', [
        {
          code: 'image-alt',
          severity: 'critical',
          source: 'deterministic',
          selector: '#hero',
          pageUrl: 'https://app.example.com/b',
        },
      ]),
      makeRecord('baseline', [
        {
          code: 'image-alt',
          severity: 'critical',
          source: 'deterministic',
          selector: '#hero',
          pageUrl: 'https://app.example.com/a',
        },
      ]),
    );

    expect(summary.newFindings).toHaveLength(1);
    expect(summary.resolvedFindings).toHaveLength(1);
    expect(summary.unchangedCount).toBe(0);
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
