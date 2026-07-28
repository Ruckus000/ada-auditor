import { describe, expect, it } from 'vitest';
import { createRunContract } from '../../src/domain/contracts';

describe('createRunContract', () => {
  it('creates a run contract with required policies', () => {
    const contract = createRunContract({
      environment: 'staging',
      identity: { accountId: 'acct-demo', role: 'auditor' },
      scope: { allowedDomains: ['app.example.com'], journeyIds: ['demo-login'] },
      actionPolicy: { mode: 'safe-write' },
      recoveryPolicy: { maxAttempts: 1, strategies: ['selector-fallback'] },
      confidencePolicy: { minContinue: 0.8, minReport: 0.7 },
      failureMode: 'degrade',
    });

    expect(contract.environment).toBe('staging');
    expect(contract.scope.journeyIds).toEqual(['demo-login']);
    expect(contract.recoveryPolicy.strategies).toContain('selector-fallback');
  });

  it('accepts optional platform and capability metadata', () => {
    const contract = createRunContract({
      environment: 'staging',
      identity: { accountId: 'acct-demo', role: 'auditor' },
      scope: { allowedDomains: ['app.example.com'], journeyIds: ['demo-login'] },
      actionPolicy: { mode: 'safe-write' },
      recoveryPolicy: { maxAttempts: 1, strategies: ['selector-fallback'] },
      confidencePolicy: { minContinue: 0.8, minReport: 0.7 },
      failureMode: 'degrade',
      platform: 'react',
      platformCapabilities: {
        spaNavigationHints: true,
        componentSourceHints: true,
        cmsTemplateHints: false,
      },
    });

    expect(contract.platform).toBe('react');
    expect(contract.platformCapabilities?.componentSourceHints).toBe(true);
  });
});
