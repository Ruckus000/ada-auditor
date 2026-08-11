import type { StoredRunRecord } from './persistence';

/**
 * A run that died mid-flight and never said so.
 *
 * `executeRun` is the only thing that overwrites the `running` placeholder, so
 * a timeout, a crash or a cold-start eviction leaves the row `running`
 * forever. `buildClientDetail` then surfaces it as the journey's last run, and
 * the screen shows a scan that has apparently been going since Tuesday.
 *
 * The threshold is generous on purpose. `maxDuration` is 300s and the platform
 * kills the invocation there; anything still `running` well past that is not
 * slow, it is gone. Being wrong in this direction costs a run being called
 * abandoned a minute early — being wrong the other way leaves a permanent lie
 * on the client's screen.
 *
 * Pure, and applied in two places for two different reasons: on read, so a
 * screen is never wrong even a second before the sweep runs; and by the
 * scheduled sweep, so the database stops disagreeing with the screen. Neither
 * is sufficient alone.
 */

/** 300s `maxDuration` plus a minute of grace. */
export const RUN_STALE_AFTER_MS = 360_000;

/** Just the shape this module reads, so a test can pass one key. Same reason
 * `services/deployment-config.ts` declares its own `Env`. */
export type Env = Record<string, string | undefined>;

export function staleAfterMs(env: Env = process.env): number {
  const configured = Number(env.AUDITOR_RUN_STALE_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured) * 1000
    : RUN_STALE_AFTER_MS;
}

export function isAbandoned(
  run: Pick<StoredRunRecord, 'status' | 'startedAt' | 'createdAt'>,
  now = Date.now(),
  threshold = RUN_STALE_AFTER_MS,
): boolean {
  if (run.status !== 'running') return false;

  // `startedAt` is the honest answer; `createdAt` is the fallback for runs
  // recorded before it existed, where it happens to mean the same thing —
  // a run still `running` was never rewritten, so its createdAt is its start.
  const started = Date.parse(run.startedAt ?? run.createdAt);
  if (!Number.isFinite(started)) return false;

  return now - started > threshold;
}

/**
 * The record as it should be read, given how long it has been running.
 *
 * Returns the input unchanged when nothing is wrong, so callers can apply it
 * unconditionally without copying every record on every read.
 */
export function reconcileRunStatus(
  run: StoredRunRecord,
  now = Date.now(),
  threshold = RUN_STALE_AFTER_MS,
): StoredRunRecord {
  if (!isAbandoned(run, now, threshold)) return run;

  return { ...run, status: 'failed', failureReason: 'run_timed_out' };
}
