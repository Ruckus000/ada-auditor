import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce } from '../../src/app/api/_lib/csp';

/**
 * The policy is asserted here rather than through a request because that is the
 * whole reason `buildCsp` is a pure function: `proxy.ts` imports `next/server`,
 * and a policy only reachable through it would be covered by nothing in the
 * fast suite.
 */

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split('; ').map((part) => {
      const space = part.indexOf(' ');
      return space < 0 ? [part, ''] : [part.slice(0, space), part.slice(space + 1)];
    }),
  );
}

describe('buildCsp', () => {
  it('carries the nonce it was given, in script-src', () => {
    const csp = buildCsp('abc123', false);
    expect(directives(csp).get('script-src')).toContain("'nonce-abc123'");
  });

  // The three that decide whether an injected script can run at all.
  it('never allows inline or eval in script-src in production', () => {
    const scriptSrc = directives(buildCsp('abc123', false)).get('script-src')!;

    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  // React needs `eval` in dev to rebuild server error stacks. It must not
  // follow the build into production, which is the whole point of the flag.
  it('allows eval in development only', () => {
    expect(buildCsp('abc123', true)).toContain("'unsafe-eval'");
    expect(buildCsp('abc123', false)).not.toContain("'unsafe-eval'");
  });

  /**
   * Not an oversight, and pinned so nobody "fixes" it into the documented
   * `style-src 'self' 'nonce-…'`. The screens carry 394 inline `style={{…}}`
   * props; `style-src-attr` falls back to `style-src`, and no nonce can attach
   * to a `style=""` attribute, so the stricter policy blanks the product.
   */
  it('deliberately allows inline styles, which the screens depend on', () => {
    expect(directives(buildCsp('abc123', false)).get('style-src')).toContain(
      "'unsafe-inline'",
    );
  });

  it('denies framing, plugins and base-tag rewriting', () => {
    const found = directives(buildCsp('abc123', false));

    expect(found.get('frame-ancestors')).toBe("'none'");
    expect(found.get('object-src')).toBe("'none'");
    expect(found.get('base-uri')).toBe("'self'");
    expect(found.get('form-action')).toBe("'self'");
  });

  it('has a default-src, so an unlisted directive fails closed', () => {
    expect(directives(buildCsp('abc123', false)).get('default-src')).toBe("'self'");
  });

  // The verify-button renders a screenshot from bytes already in memory.
  it('allows the data: images the journey verifier renders', () => {
    expect(directives(buildCsp('abc123', false)).get('img-src')).toContain('data:');
  });

  // Dev-only, because the HMR socket is dev-only and browsers disagree about
  // whether `'self'` covers `ws:`.
  it('opens the HMR socket in development only', () => {
    expect(directives(buildCsp('n', true)).get('connect-src')).toContain('ws:');
    expect(directives(buildCsp('n', false)).get('connect-src')).toBe("'self'");
  });
});

describe('createNonce', () => {
  // A predictable nonce is `'unsafe-inline'` spelled at greater length.
  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 100 }, () => createNonce()));
    expect(seen.size).toBe(100);
  });

  it('is 128 bits of base64', () => {
    expect(atob(createNonce())).toHaveLength(16);
  });
});
