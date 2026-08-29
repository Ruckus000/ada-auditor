import { describe, expect, it } from 'vitest';
import {
  buildChallengeCookie,
  CHALLENGE_TTL_SECONDS,
  clearChallengeCookie,
  encodeChallengeCookie,
  readChallengeCookie,
} from '../../src/app/api/_lib/passkey-challenge';

/**
 * The pending half of a WebAuthn ceremony, which is a credential in its own
 * right for the two minutes it lives. Mirrors `console-session.test.ts`: the
 * signature, the expiry, and the shapes that must be refused.
 */

const SECRET = 'a-secret-at-least-sixteen-chars';
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

function request(url = 'https://audit.example.com/api/console/passkey/options'): Request {
  return new Request(url);
}

describe('the challenge cookie', () => {
  it('round-trips a sign-in challenge', () => {
    const value = encodeChallengeCookie(
      SECRET,
      { ceremony: 'authenticate', challenge: 'chal-1' },
      NOW,
    );

    const read = readChallengeCookie(value, SECRET, 'authenticate', NOW);
    expect(read?.ceremony).toBe('authenticate');
    expect(read?.challenge).toBe('chal-1');
    expect(read).not.toHaveProperty('operatorId');
  });

  it('round-trips a registration challenge with the operator it was issued to', () => {
    const value = encodeChallengeCookie(
      SECRET,
      { ceremony: 'register', challenge: 'chal-2', operatorId: 'op-sam' },
      NOW,
    );

    expect(readChallengeCookie(value, SECRET, 'register', NOW)?.operatorId).toBe('op-sam');
  });

  /**
   * The substitution this field exists to stop. Registration requires a
   * password; sign-in does not. If one challenge served both, the cheaper
   * ceremony could be used to finish the dearer one.
   */
  it('refuses a registration challenge presented to the sign-in verifier', () => {
    const value = encodeChallengeCookie(
      SECRET,
      { ceremony: 'register', challenge: 'chal-3', operatorId: 'op-sam' },
      NOW,
    );

    expect(readChallengeCookie(value, SECRET, 'authenticate', NOW)).toBeNull();
  });

  it('refuses a sign-in challenge presented to the registration verifier', () => {
    const value = encodeChallengeCookie(
      SECRET,
      { ceremony: 'authenticate', challenge: 'chal-4' },
      NOW,
    );

    expect(readChallengeCookie(value, SECRET, 'register', NOW)).toBeNull();
  });

  it('refuses a value signed with a different secret', () => {
    const value = encodeChallengeCookie(
      SECRET,
      { ceremony: 'authenticate', challenge: 'chal-5' },
      NOW,
    );

    expect(readChallengeCookie(value, 'another-secret-of-good-length', 'authenticate', NOW))
      .toBeNull();
  });

  it('refuses a tampered challenge even when the rest is intact', () => {
    const value = encodeChallengeCookie(
      SECRET,
      { ceremony: 'authenticate', challenge: 'chal-6' },
      NOW,
    );
    const parts = value.split('|');
    parts[1] = 'chal-substituted';

    expect(readChallengeCookie(parts.join('|'), SECRET, 'authenticate', NOW)).toBeNull();
  });

  it('refuses a tampered operator id', () => {
    const value = encodeChallengeCookie(
      SECRET,
      { ceremony: 'register', challenge: 'chal-7', operatorId: 'op-sam' },
      NOW,
    );
    const parts = value.split('|');
    parts[2] = 'op-someone-else';

    expect(readChallengeCookie(parts.join('|'), SECRET, 'register', NOW)).toBeNull();
  });

  it('expires', () => {
    const value = encodeChallengeCookie(
      SECRET,
      { ceremony: 'authenticate', challenge: 'chal-8' },
      NOW,
    );

    const justInside = NOW + (CHALLENGE_TTL_SECONDS - 1) * 1000;
    const justOutside = NOW + (CHALLENGE_TTL_SECONDS + 1) * 1000;

    expect(readChallengeCookie(value, SECRET, 'authenticate', justInside)).not.toBeNull();
    expect(readChallengeCookie(value, SECRET, 'authenticate', justOutside)).toBeNull();
  });

  it.each([
    ['absent', null],
    ['empty', ''],
    ['too few parts', 'authenticate|chal|op'],
    ['too many parts', 'authenticate|chal|op|123|sig|extra'],
    ['an unknown ceremony', 'elsewhere|chal|op|99999999999|sig'],
    ['an empty challenge', 'authenticate||op|99999999999|sig'],
    ['a non-numeric expiry', 'authenticate|chal|op|soon|sig'],
  ])('refuses %s', (unused, value) => {
    expect(readChallengeCookie(value, SECRET, 'authenticate', NOW)).toBeNull();
  });
});

describe('the cookie attributes', () => {
  it('is HttpOnly, SameSite=Strict, and Secure over https', () => {
    const cookie = buildChallengeCookie('value', request());

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain(`Max-Age=${CHALLENGE_TTL_SECONDS}`);
  });

  // So local development over plain http still works, matching the session
  // cookie's rule exactly.
  it('omits Secure for a genuinely plain-http origin', () => {
    expect(buildChallengeCookie('value', request('http://localhost:3000/x'))).not.toContain(
      'Secure',
    );
  });

  it('clears with a zero max-age', () => {
    expect(clearChallengeCookie(request())).toContain('Max-Age=0');
  });
});
