import { logWarn } from '../../../services/logger';
import { createRedisClient, isRedisConfigured, type RedisLike } from './redis';

/**
 * Rate limit on console unlock attempts.
 *
 * This lived in a module-level `Map`, which on serverless meant it reset on
 * every cold start and was scoped to one instance — an attacker spreading
 * attempts across instances met no limit at all, and the control read as
 * protection while providing close to none.
 *
 * It is durable when Redis is configured, and falls back to memory locally and
 * in tests, where a single process makes that accurate rather than misleading.
 *
 * Redis used to be required on Vercel because the run store needed it. The run
 * store is Postgres now, so nothing else forces Redis to exist — which means
 * a deploy can reach production with this silently in memory-only mode. That
 * is a real gap, recorded in `AGENTS.md`, not a design.
 *
 * Still a speed bump rather than a guarantee: the real defence is a
 * high-entropy token, which is why `docs/env.md` tells you to generate one with
 * `openssl rand -hex 32`.
 */

const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 5 * 60;

/**
 * Whether a Redis/KV endpoint is configured for the throttle.
 *
 * This lived in the persistence package while the run store was KV-backed. It
 * moved here when that store was replaced by Postgres: the throttle is now the
 * only thing that wants Redis, and a shared helper implied a coupling that no
 * longer exists.
 */
export function isThrottleKvConfigured(): boolean {
  return isRedisConfigured();
}

export interface ThrottleStore {
  isThrottled(key: string): Promise<boolean>;
  recordFailure(key: string): Promise<void>;
  clearFailures(key: string): Promise<void>;
}

export class MemoryThrottleStore implements ThrottleStore {
  private readonly attempts = new Map<string, { count: number; expiresAt: number }>();

  async isThrottled(key: string, now = Date.now()): Promise<boolean> {
    const entry = this.attempts.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.attempts.delete(key);
      return false;
    }
    return entry.count >= MAX_ATTEMPTS;
  }

  async recordFailure(key: string, now = Date.now()): Promise<void> {
    const entry = this.attempts.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.attempts.set(key, { count: 1, expiresAt: now + WINDOW_SECONDS * 1000 });
      return;
    }
    entry.count += 1;
  }

  async clearFailures(key: string): Promise<void> {
    this.attempts.delete(key);
  }

  reset(): void {
    this.attempts.clear();
  }
}

export class KvThrottleStore implements ThrottleStore {
  constructor(private readonly kv: RedisLike) {}

  private key(key: string): string {
    return `unlock:attempts:${key}`;
  }

  async isThrottled(key: string): Promise<boolean> {
    // A plain read: checking whether someone is throttled must not itself
    // count as an attempt. `recordFailure` is the only writer.
    const count = await this.kv.get<number>(this.key(key));
    return (Number(count) || 0) >= MAX_ATTEMPTS;
  }

  async recordFailure(key: string): Promise<void> {
    // INCR is atomic, so concurrent attempts across instances cannot race the
    // counter the way a read-modify-write would.
    const count = await this.kv.incr(this.key(key));
    if (count === 1) {
      await this.kv.expire(this.key(key), WINDOW_SECONDS);
    }
  }

  async clearFailures(key: string): Promise<void> {
    await this.kv.del(this.key(key));
  }
}

/**
 * A throttle that survives its Redis going away.
 *
 * Without this, an unreachable Redis is a total outage of the only way into
 * the product. It happened: the configured Upstash instance stopped resolving,
 * `isThrottled` threw `ENOTFOUND` on the first line of the sign-in route —
 * before any credential is read — and every attempt returned 500, whoever was
 * signing in and whatever they typed. A rate limiter had become the thing
 * standing between the operators and their own product.
 *
 * So a failure degrades to the in-process limiter rather than propagating. That
 * is weaker — per instance rather than global, which is exactly the weakness
 * the durable store exists to remove — but it still limits, and a degraded
 * limiter is worth more than a locked door. The `run_budget` counter already
 * made this trade; this now matches it.
 *
 * The switch latches for the life of the instance. Retrying the dead host on
 * every request would pay a DNS or connect timeout per sign-in, turning an
 * outage into something merely slow, which is harder to notice and worse to
 * use. Serverless instances are short-lived, so recovery costs nothing.
 */
const DEGRADED_RETRY_MS = 30_000;

/**
 * Errors that mean the store is *gone*, as opposed to unhappy.
 *
 * The distinction decides whether falling back is safe. A host that does not
 * resolve is an outage and memory is better than nothing. A store answering
 * "too many requests" is the opposite situation — it is the moment the limiter
 * is most needed — and treating that as a reason to switch the durable limiter
 * off would invert the control exactly under load. Same for a rejected token:
 * that is a misconfiguration, and `/api/ready` reports it.
 */
function isUnreachable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|socket hang up/i.test(
    message,
  );
}

export class ResilientThrottleStore implements ThrottleStore {
  private degradedUntil = 0;
  private warned = false;

  constructor(
    private readonly durable: ThrottleStore,
    private readonly fallback: ThrottleStore = new MemoryThrottleStore(),
    private readonly now: () => number = Date.now,
  ) {}

  private degraded(): boolean {
    return this.now() < this.degradedUntil;
  }

  /**
   * Records the outage and decides whether to keep using the durable store.
   *
   * Bounded rather than permanent. A latch for the life of the instance costs
   * the global limiter on the strength of one transient error, and under Fluid
   * Compute an instance is long-lived enough for that to matter. Thirty
   * seconds is long enough that a dead host is not re-dialled per request —
   * which is the cost the retry is avoiding — and short enough that recovery
   * does not wait for a deploy.
   */
  private fallBack(error: unknown): boolean {
    if (!isUnreachable(error)) {
      return false;
    }

    this.degradedUntil = this.now() + DEGRADED_RETRY_MS;

    // Guarded by its own synchronous flag rather than by the window above.
    // The sign-in route records both throttle keys with `Promise.all`, so two
    // calls are in flight when the first failure lands and both would see a
    // healthy window — a dead host would then bury the very line it is
    // raising. Set before any await, so the second caller sees it.
    if (!this.warned) {
      this.warned = true;
      logWarn('unlock_throttle_degraded', {
        note: 'The unlock throttle store is unreachable, so attempts are being counted in memory, per instance.',
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return true;
  }

  /**
   * Never answers "not throttled" because something broke.
   *
   * The fallback map starts empty, so answering from it on the request that
   * *discovered* the outage would hand whoever triggered it a fresh budget —
   * an attacker sitting at the limit could induce one error and start again.
   * Denying that single attempt costs a legitimate operator one retry during
   * an outage and removes the reset primitive entirely. Subsequent requests
   * are served from memory as normal.
   */
  async isThrottled(key: string): Promise<boolean> {
    if (this.degraded()) {
      return this.fallback.isThrottled(key);
    }

    try {
      return await this.durable.isThrottled(key);
    } catch (error) {
      this.fallBack(error);
      return true;
    }
  }

  async recordFailure(key: string): Promise<void> {
    if (this.degraded()) {
      return this.fallback.recordFailure(key);
    }

    try {
      await this.durable.recordFailure(key);
    } catch (error) {
      this.fallBack(error);
      // Counted either way. Losing the record because the store is unwell is
      // how a limiter quietly stops limiting.
      await this.fallback.recordFailure(key);
    }
  }

  async clearFailures(key: string): Promise<void> {
    if (this.degraded()) {
      return this.fallback.clearFailures(key);
    }

    try {
      await this.durable.clearFailures(key);
    } catch (error) {
      this.fallBack(error);
    }
  }
}

let store: ThrottleStore | undefined;

export function getThrottleStore(): ThrottleStore {
  if (!store) {
    store = isRedisConfigured()
      ? new ResilientThrottleStore(new KvThrottleStore(createRedisClient()))
      : new MemoryThrottleStore();
  }
  return store;
}
