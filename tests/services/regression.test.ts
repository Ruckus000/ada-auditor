import { describe, expect, it } from 'vitest';
import type { StoredRunRecord } from '../../src/domain/persistence';
import { compareToBaseline } from '../../src/services/regression';

/**
 * `steps` is a parameter because comparing two runs now depends on it.
 *
 * These records used to carry no `intent` at all, which is what a run written
 * before the column looked like — and every case here passed, because the diff
 * compared findings and never asked whether the two runs had walked the same
 * pages. That question is the point of the suite now, so a record that does
 * not answer it is not a realistic fixture.
 */
const SAME_PATH = [
  { action: 'navigate', type: 'goto', path: '/' },
  { action: 'navigate', type: 'goto', path: '/checkout' },
];

function makeRecord(
  requestId: string,
  findings: StoredRunRecord['findings'],
  steps: unknown[] = SAME_PATH,
): StoredRunRecord {
  return {
    requestId,
    journeyId: 'demo-login',
    environment: 'staging',
    platform: 'generic',
    evidenceStatus: 'complete',
    ciStatus: 'pass',
    findings,
    intent: { steps },
    durationMs: 10,
    createdAt: '2026-07-28T12:00:00.000Z',
  };
}

/** A run from before `intent` existed. */
function makeRecordWithoutIntent(
  requestId: string,
  findings: StoredRunRecord['findings'],
): StoredRunRecord {
  const { intent: _intent, ...rest } = makeRecord(requestId, findings);
  return rest;
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

describe('compareToBaseline, when the two runs did not walk the same path', () => {
  /**
   * The worst output this product can produce is a clean bill of health
   * nobody earned, and this is the shortest road to one.
   *
   * `getLatestRun` picks a baseline on `journeyId` and `environment` alone,
   * and `/api/audit/run` takes `journeyId` and `steps` independently. So a
   * single bearer POST naming an existing journey and walking somewhere else
   * becomes the next real run's baseline — and every finding the real journey
   * has that the impostor did not comes back as *resolved*.
   */
  const critical = {
    code: 'missing-image-alt',
    severity: 'critical' as const,
    source: 'deterministic' as const,
  };

  it('refuses to call anything resolved when the baseline walked elsewhere', () => {
    const summary = compareToBaseline(
      makeRecord('current', []),
      makeRecord('baseline', [critical], [{ action: 'navigate', type: 'goto', path: '/other' }]),
    );

    expect(summary.status).toBe('incomparable');
    // The finding vanished between the two runs, and that is exactly what must
    // not be reported as progress: the current run never visited its page.
    expect(summary.resolvedFindings).toHaveLength(0);
  });

  it('still compares two runs that walked the same path', () => {
    // The guard has to be a guard, not a blanket refusal — otherwise the
    // regression diff simply stops working and the product loses its point.
    const summary = compareToBaseline(makeRecord('current', []), makeRecord('baseline', [critical]));

    expect(summary.status).toBe('none');
    expect(summary.resolvedFindings).toHaveLength(1);
  });

  it('treats a run that recorded no path as unproven, not as agreeing', () => {
    // Runs written before the column exist. Absent has to mean "not recorded";
    // reading it as "same path" would leave every one of them comparing
    // exactly as wrongly as before, which is the whole defect.
    const summary = compareToBaseline(
      makeRecord('current', []),
      makeRecordWithoutIntent('baseline', [critical]),
    );

    expect(summary.status).toBe('incomparable');
    expect(summary.resolvedFindings).toHaveLength(0);
  });

  it('notices a reordering, because the same pages in a different order is a different walk', () => {
    const summary = compareToBaseline(
      makeRecord('current', []),
      makeRecord('baseline', [critical], [
        { action: 'navigate', type: 'goto', path: '/checkout' },
        { action: 'navigate', type: 'goto', path: '/' },
      ]),
    );

    expect(summary.status).toBe('incomparable');
  });
});

describe('compareToBaseline, when intent is the wrong shape', () => {
  it('withholds when steps is not an array', () => {
    // `{steps: undefined}` is a truthy object that stringifies to `{}`, so it
    // stores and reads back as a real intent — and then `undefined ===
    // undefined` compared two of them as equal. The false all-clear arriving
    // through the guard that exists to refuse it.
    const bad = { steps: undefined } as unknown as { steps: unknown[] };
    const current = { ...makeRecord('current', []), intent: bad };
    const baseline = {
      ...makeRecord('baseline', [
        { code: 'missing-image-alt', severity: 'critical' as const, source: 'deterministic' as const },
      ]),
      intent: bad,
    };

    const summary = compareToBaseline(current, baseline);

    expect(summary.status).toBe('incomparable');
    expect(summary.resolvedFindings).toHaveLength(0);
  });
});
