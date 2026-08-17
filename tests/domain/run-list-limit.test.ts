import { describe, expect, it } from 'vitest';
import {
  clampRunListLimit,
  RUN_LIST_DEFAULT,
  RUN_LIST_MAX,
} from '../../src/domain/persistence';

/**
 * How many runs one `list` call may return.
 *
 * The rule lived twice — the same expression in the Postgres store and in the
 * memory double — and the shared contract could not have caught a drift
 * between them: its assertion was "at most 100", which three rows satisfy. So
 * the copies were unguarded and the test that looked like their guard was
 * vacuous on any database that was not already full.
 */
describe('clampRunListLimit', () => {
  it('defaults when nothing is asked for', () => {
    expect(clampRunListLimit(undefined)).toBe(RUN_LIST_DEFAULT);
  });

  it('honours a sensible request', () => {
    expect(clampRunListLimit(2)).toBe(2);
    expect(clampRunListLimit(RUN_LIST_MAX)).toBe(RUN_LIST_MAX);
  });

  it('caps an absurd one rather than pulling the whole table', () => {
    expect(clampRunListLimit(100_000)).toBe(RUN_LIST_MAX);
  });

  it('never returns less than one, so a listing cannot silently return nothing', () => {
    // `limit 0` is valid SQL and answers an empty page, which reads as "this
    // client has no runs".
    expect(clampRunListLimit(0)).toBe(1);
    expect(clampRunListLimit(-5)).toBe(1);
  });

  it('answers a number for input that is not one', () => {
    // The bare `Math.min(Math.max(limit ?? 20, 1), 100)` this replaces answers
    // `NaN` for `NaN`, which reaches Postgres as `limit NaN`. No route can send
    // one — they parse integers — but a store is called by scripts and tests
    // too, and a clamp that answers "not a number" is not a clamp.
    expect(clampRunListLimit(Number.NaN)).toBe(RUN_LIST_DEFAULT);
    expect(clampRunListLimit(Number.POSITIVE_INFINITY)).toBe(RUN_LIST_DEFAULT);
  });

  it('takes a whole number from a fractional request', () => {
    // `limit 2.5` is a syntax error in Postgres.
    expect(clampRunListLimit(2.5)).toBe(2);
  });
});
