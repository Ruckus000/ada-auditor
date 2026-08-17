import { describe, expect, it } from 'vitest';
import {
  assertAllowedUrl,
  assertPeerAddressAllowed,
  assertSafeTargetUrl,
  assertSettledOnTarget,
  isBlockedAddress,
  isOnTargetHost,
  parseTargetUrl,
  UnsafeTargetError,
} from '../../src/integrations/browser/target-url';

const ALLOWED = ['app.example.com'];

describe('parseTargetUrl', () => {
  it('accepts http and https', () => {
    expect(parseTargetUrl('https://app.example.com/x').protocol).toBe('https:');
    expect(parseTargetUrl('http://app.example.com/x').protocol).toBe('http:');
  });

  it('rejects file:// — it would make an audit a local file read', () => {
    expect(() => parseTargetUrl('file:///etc/passwd')).toThrow(UnsafeTargetError);
  });

  it.each(['data:text/html,<h1>x', 'javascript:alert(1)', 'ftp://example.com/x'])(
    'rejects %s',
    (url) => {
      expect(() => parseTargetUrl(url)).toThrow(UnsafeTargetError);
    },
  );

  it('rejects embedded credentials', () => {
    expect(() => parseTargetUrl('https://user:pass@app.example.com/')).toThrow(UnsafeTargetError);
  });

  it('rejects malformed input', () => {
    expect(() => parseTargetUrl('not a url')).toThrow(UnsafeTargetError);
  });
});

describe('isBlockedAddress', () => {
  it.each([
    ['169.254.169.254', 'cloud metadata endpoint'],
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback range'],
    ['10.0.0.1', 'RFC1918'],
    ['10.255.255.255', 'RFC1918 upper bound'],
    ['172.16.0.1', 'RFC1918'],
    ['172.31.255.255', 'RFC1918 upper bound'],
    ['192.168.1.1', 'RFC1918'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'this network'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'IPv6 link-local'],
    ['fc00::1', 'IPv6 unique-local'],
    ['fd12:3456::1', 'IPv6 unique-local'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata endpoint'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['93.184.216.34', 'public IPv4'],
    ['8.8.8.8', 'public IPv4'],
    ['172.32.0.1', 'just outside RFC1918'],
    ['11.0.0.1', 'just outside 10/8'],
    ['2606:2800:220:1:248:1893:25c8:1946', 'public IPv6'],
  ])('allows %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it('refuses anything that is not an address at all', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('assertAllowedUrl', () => {
  it('accepts a host on the allowlist', () => {
    expect(assertAllowedUrl('https://app.example.com/dashboard', ALLOWED).hostname).toBe(
      'app.example.com',
    );
  });

  it('accepts a subdomain of an allowed host', () => {
    expect(assertAllowedUrl('https://eu.app.example.com/x', ALLOWED).hostname).toBe(
      'eu.app.example.com',
    );
  });

  it('rejects a host that merely ends with the allowed string', () => {
    // `evil-app.example.com.attacker.com` must not pass as `app.example.com`.
    expect(() => assertAllowedUrl('https://app.example.com.attacker.com/', ALLOWED)).toThrow(
      UnsafeTargetError,
    );
  });

  it('rejects an unrelated host', () => {
    expect(() => assertAllowedUrl('https://attacker.com/', ALLOWED)).toThrow(UnsafeTargetError);
  });

  it('fails closed when no hosts are configured', () => {
    // An empty allowlist is the scope of a fixture-only run. It must deny
    // every URL rather than wave them all through.
    expect(() => assertAllowedUrl('https://app.example.com/', [])).toThrow(UnsafeTargetError);
    expect(() => assertAllowedUrl('http://127.0.0.1/', [])).toThrow(UnsafeTargetError);
  });

  it('range-checks a literal IP host even if allowlisted', () => {
    expect(() => assertAllowedUrl('http://169.254.169.254/latest/meta-data/', ['169.254.169.254']))
      .toThrow(UnsafeTargetError);
    expect(() => assertAllowedUrl('http://[::1]:8080/', ['::1'])).toThrow(UnsafeTargetError);
  });

  it('is case-insensitive about hostnames', () => {
    expect(assertAllowedUrl('https://APP.Example.COM/x', ALLOWED).hostname).toBe('app.example.com');
  });
});

describe('assertSafeTargetUrl', () => {
  it('rejects a public hostname that resolves into private space', async () => {
    // localhost is the reliable stand-in for the rebinding case: a name on the
    // allowlist whose A record points at loopback.
    await expect(assertSafeTargetUrl('http://localhost:3000/', ['localhost'])).rejects.toThrow(
      UnsafeTargetError,
    );
  });

  it('rejects an unresolvable host rather than letting the browser try', async () => {
    await expect(
      assertSafeTargetUrl('https://nx.invalid/', ['nx.invalid']),
    ).rejects.toThrow(UnsafeTargetError);
  });

  it('still enforces scheme and allowlist before resolving', async () => {
    await expect(assertSafeTargetUrl('file:///etc/passwd', ALLOWED)).rejects.toThrow(
      UnsafeTargetError,
    );
    await expect(assertSafeTargetUrl('https://attacker.com/', ALLOWED)).rejects.toThrow(
      UnsafeTargetError,
    );
  });
});

/**
 * Addresses as a URL actually delivers them.
 *
 * The suite above calls `isBlockedAddress` with hand-written strings, and that
 * is how an open bypass shipped green: it asserted `isBlockedAddress`
 * ('::ffff:169.254.169.254') is true — which it was — while the guard unwrapped
 * IPv4-mapped addresses by matching that dotted spelling as text, and `new URL()`
 * never produces it. `http://[::ffff:169.254.169.254]/` arrives as
 * `[::ffff:a9fe:a9fe]`, matched nothing, and was allowed through to Chromium.
 *
 * So these go through the entry point the request path uses, with the
 * allowlist derived exactly as `journey-runner` derives it — from the caller's
 * own target, which is what makes the allowlist self-satisfying and leaves the
 * address check as the only thing standing.
 */
describe('assertSafeTargetUrl, on an address the URL parser has re-spelled', () => {
  const selfAllowed = (rawUrl: string): Promise<URL> =>
    assertSafeTargetUrl(rawUrl, [new URL(rawUrl).hostname]);

  it.each([
    ['http://[::ffff:169.254.169.254]/', 'IPv4-mapped cloud metadata'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback'],
    ['http://[::ffff:10.0.0.5]/', 'IPv4-mapped RFC1918'],
    ['http://[::ffff:192.168.1.1]/', 'IPv4-mapped RFC1918'],
    ['http://[::127.0.0.1]/', 'IPv4-compatible loopback'],
    ['http://[64:ff9b::169.254.169.254]/', 'NAT64 cloud metadata'],
    ['http://[2002:7f00:1::]/', '6to4 loopback'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[fe80::1]/', 'IPv6 link-local'],
    ['http://[fd12:3456::1]/', 'IPv6 unique-local'],
    ['http://[ff02::1]/', 'IPv6 multicast'],
    ['http://127.0.0.1/', 'IPv4 loopback'],
    ['http://2130706433/', 'decimal-encoded loopback'],
    ['http://0x7f000001/', 'hex-encoded loopback'],
    ['http://127.1/', 'short-form loopback'],
  ])('refuses %s (%s)', async (rawUrl) => {
    await expect(selfAllowed(rawUrl)).rejects.toThrow(UnsafeTargetError);
  });

  it.each([
    ['http://[2606:2800:220:1:248:1893:25c8:1946]/', 'public IPv6'],
    ['http://[::ffff:93.184.216.34]/', 'IPv4-mapped public address'],
    ['http://93.184.216.34/', 'public IPv4'],
  ])('allows %s (%s)', async (rawUrl) => {
    await expect(selfAllowed(rawUrl)).resolves.toBeInstanceOf(URL);
  });

  it('reads every spelling of one address the same way', async () => {
    // The property the old check did not have. These are the same host.
    for (const spelling of [
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:7f00:0001',
      '::FFFF:7F00:1',
    ]) {
      expect(isBlockedAddress(spelling), spelling).toBe(true);
    }
  });
});

describe('assertPeerAddressAllowed', () => {
  /**
   * The check that closes DNS rebinding, which nothing closed before.
   *
   * The module's header used to say the post-navigation URL re-check caught
   * it. It could not: after a rebind the settled URL still carries the
   * hostname the caller supplied, that hostname is on the allowlist because
   * the allowlist is *derived* from it, and it is not a literal IP — so not
   * one of the three checks looks at anything that changed. The address the
   * browser connected to is the only witness.
   */
  it.each([
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', 'cloud metadata'],
    ['10.1.2.3', 'RFC1918'],
    ['192.168.0.7', 'RFC1918'],
    ['::1', 'IPv6 loopback'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback, as Chromium reports a dual-stack peer'],
  ])('refuses a page served from %s (%s)', (ipAddress) => {
    expect(() => assertPeerAddressAllowed('https://audit-me.example/', ipAddress)).toThrow(
      UnsafeTargetError,
    );
  });

  it('allows a public peer', () => {
    expect(() =>
      assertPeerAddressAllowed('https://audit-me.example/', '93.184.216.34'),
    ).not.toThrow();
  });

  it('reads the bracketed form Chromium actually reports', () => {
    // `serverAddr()` returns `[::1]`, not `::1`. Unbracketed, `isIP` says 0 and
    // `isBlockedAddress` refuses everything — so this check failed closed on
    // every IPv6 peer, public ones included, and the range logic written for
    // it never ran. The same class of mistake as the dotted-quad regex: a test
    // written against a spelling the producer does not emit.
    expect(() => assertPeerAddressAllowed('https://audit-me.example/', '[::1]')).toThrow(
      UnsafeTargetError,
    );
    expect(() =>
      assertPeerAddressAllowed('https://audit-me.example/', '[2606:2800:220:1:248:1893:25c8:1946]'),
    ).not.toThrow();
  });

  it('allows a response the browser never dialled for', () => {
    // Cache hits and same-document navigations have no peer. Refusing them
    // would fail runs for a request that never left the machine.
    expect(() => assertPeerAddressAllowed('https://audit-me.example/', undefined)).not.toThrow();
  });

  it('names the address in the error, because the hostname will look innocent', () => {
    // The whole point of a rebind is that the URL is unremarkable. An error
    // that quoted only the URL would send the next reader looking in the
    // wrong place.
    expect(() => assertPeerAddressAllowed('https://audit-me.example/', '169.254.169.254')).toThrow(
      /169\.254\.169\.254/,
    );
  });
});

/**
 * "May the browser go here" and "is what is here the client's site" are two
 * questions that had one answer for as long as the allowlist held one host.
 *
 * They come apart the moment a journey may pass through an identity provider:
 * Okta is a yes to the first and must always be a no to the second. Everything
 * that keeps a third party's login page out of a client's report — and keeps a
 * run that never got in from being scored as a clean audit — rests on this
 * telling them apart correctly.
 */
describe('isOnTargetHost', () => {
  it('accepts the host itself and anything below it', () => {
    // Subdomains count: the apex-to-www hop is what half the web does on the
    // first request, and an exact match would refuse it.
    expect(isOnTargetHost('https://acme.com/dashboard', 'acme.com')).toBe(true);
    expect(isOnTargetHost('https://www.acme.com/', 'acme.com')).toBe(true);
    expect(isOnTargetHost('https://app.eu.acme.com/', 'acme.com')).toBe(true);
  });

  it('is not fooled by a name that merely ends the same way', () => {
    // The dot is load-bearing. Without it `notacme.com` and `evil-acme.com`
    // both end with `acme.com`, and either is a domain anyone can register.
    expect(isOnTargetHost('https://notacme.com/', 'acme.com')).toBe(false);
    expect(isOnTargetHost('https://evil-acme.com/', 'acme.com')).toBe(false);
  });

  it('is not fooled by the target appearing as a prefix', () => {
    // The other direction, and the one an attacker controls entirely: any
    // subdomain of a domain they own can be spelled to read like the target.
    expect(isOnTargetHost('https://acme.com.evil.test/', 'acme.com')).toBe(false);
  });

  it('ignores case and a trailing root dot, which are the same host', () => {
    expect(isOnTargetHost('https://WWW.ACME.COM/', 'acme.com')).toBe(true);
    expect(isOnTargetHost('https://acme.com./', 'acme.com')).toBe(true);
  });

  it('treats what it cannot parse as not the target', () => {
    // Refusing to judge is not the same as approving. Anything unreadable
    // cannot be shown to be the client's site, so it is not.
    expect(isOnTargetHost('not a url', 'acme.com')).toBe(false);
  });
});

describe('assertSettledOnTarget', () => {
  it('allows a journey that came back to the site it was auditing', () => {
    expect(() =>
      assertSettledOnTarget('https://app.acme.com/dashboard', 'acme.com'),
    ).not.toThrow();
  });

  it('refuses one that came to rest on the provider', () => {
    // Passing through an IdP is normal; ending on one means the journey never
    // got in, and what it walked was somebody else's login page — which scores
    // well, because a login page is small and tidy.
    expect(() => assertSettledOnTarget('https://acme.okta.com/login', 'acme.com')).toThrow(
      UnsafeTargetError,
    );
  });

  it('names where it ended without carrying the authorization code', () => {
    // The single most likely place for a journey to get stuck is an SSO
    // callback, and its query string is the credential. This message becomes
    // `failureReason`, which is stored and logged verbatim.
    let message = '';
    try {
      assertSettledOnTarget('https://acme.okta.com/callback?code=SECRET-CODE', 'acme.com');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('/callback');
    expect(message).not.toContain('SECRET-CODE');
  });
});
