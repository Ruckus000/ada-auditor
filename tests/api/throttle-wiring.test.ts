import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wiring, not the class.
 *
 * `console-session.test.ts` proves `ResilientThrottleStore` degrades correctly
 * when it is handed a dead store. That is not the same as proving the product
 * builds one: drop the wrapper from `getThrottleStore` and those tests stay
 * green while every sign-in returns 500 again, which is exactly how this
 * failed in production — the sign-in route asks the throttle before it reads
 * any credential, so an unreachable Redis was a total outage of the only way
 * into the product.
 *
 * Its own file because `getThrottleStore` memoises on first use with no reset
 * seam; a fresh module registry per file is what makes the first call here
 * actually the first.
 */

vi.mock('../../src/app/api/_lib/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/app/api/_lib/redis')>()),
  createRedisClient: () => ({
    get: () => Promise.reject(new Error('getaddrinfo ENOTFOUND dead.upstash.io')),
    incr: () => Promise.reject(new Error('getaddrinfo ENOTFOUND dead.upstash.io')),
    expire: () => Promise.reject(new Error('getaddrinfo ENOTFOUND dead.upstash.io')),
    del: () => Promise.reject(new Error('getaddrinfo ENOTFOUND dead.upstash.io')),
  }),
}));

const { getThrottleStore } = await import('../../src/app/api/_lib/unlock-throttle');

const original = {
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
};

beforeEach(() => {
  process.env.KV_REST_API_URL = 'https://dead.upstash.io';
  process.env.KV_REST_API_TOKEN = 'token';
});

afterEach(() => {
  if (original.url === undefined) delete process.env.KV_REST_API_URL;
  else process.env.KV_REST_API_URL = original.url;
  if (original.token === undefined) delete process.env.KV_REST_API_TOKEN;
  else process.env.KV_REST_API_TOKEN = original.token;
});

describe('getThrottleStore, with a configured but dead Redis', () => {
  it('returns a store that answers rather than one that throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = getThrottleStore();

    // The first line of the sign-in route. A rejection here is a 500 before
    // any credential has been looked at.
    await expect(store.isThrottled('anybody')).resolves.toBe(false);
    await expect(store.recordFailure('anybody')).resolves.toBeUndefined();

    warn.mockRestore();
  });
});
