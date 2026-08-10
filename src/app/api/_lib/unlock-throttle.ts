import { Redis } from '@upstash/redis';

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
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  );
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

type ThrottleKv = {
  get<T>(key: string): Promise<T | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export class KvThrottleStore implements ThrottleStore {
  constructor(private readonly kv: ThrottleKv) {}

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

let store: ThrottleStore | undefined;

export function getThrottleStore(): ThrottleStore {
  if (!store) {
    store = isThrottleKvConfigured()
      ? new KvThrottleStore(
          new Redis({
            url: (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL)!,
            token: (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN)!,
          }),
        )
      : new MemoryThrottleStore();
  }
  return store;
}
