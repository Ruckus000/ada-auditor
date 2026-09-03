import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_DOCUMENTS_PER_DAY,
  DEFAULT_MAX_DOCUMENTS_PER_HOUR,
  DEFAULT_MAX_PREVIEWS_PER_HOUR,
  DEFAULT_MAX_RUNS_PER_DAY,
  DEFAULT_MAX_RUNS_PER_HOUR,
  consumeDocumentBudget,
  consumePreviewBudget,
  consumeRunBudget,
  documentBudgetLimits,
  runBudgetLimits,
  windowKeys,
  type RunCounter,
} from '../../src/services/run-budget';

const NOON = new Date('2026-08-10T12:30:15.000Z');

/** Counts in a plain map, so a test can drive the windows independently. */
function counter(seed: Record<string, number> = {}): RunCounter & { counts: Record<string, number> } {
  const counts = { ...seed };
  return {
    counts,
    async increment(key: string) {
      counts[key] = (counts[key] ?? 0) + 1;
      return counts[key];
    },
  };
}

describe('windowKeys', () => {
  // The key IS the clock: no stored window boundaries, no skew arithmetic.
  it('derives the window from the timestamp', () => {
    expect(windowKeys(NOON)).toEqual({
      hour: 'runs:hour:2026081012',
      day: 'runs:day:20260810',
    });
  });

  it('rolls over on the hour', () => {
    expect(windowKeys(new Date('2026-08-10T13:00:00.000Z')).hour).toBe('runs:hour:2026081013');
  });
});

describe('consumeRunBudget', () => {
  it('allows a run under both limits', async () => {
    expect(await consumeRunBudget(counter(), NOON, {})).toEqual({ allowed: true });
  });

  it('refuses once the hourly limit is passed, and says when it resets', async () => {
    const counts = counter({ 'runs:hour:2026081012': DEFAULT_MAX_RUNS_PER_HOUR });

    const verdict = await consumeRunBudget(counts, NOON, {});

    expect(verdict.allowed).toBe(false);
    expect(verdict.window).toBe('hour');
    // 12:30:15 → 29m45s to the hour.
    expect(verdict.resetsInSeconds).toBe(1785);
  });

  it('refuses once the daily limit is passed', async () => {
    const counts = counter({ 'runs:day:20260810': DEFAULT_MAX_RUNS_PER_DAY });

    const verdict = await consumeRunBudget(counts, NOON, {});

    expect(verdict.allowed).toBe(false);
    expect(verdict.window).toBe('day');
    expect(verdict.resetsInSeconds).toBe(41_385);
  });

  // The day is the more expensive answer to be wrong about, so it is reported
  // when both are exhausted.
  it('names the day when both windows are exhausted', async () => {
    const counts = counter({
      'runs:hour:2026081012': DEFAULT_MAX_RUNS_PER_HOUR,
      'runs:day:20260810': DEFAULT_MAX_RUNS_PER_DAY,
    });

    expect((await consumeRunBudget(counts, NOON, {})).window).toBe('day');
  });

  it('honours configured limits', async () => {
    const counts = counter({ 'runs:hour:2026081012': 2 });

    const verdict = await consumeRunBudget(counts, NOON, { AUDITOR_MAX_RUNS_PER_HOUR: '2' });

    expect(verdict.allowed).toBe(false);
  });

  it.each(['0', '-1', 'lots', ''])('falls back to the default limit for %s', async (value) => {
    expect(runBudgetLimits({ AUDITOR_MAX_RUNS_PER_HOUR: value }).perHour).toBe(
      DEFAULT_MAX_RUNS_PER_HOUR,
    );
  });

  // Both windows are counted even when the first refuses: the counters
  // describe demand, not permitted demand, and deciding later whether the
  // limits are right needs the true number.
  it('counts a refused run against both windows', async () => {
    const counts = counter({ 'runs:hour:2026081012': DEFAULT_MAX_RUNS_PER_HOUR });

    await consumeRunBudget(counts, NOON, {});

    expect(counts.counts['runs:hour:2026081012']).toBe(DEFAULT_MAX_RUNS_PER_HOUR + 1);
    expect(counts.counts['runs:day:20260810']).toBe(1);
  });

  /**
   * The behaviour that matters most when it matters at all.
   *
   * A cost control that becomes an outage when Redis has a bad minute has made
   * things worse: the failure it prevents is a large bill, the failure it would
   * cause is the product not working.
   */
  it('allows the run and says so loudly when the counter is unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: RunCounter = {
      async increment() {
        throw new Error('ECONNREFUSED');
      },
    };

    expect(await consumeRunBudget(broken, NOON, {})).toEqual({ allowed: true });
    expect(JSON.parse(warn.mock.calls[0]![0] as string).type).toBe('run_budget_degraded');

    warn.mockRestore();
  });
});

describe('consumePreviewBudget', () => {
  /**
   * The property the split exists for: two counters, so authoring cannot
   * spend the audits. Asserted from both directions, because a single-sided
   * check would pass against a bug that merely renamed the key.
   */
  it('does not touch the run counter', async () => {
    const counts = counter();

    await consumePreviewBudget(counts, NOON, {});

    expect(Object.keys(counts.counts)).toEqual(['previews:hour:2026081012', 'previews:day:20260810']);
    expect(counts.counts['runs:hour:2026081012']).toBeUndefined();
  });

  it('is not refused by a spent run budget', async () => {
    const counts = counter({
      'runs:hour:2026081012': DEFAULT_MAX_RUNS_PER_HOUR,
      'runs:day:20260810': DEFAULT_MAX_RUNS_PER_DAY,
    });

    expect(await consumePreviewBudget(counts, NOON, {})).toEqual({ allowed: true });
  });

  it('refuses once its own hourly ceiling is reached', async () => {
    const counts = counter({ 'previews:hour:2026081012': DEFAULT_MAX_PREVIEWS_PER_HOUR });

    const verdict = await consumePreviewBudget(counts, NOON, {});

    expect(verdict.allowed).toBe(false);
    expect(verdict.window).toBe('hour');
  });

  it('takes its ceiling from its own env var, not the run one', async () => {
    // A ceiling of 1 on runs must not cap previews, and vice versa — the
    // mistake this guards against is one spec object reading the other's name.
    const counts = counter();

    expect(
      (await consumePreviewBudget(counts, NOON, { AUDITOR_MAX_RUNS_PER_HOUR: '1' })).allowed,
    ).toBe(true);
    expect(
      (await consumePreviewBudget(counts, NOON, { AUDITOR_MAX_PREVIEWS_PER_HOUR: '1' })).allowed,
    ).toBe(false);
  });
});

describe('consumeDocumentBudget', () => {
  /**
   * The third counter. Document work — a JVM, LibreOffice, veraPDF — used to
   * be authenticated and uncounted, so a leaked token or a caller in a loop
   * had nothing in the way. Same shape as the other two: its own keys, its
   * own env, the same windows and the same fail-open.
   */
  it('touches only its own keys', async () => {
    const counts = counter();

    await consumeDocumentBudget(counts, NOON, {});

    expect(Object.keys(counts.counts)).toEqual([
      'documents:hour:2026081012',
      'documents:day:20260810',
    ]);
  });

  it('is not refused by a spent run or preview budget', async () => {
    const counts = counter({
      'runs:hour:2026081012': DEFAULT_MAX_RUNS_PER_HOUR,
      'runs:day:20260810': DEFAULT_MAX_RUNS_PER_DAY,
      'previews:hour:2026081012': DEFAULT_MAX_PREVIEWS_PER_HOUR,
    });

    expect(await consumeDocumentBudget(counts, NOON, {})).toEqual({ allowed: true });
  });

  it('refuses once its own hourly ceiling is reached, and says when it resets', async () => {
    const counts = counter({ 'documents:hour:2026081012': DEFAULT_MAX_DOCUMENTS_PER_HOUR });

    const verdict = await consumeDocumentBudget(counts, NOON, {});

    expect(verdict).toEqual({ allowed: false, window: 'hour', resetsInSeconds: 1785 });
  });

  it('takes its ceiling from its own env var, not the run one', async () => {
    const counts = counter();

    expect(
      (await consumeDocumentBudget(counts, NOON, { AUDITOR_MAX_RUNS_PER_HOUR: '1' })).allowed,
    ).toBe(true);
    expect(
      (await consumeDocumentBudget(counts, NOON, { AUDITOR_MAX_DOCUMENTS_PER_HOUR: '1' })).allowed,
    ).toBe(false);
  });

  // Sized against real use: "Inspect all unreviewed" walks an inventory of up
  // to 200 documents in one click, and the blind harness posts 150 rows in one
  // run. A ceiling below either would refuse the product's own workflows.
  it('defaults above one full inventory sweep per hour', () => {
    expect(DEFAULT_MAX_DOCUMENTS_PER_HOUR).toBeGreaterThanOrEqual(200);
    expect(DEFAULT_MAX_DOCUMENTS_PER_DAY).toBeGreaterThan(DEFAULT_MAX_DOCUMENTS_PER_HOUR);
    expect(documentBudgetLimits({})).toEqual({
      perHour: DEFAULT_MAX_DOCUMENTS_PER_HOUR,
      perDay: DEFAULT_MAX_DOCUMENTS_PER_DAY,
    });
  });

  it('names its own counter when it degrades', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: RunCounter = {
      async increment() {
        throw new Error('ECONNREFUSED');
      },
    };

    expect(await consumeDocumentBudget(broken, NOON, {})).toEqual({ allowed: true });
    const line = JSON.parse(warn.mock.calls[0]![0] as string);
    expect(line.type).toBe('run_budget_degraded');
    expect(line.budget).toBe('documents');

    warn.mockRestore();
  });
});
