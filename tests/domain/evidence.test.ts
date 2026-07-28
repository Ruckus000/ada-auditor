import { describe, expect, it } from 'vitest';
import { createEvidenceBundle } from '../../src/domain/evidence';

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
