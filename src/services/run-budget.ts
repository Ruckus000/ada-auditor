import { logWarn } from './logger';

/**
 * A ceiling on how many audits this deployment will start.
 *
 * Nothing counted runs. Each one launches Chromium and makes an Opus call, so
 * a loop in a caller, a scheduler misconfigured to fire hourly, or a leaked
 * machine token spends real money with nothing in the way. This is the thing
 * in the way.
 *
 * ## Global, not per-operator
 *
 * There is one organisation, and what is being protected — the Anthropic bill,
 * the function budget — is shared. Per-operator quotas would be a fairness
 * mechanism nobody asked for, and would not stop the actual failure, which is
 * one caller in a loop.
 *
 * ## Fixed windows, not sliding
 *
 * The key *is* the clock: `runs:hour:2026081014`. One INCR and one EXPIRE per
 * window, no sorted sets, no clock skew arithmetic — and Upstash charges per
 * command. A sliding window would be more precise about a burst on the hour
 * boundary, which is not a precision anyone needs from a cost control.
 *
 * ## Fails open
 *
 * If the counter is unreachable, runs proceed. A cost control that becomes an
 * outage when Redis has a bad minute has made things worse, not better: the
 * failure it prevents is a large bill, and the failure it would cause is the
 * product not working. It says so loudly when it degrades.
 */

export interface RunCounter {
  /** Increments and returns the new value, setting the TTL on first write. */
  increment(key: string, windowSeconds: number): Promise<number>;
}

export const DEFAULT_MAX_RUNS_PER_HOUR = 20;
export const DEFAULT_MAX_RUNS_PER_DAY = 100;

export type Env = Record<string, string | undefined>;

function limitFrom(env: Env, name: string, fallback: number): number {
  const configured = Number(env[name]);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
}

export type BudgetVerdict = {
  allowed: boolean;
  /** Which window refused, for the log and the response. */
  window?: 'hour' | 'day';
  /** Seconds until that window rolls over. */
  resetsInSeconds?: number;
};

/** `runs:hour:YYYYMMDDHH` — the key is the clock. */
export function windowKeys(now: Date): { hour: string; day: string } {
  const iso = now.toISOString();
  const day = iso.slice(0, 10).replace(/-/g, '');
  return { hour: `runs:hour:${day}${iso.slice(11, 13)}`, day: `runs:day:${day}` };
}

function secondsToNextHour(now: Date): number {
  return 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds());
}

function secondsToNextDay(now: Date): number {
  return 86_400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());
}

/**
 * Counts this run against both windows and says whether it may proceed.
 *
 * Both windows are incremented even when the first one already refuses. That
 * is deliberate: the counters describe demand, not permitted demand, and a
 * refused run still represents a caller that tried. Reading them later to
 * decide whether the limits are right needs the true number.
 */
export async function consumeRunBudget(
  counter: RunCounter,
  now: Date = new Date(),
  env: Env = process.env,
): Promise<BudgetVerdict> {
  const maxPerHour = limitFrom(env, 'AUDITOR_MAX_RUNS_PER_HOUR', DEFAULT_MAX_RUNS_PER_HOUR);
  const maxPerDay = limitFrom(env, 'AUDITOR_MAX_RUNS_PER_DAY', DEFAULT_MAX_RUNS_PER_DAY);
  const keys = windowKeys(now);

  let hourCount: number;
  let dayCount: number;
  try {
    hourCount = await counter.increment(keys.hour, secondsToNextHour(now));
    dayCount = await counter.increment(keys.day, secondsToNextDay(now));
  } catch (error) {
    logWarn('run_budget_degraded', {
      note: 'The run counter is unreachable, so this run was allowed uncounted.',
      reason: error instanceof Error ? error.message : 'unknown error',
    });
    return { allowed: true };
  }

  if (dayCount > maxPerDay) {
    return { allowed: false, window: 'day', resetsInSeconds: secondsToNextDay(now) };
  }
  if (hourCount > maxPerHour) {
    return { allowed: false, window: 'hour', resetsInSeconds: secondsToNextHour(now) };
  }

  return { allowed: true };
}

/** What the settings screen and `/api/ready` report. */
export function runBudgetLimits(env: Env = process.env): { perHour: number; perDay: number } {
  return {
    perHour: limitFrom(env, 'AUDITOR_MAX_RUNS_PER_HOUR', DEFAULT_MAX_RUNS_PER_HOUR),
    perDay: limitFrom(env, 'AUDITOR_MAX_RUNS_PER_DAY', DEFAULT_MAX_RUNS_PER_DAY),
  };
}
