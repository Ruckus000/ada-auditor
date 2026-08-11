import type { RunCounter } from '../../../services/run-budget';
import { createRedisClient, isRedisConfigured, type RedisLike } from './redis';

/**
 * The counter behind the run budget.
 *
 * Durable when Redis is configured, in process otherwise — and in process is
 * genuinely degraded here, not merely different: serverless instances each get
 * their own map, so the effective ceiling is the limit times however many
 * instances happen to be warm. `/api/ready` and the settings screen say so.
 *
 * `INCR` is atomic, which is the whole reason this is a counter in Redis
 * rather than a row in Postgres: concurrent runs across instances cannot race
 * a read-modify-write, and a cost control that undercounts under load is
 * counting the wrong thing.
 */

export class MemoryRunCounter implements RunCounter {
  private readonly counts = new Map<string, { value: number; expiresAt: number }>();

  async increment(key: string, windowSeconds: number, now = Date.now()): Promise<number> {
    const entry = this.counts.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.counts.set(key, { value: 1, expiresAt: now + windowSeconds * 1000 });
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }

  reset(): void {
    this.counts.clear();
  }
}

export class RedisRunCounter implements RunCounter {
  constructor(private readonly redis: RedisLike) {}

  async increment(key: string, windowSeconds: number): Promise<number> {
    const value = await this.redis.incr(key);
    // Only on first write, so a busy window is not repeatedly extended into
    // never expiring.
    if (value === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    return value;
  }
}

let counter: RunCounter | undefined;

export function getRunCounter(): RunCounter {
  counter ??= isRedisConfigured() ? new RedisRunCounter(createRedisClient()) : new MemoryRunCounter();
  return counter;
}

/**
 * Test seams, matching `setRunStore`/`resetRunStore`.
 *
 * The unlock throttle's singleton has no setter, which is why its tests have
 * to instantiate stores by hand. Worth not repeating.
 */
export function setRunCounter(next: RunCounter): void {
  counter = next;
}

export function resetRunCounter(): void {
  counter = undefined;
}
