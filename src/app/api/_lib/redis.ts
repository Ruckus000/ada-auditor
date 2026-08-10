import { Redis } from '@upstash/redis';

/**
 * The one place that knows how Redis is configured.
 *
 * Two things want a durable counter now — the console unlock throttle and the
 * run budget — and they want different semantics from it: the throttle counts
 * *failures* and clears them on success, the budget counts *requests* and
 * never clears. Conflating them would have been the trap. Sharing the
 * connection details, which are genuinely the same fact, is not.
 *
 * Both `KV_REST_API_*` (what the Vercel marketplace integration injects) and
 * `UPSTASH_REDIS_REST_*` (what Upstash's own docs use) are accepted, because
 * which pair you get depends on how the store was created.
 */

export type RedisLike = {
  get<T>(key: string): Promise<T | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export function isRedisConfigured(): boolean {
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

export function createRedisClient(): RedisLike {
  return new Redis({
    url: (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN)!,
  });
}
