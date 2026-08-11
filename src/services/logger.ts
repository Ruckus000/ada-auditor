/**
 * One shape for every structured event this system emits.
 *
 * Before this existed there were five call sites building their own JSON, and
 * they had already drifted: `persistence/index.ts` keyed its event `event`
 * while everything else keyed it `type`, so a log pipeline filtering on `type`
 * silently dropped the loudest warning in the product ("nothing is being
 * persisted"). A shared helper is the only thing that stops that recurring.
 *
 * `type` is required, and it is written first so a human scanning raw output
 * sees what an event is without reading to the end of the line.
 *
 * This lives in `services` rather than `integrations` on purpose: it imports
 * no framework and no browser, which keeps every module that logs inside the
 * fast unit suite.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

/**
 * Keys whose values never belong in a log line.
 *
 * Matched on the key, not the value: a value-based check cannot tell a token
 * from any other opaque string, so it would either miss secrets or redact
 * request ids. Substring matching covers the shapes this codebase actually
 * uses — `runToken`, `authorization`, `KV_REST_API_TOKEN`, `credentialRef` —
 * without anyone having to maintain an exhaustive list.
 */
const SECRET_KEY_PATTERN = /token|secret|password|authorization|cookie|credential/i;

/** Reserved by the envelope. A caller cannot relabel or backdate an event. */
const ENVELOPE_KEYS = new Set(['type', 'level', 'ts']);

export const REDACTED = '[redacted]';

/** Stands in for anything the serialiser cannot safely render. */
const UNSERIALISABLE = '[unserialisable]';

/**
 * Replaces secret-shaped values, recursively.
 *
 * Depth is bounded because a log call is not worth a stack overflow, and
 * anything nested six deep is not being read by a human anyway. Cycles are
 * tracked separately: depth alone would still hand a self-referencing object
 * to `JSON.stringify` at the bottom, and a logger that throws is worst exactly
 * where it matters most — inside an error handler, where throwing loses the
 * original error.
 */
function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') {
    return value;
  }

  // Tracks the current path, not everything ever visited: a value referenced
  // twice as siblings is repetition, not a cycle, and reporting it as one
  // would hide a field that is perfectly loggable.
  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((entry) => redact(entry, depth + 1, seen));
    }

    const out: LogFields = {};
    for (const [key, entry] of Object.entries(value as LogFields)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(entry, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * Emits one structured line.
 *
 * Envelope keys are stripped from the caller's fields rather than merged over,
 * so `type` keeps its leading position *and* its meaning. A caller passing
 * `{ type: 'something-else' }` cannot silently relabel the event.
 */
export function logEvent(level: LogLevel, type: string, fields: LogFields = {}): void {
  const rest = redact(fields) as LogFields;
  for (const key of ENVELOPE_KEYS) {
    delete rest[key];
  }

  // Cycles are already handled, but a BigInt or a throwing `toJSON` still is
  // not. The envelope alone is worth more than nothing, so fall back to it
  // rather than let a log call take down its caller.
  let line: string;
  try {
    line = JSON.stringify({ type, level, ts: new Date().toISOString(), ...rest });
  } catch {
    line = JSON.stringify({ type, level, ts: new Date().toISOString(), fields: UNSERIALISABLE });
  }

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logInfo(type: string, fields: LogFields = {}): void {
  logEvent('info', type, fields);
}

export function logWarn(type: string, fields: LogFields = {}): void {
  logEvent('warn', type, fields);
}

// No `logError` shorthand: nothing emits at error level yet, and `logEvent`
// takes the level directly. A wrapper exercised only by its own test is the
// "code without a caller" this repo has already deleted once.
