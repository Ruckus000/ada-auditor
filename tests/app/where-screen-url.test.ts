import { describe, expect, it } from 'vitest';

const { normalizeUrl } = await import('../../src/app/platform/components/setup/where-screen');

/**
 * `normalizeUrl` is what stands between whatever an operator pastes and the
 * `targetUrl` this wizard stores. Pinned directly, without going through the
 * DOM, because every one of these is a real thing somebody has pasted, and a
 * schema drift here is a 400 the operator sees and a bug report this suite
 * would have caught first.
 */
describe('normalizeUrl', () => {
  it('adds a scheme to a bare host', () => {
    const url = normalizeUrl('rosewooddental.com');
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe('https://rosewooddental.com/');
  });

  it('accepts an existing scheme case-insensitively, without doubling it', () => {
    const url = normalizeUrl('HTTPS://rosewooddental.com');
    expect((url as URL).protocol).toBe('https:');
    expect((url as URL).href).toBe('https://rosewooddental.com/');
  });

  it('trims surrounding whitespace', () => {
    const url = normalizeUrl('  rosewooddental.com  ');
    expect((url as URL).href).toBe('https://rosewooddental.com/');
  });

  it('preserves a path and query string', () => {
    const url = normalizeUrl('rosewooddental.com/shop?x=1') as URL;
    expect(url.pathname).toBe('/shop');
    expect(url.search).toBe('?x=1');
  });

  it('strips a fragment, so the stored form is canonical', () => {
    const url = normalizeUrl('rosewooddental.com/shop#reviews') as URL;
    expect(url.hash).toBe('');
    expect(url.href).toBe('https://rosewooddental.com/shop');
  });

  it('converts an internationalised domain to punycode', () => {
    const url = normalizeUrl('müller.example') as URL;
    expect(url.hostname).toBe('xn--mller-kva.example');
  });

  it('rejects a javascript: URL', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects an ftp: URL', () => {
    expect(normalizeUrl('ftp://rosewooddental.com')).toBeNull();
  });

  it('rejects a URL carrying a userinfo credential', () => {
    expect(normalizeUrl('https://user:hunter2@rosewooddental.com')).toBe('credentials');
  });

  it('rejects a schemeless host carrying a userinfo credential', () => {
    expect(normalizeUrl('user:hunter2@rosewooddental.com')).toBe('credentials');
  });
});
