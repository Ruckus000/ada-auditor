import { describe, expect, it } from 'vitest';
import { runDeterministicAudit } from '../../src/services/deterministic-audit';

describe('runDeterministicAudit', () => {
  it('returns a critical finding when image alt text is missing', () => {
    const findings = runDeterministicAudit({
      html: '<main><img src="hero.png"></main>',
    });

    expect(findings[0]).toMatchObject({
      code: 'missing-image-alt',
      severity: 'critical',
    });
  });

  it('returns no finding when image alt text exists', () => {
    const findings = runDeterministicAudit({
      html: '<main><img src="hero.png" alt="Hero"></main>',
    });

    expect(findings).toEqual([]);
  });
});
