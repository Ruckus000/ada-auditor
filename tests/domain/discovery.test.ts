import { describe, expect, it } from 'vitest';
import {
  discoveryKey,
  discoveryRequestSchema,
  MAX_DISCOVERY_URLS,
  normalizePathname,
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
