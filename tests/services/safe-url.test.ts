import { describe, expect, it } from 'vitest';
import { settledLocation } from '../../src/services/safe-url';

describe('settledLocation', () => {
  /**
   * The case it exists for. This is the first runner message to interpolate a
   * *site-controlled* URL, and it reaches the structured log verbatim.
   */
  it('drops a query string, which is where a session token lives', () => {
    expect(settledLocation('https://app.example.com/callback?code=SUPER-SECRET')).toBe(
      'https://app.example.com/callback',
    );
  });

  it('drops a fragment too', () => {
    // An implicit-flow token arrives in the fragment, not the query.
    expect(settledLocation('https://app.example.com/x#access_token=SECRET')).toBe(
      'https://app.example.com/x',
    );
  });

  it('keeps the part an operator actually needs', () => {
    // "it was at /login, not /dashboard" is the whole diagnostic.
    expect(settledLocation('https://app.example.com/login')).toBe(
      'https://app.example.com/login',
    );
  });

  it('keeps a non-default port, which distinguishes two environments', () => {
    expect(settledLocation('http://localhost:3001/admin?t=1')).toBe(
      'http://localhost:3001/admin',
    );
  });

  it('handles a file URL, which is what a fixture run settles on', () => {
    expect(settledLocation('file:///tmp/fixtures/login.html')).toBe(
      'file:///tmp/fixtures/login.html',
    );
  });

  it('refuses to echo something it could not parse', () => {
    // Never the raw input: an unparseable URL is the case where guessing which
    // part is safe to print is least defensible.
    expect(settledLocation('not a url at all ?code=SECRET')).toBe('(unparseable URL)');
  });
});
