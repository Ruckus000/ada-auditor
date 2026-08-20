import { describe, expect, it } from 'vitest';
import {
  discoveryKey,
  discoveryRequestSchema,
  journeyOriginFor,
  MAX_DISCOVERY_URLS,
  normalizePathname,
  stepPathFor,
} from '../../src/domain/discovery';

describe('normalizePathname', () => {
  it('collapses directory, index.html and bare forms to one path', () => {
    for (const pathname of ['/help', '/help/', '/help/index.html', '/help/index.htm']) {
      expect(normalizePathname(pathname)).toBe('/help');
    }
  });

  it('reduces the site root to /', () => {
    expect(normalizePathname('/')).toBe('/');
    expect(normalizePathname('')).toBe('/');
    expect(normalizePathname('/index.html')).toBe('/');
  });

  it('keeps nested paths intact', () => {
    expect(normalizePathname('/a/b/c/')).toBe('/a/b/c');
  });

  it('collapses index.html regardless of case', () => {
    expect(normalizePathname('/help/INDEX.HTML')).toBe('/help');
  });
});

describe('discoveryKey', () => {
  it('treats the four spellings of one page as one key', () => {
    const keys = new Set(
      [
        'https://acme.test/help',
        'https://acme.test/help/',
        'https://acme.test/help/index.html',
        'https://acme.test/help#top',
      ].map(discoveryKey),
    );

    expect(keys.size).toBe(1);
  });

  it('keeps the query string, because it selects a different page', () => {
    expect(discoveryKey('https://acme.test/search?q=a')).not.toBe(
      discoveryKey('https://acme.test/search?q=b'),
    );
  });

  it('separates hosts and schemes', () => {
    expect(discoveryKey('https://acme.test/a')).not.toBe(discoveryKey('https://other.test/a'));
    expect(discoveryKey('https://acme.test/a')).not.toBe(discoveryKey('http://acme.test/a'));
  });

  it('composes the directory and query-string rules together', () => {
    expect(discoveryKey('https://acme.test/help/?q=1')).toBe(
      discoveryKey('https://acme.test/help?q=1'),
    );
  });

  it('throws on a URL with no origin, rather than minting a garbage key', () => {
    expect(() => discoveryKey('/relative')).toThrow(TypeError);
    expect(() => discoveryKey('')).toThrow(TypeError);
    expect(() => discoveryKey('not a url')).toThrow(TypeError);
    expect(() => discoveryKey('#frag')).toThrow(TypeError);
  });

  it('collides opaque-origin schemes, because callers must filter to http/https first', () => {
    expect(discoveryKey('mailto:x')).toBe(discoveryKey('data:x'));
  });
});

describe('discoveryRequestSchema', () => {
  it('accepts an http(s) target', () => {
    expect(discoveryRequestSchema.safeParse({ targetUrl: 'https://acme.test' }).success).toBe(true);
  });

  it('refuses a non-URL and a non-http scheme', () => {
    expect(discoveryRequestSchema.safeParse({ targetUrl: 'not-a-url' }).success).toBe(false);
    for (const targetUrl of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://acme.test',
      // Not a scheme-list case: pins the `^...$` anchoring itself. None of
      // the schemes above contain "http", so a regex relaxed to /https?/
      // would leave them refused and this suite green while accepting
      // `xhttps://` and `httpsx://` targets.
      'xhttps://acme.test',
    ]) {
      expect(discoveryRequestSchema.safeParse({ targetUrl }).success).toBe(false);
    }
  });

  it('refuses unknown keys, so a caller cannot smuggle a cap past the schema', () => {
    expect(
      discoveryRequestSchema.safeParse({ targetUrl: 'https://acme.test', maxUrls: 100_000 }).success,
    ).toBe(false);
  });

  it('refuses a target URL past the 2048-character bound the journeys route also enforces', () => {
    const targetUrl = `https://acme.test/${'a'.repeat(5000)}`;
    expect(discoveryRequestSchema.safeParse({ targetUrl }).success).toBe(false);
  });

  it('parses to the trimmed value, so callers must use the parsed result, not the raw body', () => {
    expect(discoveryRequestSchema.parse({ targetUrl: '  https://acme.test  ' }).targetUrl).toBe(
      'https://acme.test',
    );
  });

  // MAX_DISCOVERY_URLS is intentionally set well above the run's page cap
  // (20 by default, `AUDITOR_MAX_PAGES_PER_RUN` in
  // `src/services/deployment-config.ts`) so an operator can select any
  // in-cap subset from what discovery proposes. Nothing enforces that
  // relationship at runtime, and no shared named constant exists to import
  // here, so this only pins discovery's own cap, not the pair.
  it('caps discovery well above the default run page cap', () => {
    expect(MAX_DISCOVERY_URLS).toBeGreaterThan(20);
  });
});

/**
 * The rule that stops a crawl's wider reach becoming a journey's wrong URL.
 *
 * A crawl of `acme.com` legitimately returns pages on `docs.acme.com`:
 * `hostAllowed` matches subdomains, and it must, or the apex-to-www redirect
 * ends every crawl at depth 0. A journey cannot express that — one
 * `targetUrl`, a list of paths — so a step built from the path alone audits a
 * different page and the route answers 201, because nothing about the body is
 * wrong. The host was discarded before it was written.
 */
describe('stepPathFor', () => {
  it('takes the path and query of a page on the target host', () => {
    expect(stepPathFor('https://acme.com/pricing?plan=team', 'https://acme.com')).toBe(
      '/pricing?plan=team',
    );
  });

  it('refuses a page on a subdomain of the target', () => {
    // The whole point. `docs.acme.com/guide` and `acme.com/guide` are
    // different pages, and taking `/guide` here is what makes the second one
    // silently stand in for the first.
    expect(stepPathFor('https://docs.acme.com/guide', 'https://acme.com')).toBeNull();
  });

  it('refuses a page on the parent of the target', () => {
    // The other direction, which the subdomain rule does not cover on its own:
    // crawl `www.acme.com`, follow a link to `acme.com`, and the entry point
    // check never sees it because it is not the entry point.
    expect(stepPathFor('https://acme.com/pricing', 'https://www.acme.com')).toBeNull();
  });

  it('keeps a page whose scheme differs from the target', () => {
    // An operator who types `http://` gets `https://` pages back from a site
    // that redirects, which is most of them. The step still resolves against
    // the `http://` target and the site performs the same redirect at run
    // time, so this is the case where comparing origins would refuse
    // essentially every real crawl.
    expect(stepPathFor('https://acme.com/pricing', 'http://acme.com')).toBe('/pricing');
  });

  it('ignores case in the hostname', () => {
    // `URL.hostname` lowercases what it parses, so this passes with the
    // `toLowerCase` calls deleted. It is here for the target, which is built
    // from an operator's typed string and travels through this function
    // unparsed by anything else.
    expect(stepPathFor('https://ACME.com/pricing', 'https://acme.COM')).toBe('/pricing');
  });

  it('answers null rather than throwing for an address it cannot read', () => {
    expect(stepPathFor('not a url', 'https://acme.com')).toBeNull();
    expect(stepPathFor('https://acme.com/', 'not a url')).toBeNull();
  });
});

/**
 * The origin a journey authored from a crawl should target: where the entry
 * point settled, never merely what the operator typed.
 *
 * The apex-to-www redirect is the commonest on the web, and the crawl follows
 * it by design — so every discovered page lives on `www.acme.com` while the
 * typed address says `acme.com`. A journey built against the typed origin can
 * then use none of them: `stepPathFor` rightly refuses every cross-host page,
 * and the panel renders a full list of pages with every checkbox dead.
 */
describe('journeyOriginFor', () => {
  it('returns the settled entry origin when the site canonicalised the typed address', () => {
    const pages = [
      { url: 'https://www.acme.com/', title: 'Home', depth: 0 },
      { url: 'https://www.acme.com/pricing', title: 'Pricing', depth: 1 },
    ];
    expect(journeyOriginFor(pages, 'https://acme.com')).toBe('https://www.acme.com');
  });

  it('returns the typed origin when the entry settled where it was asked to', () => {
    const pages = [{ url: 'https://acme.com/', title: 'Home', depth: 0 }];
    expect(journeyOriginFor(pages, 'https://acme.com')).toBe('https://acme.com');
  });

  it('falls back to the typed origin when the crawl found nothing', () => {
    expect(journeyOriginFor([], 'https://acme.com/docs/start?x=1')).toBe('https://acme.com');
  });

  it('reads the entry by depth, not by position', () => {
    // A crawl always reports the entry first today, but this function decides
    // a journey's target URL and must not lean on an ordering nothing pins.
    const pages = [
      { url: 'https://www.acme.com/pricing', title: 'Pricing', depth: 1 },
      { url: 'https://www.acme.com/', title: 'Home', depth: 0 },
    ];
    expect(journeyOriginFor(pages, 'https://acme.com')).toBe('https://www.acme.com');
  });

  it('reduces a typed address with a path and query to its origin', () => {
    const pages = [{ url: 'https://www.acme.com/docs/', title: 'Docs', depth: 0 }];
    expect(journeyOriginFor(pages, 'https://acme.com/docs/?utm=x')).toBe('https://www.acme.com');
  });
});
