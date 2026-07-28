import { describe, expect, it } from 'vitest';
import { runAudit } from '../../src/services/run-audit';

describe('runAudit platform adapters', () => {
  it('uses the React adapter when explicitly requested', async () => {
    const report = await runAudit({
      journeyId: 'react-dashboard',
      environment: 'staging',
      html: '<div data-reactroot="true"><img src="hero.png"></div>',
      platformHint: 'react',
    });

    expect(report.platform.id).toBe('react');
    expect(report.platform.hints).toContain('spa-navigation');
  });

  it('detects React from rendered evidence when no hint is provided', async () => {
    const report = await runAudit({
      journeyId: 'react-dashboard',
      environment: 'staging',
      html: '<div id="__next"><img src="hero.png" alt="Hero"></div>',
    });

    expect(report.platform.id).toBe('react');
    expect(report.platform.hints).toContain('spa-navigation');
  });

  it('detects WordPress from rendered evidence when no hint is provided', async () => {
    const report = await runAudit({
      journeyId: 'wp-home',
      environment: 'staging',
      html: '<main><img src="hero.png"><script src="/wp-content/theme.js"></script></main>',
    });

    expect(report.platform.id).toBe('wordpress');
    expect(report.platform.hints).toContain('theme-plugin-boundary');
  });

  it('prefers an explicit WordPress hint over conflicting React markup', async () => {
    const report = await runAudit({
      journeyId: 'wp-home',
      environment: 'staging',
      html: '<div data-reactroot="true"><script src="/wp-content/theme.js"></script></div>',
      platformHint: 'wordpress',
    });

    expect(report.platform.id).toBe('wordpress');
    expect(report.platform.hints).toContain('theme-plugin-boundary');
  });

  it('falls back to the generic adapter for unknown apps', async () => {
    const report = await runAudit({
      journeyId: 'custom-home',
      environment: 'staging',
      html: '<main><img src="hero.png"></main>',
    });

    expect(report.platform.id).toBe('generic');
    expect(report.platform.hints).toContain('rendered-dom-baseline');
  });
});
