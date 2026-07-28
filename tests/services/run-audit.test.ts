import { describe, expect, it } from 'vitest';
import { runAudit } from '../../src/services/run-audit';

describe('runAudit', () => {
  it('rejects deterministic findings and returns inconclusive when evidence is incomplete', async () => {
    const report = await runAudit({
      journeyId: 'demo-login',
      environment: 'staging',
      html: '<main><img src="hero.png"></main>',
      omitAxTree: true,
    });

    expect(report.evidenceStatus).toBe('degraded');
    expect(report.ciStatus).toBe('inconclusive');
    expect(report.findings.every((finding) => finding.source !== 'deterministic')).toBe(true);
  });

  it('fails CI on deterministic criticals when evidence is complete', async () => {
    const report = await runAudit({
      journeyId: 'demo-login',
      environment: 'staging',
      html: '<main><img src="hero.png"></main>',
    });

    expect(report.evidenceStatus).toBe('complete');
    expect(report.ciStatus).toBe('fail');
    expect(report.findings.some((finding) => finding.code === 'missing-image-alt')).toBe(true);
  });

  it('surfaces AI advisory on clean HTML with complete evidence without failing CI', async () => {
    const report = await runAudit({
      journeyId: 'demo-login',
      environment: 'staging',
      html: '<main><img src="hero.png" alt="Hero"></main>',
    });

    expect(report.evidenceStatus).toBe('complete');
    expect(report.ciStatus).toBe('pass');
    expect(report.findings.some((finding) => finding.source === 'ai-advisory')).toBe(true);
  });

  it('returns inconclusive for incomplete evidence with clean HTML', async () => {
    const report = await runAudit({
      journeyId: 'demo-login',
      environment: 'staging',
      html: '<main><p>Hello</p></main>',
      omitAxTree: true,
    });

    expect(report.evidenceStatus).toBe('degraded');
    expect(report.ciStatus).toBe('inconclusive');
    expect(report.ciStatus).not.toBe('pass');
  });

  it('blocks forbidden production actions before execution', async () => {
    await expect(
      runAudit({
        journeyId: 'delete-journey',
        environment: 'production',
        html: '<main></main>',
        requestedAction: 'delete',
      }),
    ).rejects.toThrow('Action is not allowed by environment policy.');
  });

  it('rejects journeys outside the contract scope', async () => {
    await expect(
      runAudit({
        journeyId: 'demo-login',
        environment: 'staging',
        html: '<main></main>',
        allowedJourneyIds: ['other-journey'],
      }),
    ).rejects.toThrow('Journey is not allowed by run contract scope.');
  });
});
