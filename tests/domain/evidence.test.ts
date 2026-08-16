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

  /**
   * The auditor must not die on the defect it exists to find.
   *
   * `title` was `.min(1)` and this function parses rather than safe-parses, so
   * a page whose `document.title` came back empty — an unhydrated shell, an
   * error page, or simply a page nobody titled — threw from inside the page
   * loop and took the entire run with it. Every other page's findings went
   * with it, and the run reported `audit_run_failed`.
   *
   * A page with no title is a WCAG 2.4.2 failure that axe reports as
   * `document-title`. It has to be recorded, and recorded as *complete*
   * evidence: degrading it would drop its findings, and the missing title is
   * one of them.
   */
  it('records a page with no title, as complete evidence, rather than throwing', () => {
    const evidence = createEvidenceBundle({
      page: { url: 'https://app.example.com/dashboard', route: '/dashboard', title: '' },
      run: { journeyId: 'demo-login', stepId: 'dashboard', environment: 'staging' },
      artifacts: {
        screenshotPath: 'shot.png',
        domSnapshotPath: 'dom.html',
        axTreePath: 'ax.json',
      },
    });

    expect(evidence.status).toBe('complete');
    expect(evidence.page.title).toBe('');
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
