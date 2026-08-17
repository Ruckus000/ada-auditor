import { describe, expect, it } from 'vitest';
import { discoveryKey, normalizePathname } from '../../src/domain/discovery';

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
