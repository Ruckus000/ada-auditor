import { describe, expect, it } from 'vitest';
import { headroomMs, slowestPageMs } from '../../src/services/run-timing';

describe('slowestPageMs', () => {
  it('reports the slowest measured page', () => {
    expect(slowestPageMs([{ durationMs: 900 }, { durationMs: 4200 }, { durationMs: 30 }])).toBe(
      4200,
    );
  });

  it('answers null rather than zero when nothing was measured', () => {
    // The disagreement this module exists to end. The handler's copy reduced to
    // 0, so a run whose pages carried no `durationMs` logged "the slowest page
    // took no time" — a measurement, and a false one — while the client screen
    // returned null and said nothing. Absent means not measured.
    expect(slowestPageMs([])).toBeNull();
    expect(slowestPageMs(undefined)).toBeNull();
    expect(slowestPageMs([{}, { durationMs: null }])).toBeNull();
  });

  it('ignores unmeasured pages beside measured ones', () => {
    // A partial run mixes them: pages captured before the failure carry timing,
    // and anything the store read back from an older row does not.
    expect(slowestPageMs([{ durationMs: 120 }, {}])).toBe(120);
  });
});

describe('headroomMs', () => {
  it('reports what was left of the function', () => {
    expect(headroomMs(300_000, 23_000)).toBe(277_000);
  });

  it('goes negative for a run that outran its invocation', () => {
    // Not clamped, and that is the whole point: a negative headroom is a run
    // the platform was about to kill, which is the number the walk budget and
    // the page cap both get re-decided from.
    expect(headroomMs(300_000, 310_000)).toBe(-10_000);
  });
});
