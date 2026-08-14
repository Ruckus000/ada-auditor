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

/**
 * `retries` exists for the readiness probe.
 *
 * The client defaults to five attempts with exponential backoff, so a single
 * call against a host that does not resolve spends well over a second before
 * it gives up — fine for a counter that runs once per sign-in, wrong for a
 * probe on an endpoint the console banner polls. A probe that hangs turns a
 * non-gating warning into an apparently dead control plane, which is the
 * failure this whole check was added to prevent.
 */
export function createRedisClient(options: { retries?: number } = {}): RedisLike {
  return new Redis({
    url: (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN)!,
    ...(options.retries === undefined ? {} : { retry: { retries: options.retries } }),
  });
}
