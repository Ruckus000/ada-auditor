import { describe, expect, it } from 'vitest';
import {
  assertAllowedUrl,
  assertSafeTargetUrl,
  isBlockedAddress,
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
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
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
