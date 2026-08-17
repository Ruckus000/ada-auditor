import { z } from 'zod';

/**
 * The extra hosts one journey may pass through, and what an operator is
 * allowed to write in that box.
 *
 * A run's allowlist has always been the target's own host, which means an app
 * that hands off to Okta, Entra or Auth0 fails on its first step — on the
 * redirect the app itself performs. This is the list that makes that journey
 * possible, and every rule below exists because the list is matched against
 * *host or any subdomain of it*: `hostAllowed` treats `okta.com` as covering
 * every tenant under it, which is the behaviour an SSO entry needs and also
 * the reason a careless entry is expensive.
 *
 * **What this validation is and is not for.** It is not a defence against a
 * hostile operator: whoever can write this can also write `targetUrl`, so an
 * operator who wants the browser pointed at another site does not need this
 * field. It is a defence against a slip — `co.uk` where `acme.co.uk` was
 * meant — and against the *audited site* using an over-broad list to bounce
 * the browser around. What actually contains the damage is elsewhere and
 * unchanged: every hop's peer address is range-checked, a host the journey
 * only passes through is never audited, and the run must come to rest on the
 * target's own host.
 */

/**
 * One label, and the whole hostname, in the ASCII form a browser reports.
 *
 * A label is 1–63 characters of letters, digits and hyphens, not starting or
 * ending with a hyphen. Two labels minimum — see `PUBLIC_SUFFIXES` for why one
 * is never acceptable.
 *
 * ASCII only, deliberately. `hostAllowed` compares against `URL.hostname`,
 * which is always punycode, so an entry typed in native script would parse
 * happily here and then silently never match anything — an allowlist entry
 * that does nothing is worse than one that is refused. An internationalised
 * domain goes in as its `xn--` form, which is also what the browser's address
 * bar will show it as.
 */
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

/**
 * Suffixes nobody may allowlist whole, because doing so allowlists the
 * internet.
 *
 * An entry matches itself and everything below it, so `co.uk` is every British
 * company and `com` is most of the web. Single-label suffixes need no list —
 * the two-label minimum in `HOSTNAME` refuses every bare TLD, and `localhost`
 * with it.
 *
 * **This is not the Public Suffix List and does not pretend to be.** The real
 * PSL is ten thousand lines that change monthly, and bundling it would be a
 * dependency and a staleness problem in exchange for catching typos. This
 * catches the ones an operator plausibly makes; a determined mis-entry of some
 * obscure registry suffix gets through, and what stops that mattering is that
 * a pass-through host is never audited and the run must still end on the
 * target.
 */
const PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'me.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.za',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'com.mx',
  'com.ar',
  'co.in',
  'com.sg',
  'com.hk',
  'com.tr',
  'com.cn',
  'com.tw',
]);

/**
 * The most hosts one journey may name.
 *
 * An SSO flow passes through one provider, occasionally two — the tenant host
 * and the provider's shared login host. Ten is generous for that and small
 * enough that the list stays something a person reads rather than scrolls.
 */
export const MAX_ALLOWED_HOSTS = 10;

/**
 * Lowercased, with the root dot removed, which is what the matcher does too.
 *
 * `ACME.OKTA.COM.` and `acme.okta.com` are the same host, and an entry that
 * differs only in those would be refused by the regex below for no reason a
 * reader would accept.
 */
function normalise(entry: string): string {
  return entry.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Why this entry cannot be used, or null when it can.
 *
 * A sentence rather than a boolean: every one of these is something an
 * operator typed, and "invalid host" for `*.okta.com` sends them to guess.
 */
export function describeHostProblem(raw: string): string | null {
  const host = normalise(raw);

  if (host === '') return 'A host cannot be blank.';

  // Named before the regex refuses it as a stray character, because it is the
  // single most likely thing to be typed here — every other allowlist an
  // operator has met takes one.
  if (host.startsWith('*.') || host.includes('*')) {
    return 'No wildcards. An entry already covers every subdomain of itself, so write the host on its own.';
  }

  // Also before the regex: a URL is the other obvious guess, and "does not
  // look like a hostname" is a poor answer to someone who pasted one.
  if (/[:/?#@]/.test(host)) {
    return 'Just the host — no scheme, port, path or credentials.';
  }

  if (host.length > 253) return 'That host is longer than a hostname may be.';

  if (!HOSTNAME.test(host)) {
    return /[^\x20-\x7e]/.test(host)
      ? 'Use the punycode (xn--) form of an internationalised domain — that is the form a browser reports and the form this is matched against.'
      : 'That is not a hostname. Letters, digits and hyphens, in labels separated by dots.';
  }

  // An address, not a name. A dotted quad passes the label rules — `1`, `2`,
  // `3` and `4` are all valid labels — and no real TLD is all digits, which is
  // the same rule that keeps `1.2.3.4` out of the DNS root.
  const labels = host.split('.');
  if (/^\d+$/.test(labels[labels.length - 1])) {
    return 'Name a host, not an address. An address is checked by range on every hop and cannot be allowlisted here.';
  }

  if (PUBLIC_SUFFIXES.has(host)) {
    return `“${host}” is a public suffix, so allowing it would allow every domain under it. Name the provider's own host.`;
  }

  return null;
}

/**
 * The list as a route must accept it.
 *
 * Normalised on the way through, so what is stored is what the matcher will
 * compare — a stored `ACME.Okta.com` that only matches because the comparison
 * lowercases both sides is a coincidence waiting to be refactored away.
 *
 * Duplicates are dropped rather than refused. Two spellings of one host is not
 * an error worth stopping a save for, and a list with the same entry twice is
 * a list that reads as though it means something.
 */
export const allowedHostsSchema = z
  // Bounded before anything reads it. A hostname may be 253 characters, so
  // 1024 leaves room for `describeHostProblem` to give the useful answer
  // ("longer than a hostname may be") rather than zod's, while still refusing
  // a megabyte of string before it is trimmed, lowercased and matched.
  .array(z.string().max(1024))
  .max(MAX_ALLOWED_HOSTS)
  .transform((entries) => [...new Set(entries.map(normalise))])
  .superRefine((hosts, ctx) => {
    for (const host of hosts) {
      const problem = describeHostProblem(host);
      if (problem) {
        ctx.addIssue({ code: 'custom', message: problem });
      }
    }
  });
