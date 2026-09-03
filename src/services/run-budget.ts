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

/**
 * Previews count separately, against their own ceiling.
 *
 * A preview is the runner minus the audit: same Chromium, same walk, but no
 * axe scan, no advisory call, and nothing persisted. So it costs browser time
 * and not much else, where a run costs browser time plus an Opus call — which
 * is most of what the audit budget is defending.
 *
 * Sharing one counter made authoring compete with auditing for the same
 * twenty, and the loser was whichever happened second. An operator iterating
 * on a stale selector could spend the hour's audits without running one, and
 * the scheduler would then refuse a real client's audit because somebody was
 * typing. Two counters means the failure mode of authoring is "wait to verify
 * again", never "the audit that was due did not happen".
 *
 * Higher than the run ceiling because verifying is a loop and auditing is a
 * decision: shaping one journey's steps is ten or twenty walks, and a client
 * gets audited once. These numbers are a starting point rather than a
 * measurement, in the same spirit as `DEFAULT_MAX_PAGES` — the thing that will
 * replace the guess is `journey_preview`'s `durationMs` across a real
 * authoring session, not a tighter argument here.
 */
export const DEFAULT_MAX_PREVIEWS_PER_HOUR = 40;
export const DEFAULT_MAX_PREVIEWS_PER_DAY = 200;

/**
 * Document work counts against a third ceiling.
 *
 * Every inspection, conversion, repair and intake launches a JVM — and a
 * converter for Word — on a function that may run five minutes. Until this
 * counter existed those routes were authenticated and uncounted, so a leaked
 * machine token or a caller in a loop had nothing in the way at all, and the
 * two budgets above defended only the audits.
 *
 * Its own counter for the reason previews have one: "Inspect all unreviewed"
 * walks an inventory of up to two hundred documents in one click, and on a
 * shared counter one sweep would spend every audit a client had bought.
 *
 * One counter rather than one per kind. A conversion costs ten times what an
 * inspection does, but what is being bounded is function time under a caller
 * that should not be there, and one number bounds it. Sized against real use,
 * not a guess at abuse: an inventory sweep is two hundred requests, the blind
 * harness posts a hundred and fifty rows in one run, and at roughly ten
 * seconds of function time a launch, five hundred an hour is about the same
 * function-minutes the run ceiling already permits. A starting point, like
 * the preview defaults; `document_inspected` and `document_converted` carry
 * the durations that will replace it.
 */
export const DEFAULT_MAX_DOCUMENTS_PER_HOUR = 500;
export const DEFAULT_MAX_DOCUMENTS_PER_DAY = 2000;

type BudgetPrefix = 'runs' | 'previews' | 'documents';

/** What separates one budget from another: its counter keys and its limits. */
type BudgetSpec = {
  prefix: BudgetPrefix;
  /** What one unit of it is called when the degraded log line names it. */
  noun: string;
  hourEnv: string;
  dayEnv: string;
  hourDefault: number;
  dayDefault: number;
};

const RUNS: BudgetSpec = {
  prefix: 'runs',
  noun: 'run',
  hourEnv: 'AUDITOR_MAX_RUNS_PER_HOUR',
  dayEnv: 'AUDITOR_MAX_RUNS_PER_DAY',
  hourDefault: DEFAULT_MAX_RUNS_PER_HOUR,
  dayDefault: DEFAULT_MAX_RUNS_PER_DAY,
};

const PREVIEWS: BudgetSpec = {
  prefix: 'previews',
  noun: 'preview',
  hourEnv: 'AUDITOR_MAX_PREVIEWS_PER_HOUR',
  dayEnv: 'AUDITOR_MAX_PREVIEWS_PER_DAY',
  hourDefault: DEFAULT_MAX_PREVIEWS_PER_HOUR,
  dayDefault: DEFAULT_MAX_PREVIEWS_PER_DAY,
};

const DOCUMENTS: BudgetSpec = {
  prefix: 'documents',
  noun: 'document action',
  hourEnv: 'AUDITOR_MAX_DOCUMENTS_PER_HOUR',
  dayEnv: 'AUDITOR_MAX_DOCUMENTS_PER_DAY',
  hourDefault: DEFAULT_MAX_DOCUMENTS_PER_HOUR,
  dayDefault: DEFAULT_MAX_DOCUMENTS_PER_DAY,
};

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

/**
 * `runs:hour:YYYYMMDDHH` — the key is the clock.
 *
 * The prefix is what keeps the two budgets from spending each other: previews
 * write `previews:hour:…`, so the same window can refuse one and allow the
 * other. It defaults to `runs` because every caller before previews existed
 * meant runs, and a default here is cheaper than an argument at each of them.
 */
export function windowKeys(
  now: Date,
  prefix: BudgetPrefix = 'runs',
): { hour: string; day: string } {
  const iso = now.toISOString();
  const day = iso.slice(0, 10).replace(/-/g, '');
  return { hour: `${prefix}:hour:${day}${iso.slice(11, 13)}`, day: `${prefix}:day:${day}` };
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
  return consumeBudget(RUNS, counter, now, env);
}

/**
 * The same, spent against the preview ceiling instead.
 *
 * Separate entry point rather than a flag, so a call site cannot spend the
 * wrong budget by passing the wrong boolean — the name at the call site says
 * which thing is being paid for.
 */
export async function consumePreviewBudget(
  counter: RunCounter,
  now: Date = new Date(),
  env: Env = process.env,
): Promise<BudgetVerdict> {
  return consumeBudget(PREVIEWS, counter, now, env);
}

/**
 * The same, spent against the document ceiling — one call per inspection,
 * conversion, repair or intake, made before the body is buffered or the
 * document fetched, so a caller past the ceiling costs the function nothing
 * but the answer.
 */
export async function consumeDocumentBudget(
  counter: RunCounter,
  now: Date = new Date(),
  env: Env = process.env,
): Promise<BudgetVerdict> {
  return consumeBudget(DOCUMENTS, counter, now, env);
}

async function consumeBudget(
  spec: BudgetSpec,
  counter: RunCounter,
  now: Date,
  env: Env,
): Promise<BudgetVerdict> {
  const maxPerHour = limitFrom(env, spec.hourEnv, spec.hourDefault);
  const maxPerDay = limitFrom(env, spec.dayEnv, spec.dayDefault);
  const keys = windowKeys(now, spec.prefix);

  let hourCount: number;
  let dayCount: number;
  try {
    hourCount = await counter.increment(keys.hour, secondsToNextHour(now));
    dayCount = await counter.increment(keys.day, secondsToNextDay(now));
  } catch (error) {
    logWarn('run_budget_degraded', {
      // Which ceiling stopped being enforced, now that there are three of
      // them. Without this the line cannot tell "we stopped counting audits"
      // from "we stopped counting previews", and those are different sizes
      // of problem — one is the bill, the other is browser time.
      budget: spec.prefix,
      note: `The ${spec.prefix} counter is unreachable, so this ${spec.noun} was allowed uncounted.`,
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
  return limitsOf(RUNS, env);
}

/** The document ceiling, for the settings screen and the refusal's sentence. */
export function documentBudgetLimits(env: Env = process.env): { perHour: number; perDay: number } {
  return limitsOf(DOCUMENTS, env);
}

function limitsOf(spec: BudgetSpec, env: Env): { perHour: number; perDay: number } {
  return {
    perHour: limitFrom(env, spec.hourEnv, spec.hourDefault),
    perDay: limitFrom(env, spec.dayEnv, spec.dayDefault),
  };
}
