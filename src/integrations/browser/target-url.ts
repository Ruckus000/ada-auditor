import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guards the one genuinely dangerous thing this service does: fetch a URL the
 * caller chose, from inside our own network, with a real browser.
 *
 * That is server-side request forgery by construction. A host allowlist alone
 * does not contain it — `internal.acme.com` can resolve to 127.0.0.1, and
 * `169.254.169.254` is the cloud metadata endpoint that hands out credentials.
 * So a target is checked four ways:
 *
 *   1. Scheme and host, before anything touches the network.
 *   2. Every address the host resolves to, so a name pointing at private
 *      space is rejected however friendly it looks.
 *   3. The final URL after navigation, because a redirect can land somewhere
 *      the first two checks never saw.
 *   4. The address the browser actually connected to, which is the only one of
 *      the four that closes DNS rebinding.
 *
 * (4) exists because (3) was documented as closing rebinding and did not. The
 * browser resolves independently of us, so a hostile server can answer our
 * `lookup()` with a public address and Chromium's with 127.0.0.1 — and after
 * that the settled URL still carries the caller's hostname, which is on the
 * allowlist because the allowlist is derived from it, and is not a literal IP.
 * Nothing in (1)–(3) looks at anything the rebind changed. Verified: with (4)
 * removed, a journey pointed at a rebinding host archived the internal page as
 * evidence. See `assertPeerAddressAllowed`.
 *
 * Every address check is numeric rather than textual, because one address has
 * many spellings — see `isBlockedIpv6`, where matching text let
 * `[::ffff:169.254.169.254]` through.
 *
 * What this does NOT cover, so nobody reads more into it than is there:
 * subresource requests, and navigations in a popup the audited page opened
 * with `window.open`. Both can reach an internal address; neither returns
 * anything to the caller or is captured as evidence, so they are blind. The
 * containing fix for both is request-level interception, which is not here.
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

/**
 * An IPv6 address as its eight 16-bit groups, or null if it cannot be read.
 *
 * Every check below is numeric because matching the *text* of an address does
 * not work: one address has many spellings, and the one a check is written
 * against is rarely the one that arrives. `::ffff:127.0.0.1`,
 * `::ffff:7f00:1` and `0:0:0:0:0:ffff:7f00:0001` are the same host, and
 * `new URL()` re-spells whichever was typed into the compressed hex form. See
 * the note on `isBlockedIpv6`.
 */
function expandIpv6(address: string): number[] | null {
  let text = address;

  // A trailing dotted quad — `::ffff:127.0.0.1` — is two more groups.
  const dotted = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const octets = dotted[1].split('.').map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return null;
    }
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, dotted.index)}:${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const groupsOf = (part: string): number[] | null => {
    if (part === '') return [];
    const parsed: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      parsed.push(parseInt(group, 16));
    }
    return parsed;
  };

  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (!head || !tail) return null;

  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }

  const elided = 8 - head.length - tail.length;
  return elided < 0 ? null : [...head, ...Array<number>(elided).fill(0), ...tail];
}

/**
 * Several IPv6 ranges embed an IPv4 address and route to it, so each one is a
 * way of writing `127.0.0.1` that does not look like `127.0.0.1`.
 *
 * This used to unwrap only `::ffff:` followed by a dotted quad, matched as
 * text. `new URL()` never produces that spelling — it emits compressed hex —
 * so the branch was dead for every address that had been through a URL, and
 * `http://[::ffff:169.254.169.254]/` was reported safe. Because the host was a
 * literal IP, `assertSafeTargetUrl` skipped the DNS check too, and Chromium
 * fetched the metadata endpoint. The test that was supposed to cover this
 * called the predicate with a hand-written dotted string, so it passed.
 */
function isBlockedIpv6(address: string): boolean {
  const groups = expandIpv6(address.toLowerCase().split('%')[0]);

  // Unparseable is not the same as safe.
  if (!groups) return true;

  const zeros = (count: number): boolean => groups.slice(0, count).every((g) => g === 0);
  const embedded = (high: number, low: number): string =>
    `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;

  // ::ffff:0:0/96 IPv4-mapped.
  if (zeros(5) && groups[5] === 0xffff) return isBlockedIpv4(embedded(groups[6], groups[7]));

  // ::/96 IPv4-compatible, deprecated but still routed. This also answers `::`
  // and `::1`, which unwrap to 0.0.0.0 and 0.0.0.1 — both already blocked as
  // IPv4, so they need no case of their own.
  if (zeros(6)) return isBlockedIpv4(embedded(groups[6], groups[7]));

  // 64:ff9b::/96 NAT64.
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return isBlockedIpv4(embedded(groups[6], groups[7]));
  }

  // 2002::/16 6to4 carries its IPv4 in the next two groups instead.
  if (groups[0] === 0x2002) return isBlockedIpv4(embedded(groups[1], groups[2]));

  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast

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

/**
 * Judges a navigation by the address the browser reached, not the name it
 * asked for.
 *
 * This is the only check that can close DNS rebinding, and for a long time
 * nothing did it. The pre-navigation check resolves the hostname with Node's
 * resolver; the browser then resolves it again, independently, and a hostile
 * server is free to answer differently the second time. Re-reading the settled
 * URL afterwards cannot notice — the hostname is unchanged, it is on the
 * allowlist by construction, and it is not a literal IP, so nothing about it
 * gets range-checked. Only the peer address knows where the bytes came from.
 *
 * `undefined` means the browser served the document without dialling — from
 * its cache, or from memory after a same-document navigation. Nothing was
 * fetched, so there is no peer to object to.
 */
export function assertPeerAddressAllowed(pageUrl: string, ipAddress?: string): void {
  if (ipAddress === undefined) {
    return;
  }

  // Chromium reports an IPv6 peer bracketed — `[::1]`, not `::1`. Unbracketed,
  // `isIP` returns 0 and `isBlockedAddress` refuses everything, so the IPv6
  // half of this check would fail closed on every address and the range logic
  // written for it would never run. Same normalisation `assertAllowedUrl` does
  // for hostnames.
  const address = ipAddress.replace(/^\[|\]$/g, '');

  if (isBlockedAddress(address)) {
    throw new UnsafeTargetError(
      `Navigation to ${pageUrl} connected to ${address}, a private or reserved address.`,
    );
  }
}
