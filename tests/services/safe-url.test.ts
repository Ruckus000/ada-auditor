import { describe, expect, it } from 'vitest';
import { hostnameOf, settledLocation, withUrlsReduced } from '../../src/services/safe-url';

describe('withUrlsReduced', () => {
  /**
   * The leak this exists for, in the shape it actually shipped.
   *
   * `attemptStep` builds its sentence from `error.message.split('\n')[0]` and
   * interpolates it raw. Its twin, the `expect` failure, had run its URL
   * through `settledLocation` for exactly this reason — but a click wraps its
   * navigation settle, so a failed navigation puts a Chromium `net::ERR_*`
   * line, destination URL and all, into the click's message instead. That
   * sentence matches `classifyRunFailure`'s anchor, so it is echoed to the
   * operator as `detail` by the preview route and written verbatim into the
   * structured log by `audit-run-handler`.
   */
  it('reduces a URL carried inside an error sentence', () => {
    expect(
      withUrlsReduced(
        'net::ERR_ABORTED at https://client.example/callback?code=SSO-SECRET&state=xyz',
      ),
    ).toBe('net::ERR_ABORTED at https://client.example/callback');
  });

  it('keeps the diagnostic prose around the URL', () => {
    // The message is the whole point — an operator fixing a stale selector
    // needs Playwright's sentence, just not the query string in it.
    expect(withUrlsReduced('locator.click: Timeout 10000ms exceeded')).toBe(
      'locator.click: Timeout 10000ms exceeded',
    );
  });

  it('leaves sentence punctuation outside the URL', () => {
    // The runner's template ends with a full stop, so a URL at the end of the
    // interpolated part is followed by one. Swallowing it into the URL would
    // make `new URL` parse the trailing dot as part of the path.
    expect(withUrlsReduced('gave up at https://client.example/cb?code=SECRET.')).toBe(
      'gave up at https://client.example/cb.',
    );
  });

  it('reduces every URL in a sentence, not just the first', () => {
    expect(
      withUrlsReduced(
        'redirected from https://a.example/x?token=A to https://b.example/y?token=B',
      ),
    ).toBe('redirected from https://a.example/x to https://b.example/y');
  });

  it('reduces a file URL, which is what a fixture run navigates to', () => {
    expect(withUrlsReduced('failed loading file:///tmp/fixtures/login.html?k=v')).toBe(
      'failed loading file:///tmp/fixtures/login.html',
    );
  });

  it('leaves a message with no URL in it untouched', () => {
    expect(withUrlsReduced('it raised TimeoutError')).toBe('it raised TimeoutError');
  });

  it('does not treat a bare word containing a scheme-like prefix as a URL', () => {
    expect(withUrlsReduced('strict mode violation: getByRole("link")')).toBe(
      'strict mode violation: getByRole("link")',
    );
  });
});

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

describe('hostnameOf', () => {
  it('gives the host and nothing else', () => {
    // The runner logs a line each time a journey passes through a host it is
    // not auditing, and in an SSO flow that host's URLs are the ones carrying
    // the authorization code — in the query going out and, for some
    // providers, in the path coming back. The line exists to name the host.
    expect(hostnameOf('https://acme.okta.com/callback?code=SECRET-CODE')).toBe('acme.okta.com');
  });

  it('refuses to echo something it could not parse', () => {
    expect(hostnameOf('not a url ?code=SECRET')).toBe('(unparseable URL)');
  });
});
