import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guards the one genuinely dangerous thing this service does: fetch a URL the
 * caller chose, from inside our own network, with a real browser.
 *
 * That is server-side request forgery by construction. A host allowlist alone
 * does not contain it — `internal.acme.com` can resolve to 127.0.0.1, and
 * `169.254.169.254` is the cloud metadata endpoint that hands out credentials.
 * So a target is checked three ways:
 *
 *   1. Scheme and host, before anything touches the network.
 *   2. Every address the host resolves to, so a name pointing at private
 *      space is rejected however friendly it looks.
 *   3. The final URL after navigation, because a redirect can land somewhere
 *      the first two checks never saw.
 *
 * Checking resolved addresses does not fully close DNS rebinding — the browser
 * resolves independently and a hostile server can answer differently the
 * second time. Check (3) is what catches that, which is why it is not
 * optional.
 */

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

/** Bare `[a, b]` pairs are `[network, prefixLength]` in dotted-quad form. */
const BLOCKED_IPV4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918 private
  ['100.64.0.0', 10], // RFC6598 carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — includes the 169.254.169.254 metadata endpoint
  ['172.16.0.0', 12], // RFC1918 private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918 private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes broadcast
];

function ipv4ToInt(address: string): number {
  return address
    .split('.')
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);

  return BLOCKED_IPV4.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (ipv4ToInt(network) & mask);
  });
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];

  // An IPv4-mapped address (::ffff:127.0.0.1) is the classic bypass: it reads
  // as IPv6 but routes to the embedded IPv4 address, so unwrap and re-check.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) {
    return isBlockedIpv4(mapped[1]);
  }

  if (normalized === '::' || normalized === '::1') {
    return true; // unspecified, loopback
  }

  const head = normalized.split(':')[0];
  const leading = parseInt(head || '0', 16);

  // fc00::/7 unique-local, fe80::/10 link-local.
  if ((leading & 0xfe00) === 0xfc00) return true;
  if ((leading & 0xffc0) === 0xfe80) return true;

  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true; // not an address we can reason about — refuse it
}

/** Host matches the allowlist entry itself or any subdomain of it. */
function hostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');

  return allowedHosts.some((entry) => {
    const allowed = entry.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

export function parseTargetUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeTargetError('Target URL is not a valid URL.');
  }

  // `file:` would turn an audit into a local file read; everything else
  // (data:, javascript:, ftp:, gopher:) has no business being audited.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeTargetError('Target URL must use http or https.');
  }

  if (url.username || url.password) {
    throw new UnsafeTargetError('Target URL must not embed credentials.');
  }

  return url;
}

/**
 * Synchronous checks only — scheme, credentials, allowlist, and literal IP
 * hosts. Used both up front and on every navigation, where a DNS round trip
 * per request would be too costly.
 */
export function assertAllowedUrl(rawUrl: string, allowedHosts: string[]): URL {
  const url = parseTargetUrl(rawUrl);

  if (allowedHosts.length === 0) {
    throw new UnsafeTargetError('No allowed hosts are configured for this run.');
  }

  if (!hostAllowed(url.hostname, allowedHosts)) {
    throw new UnsafeTargetError(`Host ${url.hostname} is not in the allowed domains for this run.`);
  }

  // A literal IP host skips DNS entirely, so range-check it here too.
  const bracketless = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(bracketless) && isBlockedAddress(bracketless)) {
    throw new UnsafeTargetError('Target URL resolves to a private or reserved address.');
  }

  return url;
}

/** Full check, including every address the hostname resolves to. */
export async function assertSafeTargetUrl(
  rawUrl: string,
  allowedHosts: string[],
): Promise<URL> {
  const url = assertAllowedUrl(rawUrl, allowedHosts);

  const bracketless = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(bracketless)) {
    return url; // already range-checked above
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new UnsafeTargetError(`Target host ${url.hostname} could not be resolved.`);
  }

  if (addresses.length === 0) {
    throw new UnsafeTargetError(`Target host ${url.hostname} could not be resolved.`);
  }

  // Every answer must be safe. One private address among several is enough for
  // a hostile or misconfigured host to reach internal infrastructure.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new UnsafeTargetError('Target URL resolves to a private or reserved address.');
    }
  }

  return url;
}
