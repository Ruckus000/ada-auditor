import { describe, expect, it } from 'vitest';
import { resolvePlatformMetadata } from '../../src/integrations/platforms';

/**
 * These cases moved here from `tests/services/run-audit-platforms.test.ts`,
 * which exercised adapter resolution indirectly through the deleted HTML audit
 * path. They cover the steady-state rule that an explicit `platformHint` beats
 * markup heuristics, so they test the resolver directly rather than through a
 * run.
 *
 * The `html` input is now the *rendered* DOM captured from a live page, which
 * is strictly better detection input than caller-pasted markup ever was.
 */
describe('resolvePlatformMetadata', () => {
  it('uses the React adapter when explicitly requested', () => {
    const platform = resolvePlatformMetadata({
      html: '<div><img src="hero.png"></div>',
      platformHint: 'react',
    });

    expect(platform.id).toBe('react');
    expect(platform.hints).toContain('spa-navigation');
  });

  it('detects React from rendered evidence when no hint is provided', () => {
    const platform = resolvePlatformMetadata({
      html: '<div id="__next"><img src="hero.png" alt="Hero"></div>',
    });

    expect(platform.id).toBe('react');
    expect(platform.hints).toContain('spa-navigation');
  });

  it('detects WordPress from rendered evidence when no hint is provided', () => {
    const platform = resolvePlatformMetadata({
      html: '<link href="/wp-content/themes/x/style.css">',
    });

    expect(platform.id).toBe('wordpress');
    expect(platform.hints).toContain('theme-plugin-boundary');
  });

  it('prefers an explicit WordPress hint over conflicting React markup', () => {
    const platform = resolvePlatformMetadata({
      html: '<div data-reactroot="true"></div>',
      platformHint: 'wordpress',
    });

    expect(platform.id).toBe('wordpress');
  });

  it('falls back to the generic adapter for unknown apps', () => {
    const platform = resolvePlatformMetadata({
      html: '<main><p>Hello</p></main>',
    });

    expect(platform.id).toBe('generic');
    expect(platform.hints).toContain('rendered-dom-baseline');
  });

  it('ignores an unsupported hint rather than failing the run', () => {
    const platform = resolvePlatformMetadata({
      html: '<main><p>Hello</p></main>',
      platformHint: 'drupal',
    });

    expect(platform.id).toBe('generic');
  });
});
