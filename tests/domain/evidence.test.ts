import { describe, expect, it } from 'vitest';
import { createEvidenceBundle, worstEvidenceStatus } from '../../src/domain/evidence';

describe('createEvidenceBundle', () => {
  it('marks incomplete evidence as degraded', () => {
    const evidence = createEvidenceBundle({
      page: { url: 'https://app.example.com/dashboard', route: '/dashboard', title: 'Dashboard' },
      run: { journeyId: 'demo-login', stepId: 'dashboard', environment: 'staging' },
      artifacts: { screenshotPath: 'shot.png', domSnapshotPath: 'dom.html' },
    });

    expect(evidence.status).toBe('degraded');
  });

  it('marks complete evidence as complete', () => {
    const evidence = createEvidenceBundle({
      page: { url: 'https://app.example.com/dashboard', route: '/dashboard', title: 'Dashboard' },
      run: { journeyId: 'demo-login', stepId: 'dashboard', environment: 'staging' },
      artifacts: {
        screenshotPath: 'shot.png',
        domSnapshotPath: 'dom.html',
        axTreePath: 'ax.json',
      },
    });

    expect(evidence.status).toBe('complete');
  });
});

describe('worstEvidenceStatus', () => {
  it('is complete only when every page is', () => {
    expect(worstEvidenceStatus(['complete', 'complete'])).toBe('complete');
  });

  it('lets one degraded page drag the whole run down', () => {
    // Steady-state rule: incomplete evidence is never pass and never fail. A
    // run that audits five pages and captured full evidence for four of them
    // still cannot be judged.
    expect(worstEvidenceStatus(['complete', 'degraded', 'complete'])).toBe('degraded');
  });

  it('treats a run that captured nothing as degraded, not clean', () => {
    expect(worstEvidenceStatus([])).toBe('degraded');
  });
});
