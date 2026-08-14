import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSessionCookie,
  CONSOLE_COOKIE,
  createSessionValue,
  GLOBAL_THROTTLE_KEY,
  hasConsoleSession,
  isValidSessionValue,
  readCookie,
  safeEqual,
  SESSION_TTL_SECONDS,
  throttleKey,
} from '../../src/app/api/_lib/console-session';
import {
  KvThrottleStore,
  MemoryThrottleStore,
  ResilientThrottleStore,
  type ThrottleStore,
} from '../../src/app/api/_lib/unlock-throttle';

const SECRET = 'a'.repeat(32);

describe('session value', () => {
  it('round-trips a freshly issued session', () => {
    expect(isValidSessionValue(createSessionValue(SECRET), SECRET)).toBe(true);
  });

  it('rejects a session signed with a different secret', () => {
    // Rotating AUDITOR_RUN_TOKEN must invalidate every outstanding session.
    const value = createSessionValue(SECRET);
    expect(isValidSessionValue(value, 'b'.repeat(32))).toBe(false);
  });

  it('rejects an expired session', () => {
    const now = Date.now();
    const value = createSessionValue(SECRET, now);
    const afterExpiry = now + (SESSION_TTL_SECONDS + 60) * 1000;
    expect(isValidSessionValue(value, SECRET, afterExpiry)).toBe(false);
  });

  it('rejects an extended expiry, since the signature covers it', () => {
    const value = createSessionValue(SECRET);
    const signature = value.slice(value.indexOf('.') + 1);
    const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3650;
    expect(isValidSessionValue(`${farFuture}.${signature}`, SECRET)).toBe(false);
  });

  it('rejects malformed and empty values', () => {
    for (const value of ['', 'nonsense', '.', '123.', '.abc', null, undefined]) {
      expect(isValidSessionValue(value, SECRET)).toBe(false);
    }
  });
});

describe('safeEqual', () => {
  it('matches identical strings and rejects others, including length mismatches', () => {
    expect(safeEqual('token', 'token')).toBe(true);
    expect(safeEqual('token', 'toKen')).toBe(false);
    expect(safeEqual('token', 'token-longer')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('cookie handling', () => {
  it('reads its cookie out of a multi-cookie header', () => {
    const request = new Request('http://localhost:3000/', {
      headers: { cookie: `other=1; ${CONSOLE_COOKIE}=abc.def; another=2` },
    });
    expect(readCookie(request, CONSOLE_COOKIE)).toBe('abc.def');
  });

  it('returns null when the cookie header is absent', () => {
    expect(readCookie(new Request('http://localhost:3000/'), CONSOLE_COOKIE)).toBeNull();
  });

  it('marks the cookie HttpOnly, SameSite=Strict, and Secure only over https', () => {
    const secure = buildSessionCookie(
      'v',
      new Request('https://app.example/api'),
      SESSION_TTL_SECONDS,
    );
    expect(secure).toContain('HttpOnly');
    expect(secure).toContain('SameSite=Strict');
    expect(secure).toContain('Secure');

    // Local development runs on plain http; forcing Secure there would break it.
    expect(
      buildSessionCookie('v', new Request('http://localhost:3000/api'), SESSION_TTL_SECONDS),
    ).not.toContain('Secure');
  });

  it('sets Secure behind a TLS-terminating proxy that forwards over http', () => {
    // The browser spoke https even though this process sees http; without the
    // forwarded-proto check the cookie would be sendable in cleartext.
    const cookie = buildSessionCookie(
      'v',
      new Request('http://internal-host/api', {
        headers: { 'x-forwarded-proto': 'https' },
      }),
      SESSION_TTL_SECONDS,
    );
    expect(cookie).toContain('Secure');
  });

  it('honours only the first hop of a forwarded-proto chain', () => {
    const cookie = buildSessionCookie(
      'v',
      new Request('http://internal-host/api', {
        headers: { 'x-forwarded-proto': 'https, http' },
      }),
      SESSION_TTL_SECONDS,
    );
    expect(cookie).toContain('Secure');
  });

  it('accepts a request carrying a valid session cookie', () => {
    const request = new Request('http://localhost:3000/', {
      headers: { cookie: `${CONSOLE_COOKIE}=${createSessionValue(SECRET)}` },
    });
    expect(hasConsoleSession(request, SECRET)).toBe(true);
  });

  it('rejects a request with no cookie', () => {
    expect(hasConsoleSession(new Request('http://localhost:3000/'), SECRET)).toBe(false);
  });
});

describe('throttle key', () => {
  it('ignores client-settable forwarding headers', () => {
    // Keying on these would let an attacker rotate the header per request and
    // bypass the limit entirely.
    const spoofed = new Request('http://localhost:3000/api', {
      headers: { 'x-forwarded-for': '9.9.9.9', 'x-real-ip': '8.8.8.8' },
    });
    expect(throttleKey(spoofed)).toBe(GLOBAL_THROTTLE_KEY);
  });

  it('uses the platform-injected client ip when present', () => {
    const request = new Request('http://localhost:3000/api', {
      headers: { 'x-vercel-forwarded-for': '203.0.113.7, 10.0.0.1' },
    });
    expect(throttleKey(request)).toBe('203.0.113.7');
  });

  it('falls back to the shared bucket when no trusted header exists', () => {
    expect(throttleKey(new Request('http://localhost:3000/api'))).toBe(GLOBAL_THROTTLE_KEY);
  });
});

describe('unlock throttle', () => {
  let throttle: MemoryThrottleStore;

  beforeEach(() => {
    throttle = new MemoryThrottleStore();
  });

  it('blocks a key after repeated failures', async () => {
    expect(await throttle.isThrottled('1.2.3.4')).toBe(false);
    for (let i = 0; i < 8; i += 1) {
      await throttle.recordFailure('1.2.3.4');
    }
    expect(await throttle.isThrottled('1.2.3.4')).toBe(true);
  });

  it('does not block an unrelated key', async () => {
    for (let i = 0; i < 8; i += 1) {
      await throttle.recordFailure('1.2.3.4');
    }
    expect(await throttle.isThrottled('5.6.7.8')).toBe(false);
  });

  it('lets the window lapse', async () => {
    const now = Date.now();
    for (let i = 0; i < 8; i += 1) {
      await throttle.recordFailure('1.2.3.4', now);
    }
    expect(await throttle.isThrottled('1.2.3.4', now + 6 * 60 * 1000)).toBe(false);
  });

  it('clears on a successful unlock', async () => {
    for (let i = 0; i < 8; i += 1) {
      await throttle.recordFailure('1.2.3.4');
    }
    await throttle.clearFailures('1.2.3.4');
    expect(await throttle.isThrottled('1.2.3.4')).toBe(false);
  });
});

describe('KvThrottleStore', () => {
  function fakeKv() {
    const values = new Map<string, number>();
    const expires: string[] = [];
    return {
      values,
      expires,
      kv: {
        get: async <T,>(key: string) => (values.get(key) ?? null) as T | null,
        incr: async (key: string) => {
          const next = (values.get(key) ?? 0) + 1;
          values.set(key, next);
          return next;
        },
        expire: async (key: string) => {
          expires.push(key);
          return 1;
        },
        del: async (key: string) => values.delete(key),
      },
    };
  }

  it('counts failures atomically and blocks at the limit', async () => {
    const { kv } = fakeKv();
    const store = new KvThrottleStore(kv);

    for (let i = 0; i < 7; i += 1) {
      await store.recordFailure('1.2.3.4');
    }
    expect(await store.isThrottled('1.2.3.4')).toBe(false);

    await store.recordFailure('1.2.3.4');
    expect(await store.isThrottled('1.2.3.4')).toBe(true);
  });

  it('checking does not itself count as an attempt', async () => {
    // A read that incremented would let a passive check lock out the operator.
    const { kv, values } = fakeKv();
    const store = new KvThrottleStore(kv);

    await store.recordFailure('1.2.3.4');
    for (let i = 0; i < 20; i += 1) {
      await store.isThrottled('1.2.3.4');
    }

    expect(values.get('unlock:attempts:1.2.3.4')).toBe(1);
  });

  it('sets an expiry once, when the window opens', async () => {
    const { kv, expires } = fakeKv();
    const store = new KvThrottleStore(kv);

    await store.recordFailure('1.2.3.4');
    await store.recordFailure('1.2.3.4');

    expect(expires).toEqual(['unlock:attempts:1.2.3.4']);
  });

  it('clears the counter on a successful unlock', async () => {
    const { kv, values } = fakeKv();
    const store = new KvThrottleStore(kv);

    await store.recordFailure('1.2.3.4');
    await store.clearFailures('1.2.3.4');

    expect(values.has('unlock:attempts:1.2.3.4')).toBe(false);
  });
});

describe('ResilientThrottleStore', () => {
  /**
   * A dead cache must not become a locked door.
   *
   * The configured Upstash instance stopped resolving and `isThrottled` threw
   * `ENOTFOUND` on the first line of the sign-in route — before any credential
   * is read — so every sign-in returned 500 regardless of who was signing in
   * or what they typed. The rate limiter had become the thing standing between
   * the operators and their own product.
   */
  const dead: ThrottleStore = {
    isThrottled: () => Promise.reject(new Error('getaddrinfo ENOTFOUND redis.example')),
    recordFailure: () => Promise.reject(new Error('getaddrinfo ENOTFOUND redis.example')),
    clearFailures: () => Promise.reject(new Error('getaddrinfo ENOTFOUND redis.example')),
  };

  it('answers instead of throwing when the durable store is unreachable', async () => {
    const store = new ResilientThrottleStore(dead);

    await expect(store.isThrottled('anybody')).resolves.toBe(false);
    await expect(store.recordFailure('anybody')).resolves.toBeUndefined();
    await expect(store.clearFailures('anybody')).resolves.toBeUndefined();
  });

  it('still limits, in memory, once it has degraded', async () => {
    // Weaker than the durable store — per instance rather than global — but a
    // degraded limiter is worth more than no product.
    const store = new ResilientThrottleStore(dead);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await store.recordFailure('one-address');
    }

    expect(await store.isThrottled('one-address')).toBe(true);
    expect(await store.isThrottled('another-address')).toBe(false);
  });

  it('says so once, not once per request', async () => {
    // A dead host would otherwise bury the log line it is trying to raise.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new ResilientThrottleStore(dead);

    await store.isThrottled('a');
    await store.isThrottled('b');
    await store.recordFailure('c');

    const degraded = warn.mock.calls.filter((call) =>
      String(call[0]).includes('unlock_throttle_degraded'),
    );
    expect(degraded).toHaveLength(1);
    warn.mockRestore();
  });

  it('uses the durable store while it is healthy', async () => {
    const healthy = new MemoryThrottleStore();
    const store = new ResilientThrottleStore(healthy, new MemoryThrottleStore());

    await store.recordFailure('key');

    // Recorded in the durable store, not the fallback.
    expect(await healthy.isThrottled('key')).toBe(false);
    await Promise.all(Array.from({ length: 7 }, () => store.recordFailure('key')));
    expect(await healthy.isThrottled('key')).toBe(true);
  });
});
