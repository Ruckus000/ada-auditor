import { describe, expect, it } from 'vitest';
import { allowedHostsSchema, describeHostProblem } from '../../src/domain/allowed-hosts';

/**
 * What an operator may put in a journey's allowed-host list.
 *
 * The list is matched as *host or any subdomain of it*, which is what an SSO
 * entry needs — every Okta tenant is a subdomain — and also what makes a
 * careless entry expensive. These are the entries that must never be stored,
 * and the ones that plainly must.
 */

describe('hosts a journey may pass through', () => {
  it('accepts the providers this exists for', () => {
    for (const host of [
      'acme.okta.com',
      'login.microsoftonline.com',
      'acme.auth0.com',
      'accounts.google.com',
      'xn--80ak6aa92e.com',
    ]) {
      expect(describeHostProblem(host), host).toBeNull();
    }
  });

  it('refuses a public suffix, which would allow everything under it', () => {
    // The slip this is for: `co.uk` where `acme.co.uk` was meant. An entry
    // covers its subdomains, so that one entry is every British company.
    expect(describeHostProblem('co.uk')).toMatch(/public suffix/);
    expect(describeHostProblem('com.au')).toMatch(/public suffix/);
  });

  it('refuses a bare TLD without needing a list to name it', () => {
    // Two labels minimum does this, which is also why `PUBLIC_SUFFIXES` only
    // has to carry the two-label ones.
    expect(describeHostProblem('com')).toMatch(/not a hostname/);
    expect(describeHostProblem('localhost')).toMatch(/not a hostname/);
  });

  it('refuses an address, however it is spelled', () => {
    // A dotted quad passes every label rule — `1`, `2`, `3` and `4` are valid
    // labels — so the numeric-TLD check is what stops it. An address belongs
    // to the range check on every hop, which cannot be opted out of.
    expect(describeHostProblem('169.254.169.254')).toMatch(/not an address/);
    expect(describeHostProblem('127.0.0.1')).toMatch(/not an address/);
    expect(describeHostProblem('[::1]')).not.toBeNull();
  });

  it('refuses a wildcard, and says why rather than calling it a bad character', () => {
    // Every other allowlist an operator has met takes one, so this is the
    // likeliest thing to be typed and the worst thing to answer vaguely.
    expect(describeHostProblem('*.okta.com')).toMatch(/No wildcards/);
  });

  it('refuses anything that is a URL rather than a host', () => {
    for (const entry of [
      'https://acme.okta.com',
      'acme.okta.com:8443',
      'acme.okta.com/login',
      'user@acme.okta.com',
    ]) {
      expect(describeHostProblem(entry), entry).toMatch(/Just the host/);
    }
  });

  it('tells an internationalised domain to use its punycode form', () => {
    // Not pedantry: `hostAllowed` compares against `URL.hostname`, which is
    // always punycode, so a native-script entry would store fine and then
    // match nothing at all. An entry that silently does nothing is worse than
    // one that is refused.
    expect(describeHostProblem('пример.com')).toMatch(/punycode/);
  });

  it('says nothing about the empty case except that it is empty', () => {
    expect(describeHostProblem('   ')).toMatch(/cannot be blank/);
  });
});

describe('the list a route accepts', () => {
  it('stores what the matcher will compare, not what was typed', () => {
    // A stored `ACME.Okta.com.` that matches only because the comparison
    // lowercases both sides is a coincidence, and the kind that survives until
    // somebody tidies the matcher.
    const parsed = allowedHostsSchema.parse(['ACME.Okta.com.', ' acme.okta.com ']);

    // Normalised, and deduplicated: those two are one host.
    expect(parsed).toEqual(['acme.okta.com']);
  });

  it('refuses the whole list when one entry is wrong', () => {
    const parsed = allowedHostsSchema.safeParse(['acme.okta.com', 'co.uk']);

    expect(parsed.success).toBe(false);
  });

  it('refuses a list longer than a journey could need', () => {
    const many = Array.from({ length: 11 }, (_, index) => `host${index}.okta.com`);

    expect(allowedHostsSchema.safeParse(many).success).toBe(false);
  });

  it('accepts an empty list, which is every journey that has no provider', () => {
    expect(allowedHostsSchema.parse([])).toEqual([]);
  });
});
