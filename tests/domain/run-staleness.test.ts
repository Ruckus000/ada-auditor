import { afterEach, describe, expect, it } from 'vitest';
import {
  RUN_STALE_AFTER_MS,
  isAbandoned,
  reconcileRunStatus,
  staleAfterMs,
} from '../../src/domain/run-staleness';
import type { StoredRunRecord } from '../../src/domain/persistence';

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

function run(overrides: Partial<StoredRunRecord> = {}): StoredRunRecord {
  return {
    requestId: 'req-1',
    journeyId: 'demo-login',
    environment: 'staging',
    platform: 'generic',
    evidenceStatus: 'unknown',
    ciStatus: 'inconclusive',
    findings: [],
    durationMs: 0,
    createdAt: new Date(NOW).toISOString(),
    status: 'running',
    ...overrides,
  };
}

describe('isAbandoned', () => {
  it('is false for a run still inside the threshold', () => {
    const startedAt = new Date(NOW - RUN_STALE_AFTER_MS + 1000).toISOString();
    expect(isAbandoned(run({ startedAt }), NOW)).toBe(false);
  });

  it('is true once the threshold is passed', () => {
    const startedAt = new Date(NOW - RUN_STALE_AFTER_MS - 1).toISOString();
    expect(isAbandoned(run({ startedAt }), NOW)).toBe(true);
  });

  // Exactly at the boundary is not yet abandoned — the comparison is strict,
  // so a run cannot be declared dead on the same millisecond it might finish.
  it('is false exactly at the threshold', () => {
    const startedAt = new Date(NOW - RUN_STALE_AFTER_MS).toISOString();
    expect(isAbandoned(run({ startedAt }), NOW)).toBe(false);
  });

  it.each(['complete', 'failed'] as const)('never touches a %s run, however old', (status) => {
    const startedAt = new Date(NOW - RUN_STALE_AFTER_MS * 100).toISOString();
    expect(isAbandoned(run({ status, startedAt }), NOW)).toBe(false);
  });

  // Runs predating `startedAt` still have to be reconcilable. For a run that
  // is *still* running, `createdAt` is its start — nothing ever rewrote it.
  it('falls back to createdAt when startedAt is absent', () => {
    const createdAt = new Date(NOW - RUN_STALE_AFTER_MS - 1).toISOString();
    expect(isAbandoned(run({ createdAt }), NOW)).toBe(true);
  });

  it('refuses to guess from an unparseable timestamp', () => {
    expect(isAbandoned(run({ startedAt: 'not a date' }), NOW)).toBe(false);
  });
});

describe('reconcileRunStatus', () => {
  it('marks an abandoned run failed with a stable code', () => {
    const startedAt = new Date(NOW - RUN_STALE_AFTER_MS - 1).toISOString();

    const reconciled = reconcileRunStatus(run({ startedAt }), NOW);

    expect(reconciled.status).toBe('failed');
    expect(reconciled.failureReason).toBe('run_timed_out');
  });

  // Returned by identity so callers can apply it on every read without copying
  // every record.
  it('returns the same object when nothing is wrong', () => {
    const healthy = run({ status: 'complete' });
    expect(reconcileRunStatus(healthy, NOW)).toBe(healthy);
  });
});

describe('staleAfterMs', () => {
  afterEach(() => {
    delete process.env.AUDITOR_RUN_STALE_SECONDS;
  });

  it('defaults to the built-in threshold', () => {
    expect(staleAfterMs({})).toBe(RUN_STALE_AFTER_MS);
  });

  it('honours a configured value, in seconds', () => {
    expect(staleAfterMs({ AUDITOR_RUN_STALE_SECONDS: '90' })).toBe(90_000);
  });

  it.each(['0', '-5', 'soon', ''])('falls back rather than throwing on %s', (value) => {
    expect(staleAfterMs({ AUDITOR_RUN_STALE_SECONDS: value })).toBe(RUN_STALE_AFTER_MS);
  });
});
