import { describe, expect, it } from 'vitest';
import { boundTitle, createEvidenceBundle, worstEvidenceStatus } from '../../src/domain/evidence';

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
   * The page was an error page, so nothing on it is evidence of anything.
   *
   * Every artifact is present here — this is not an incomplete capture. It is
   * a complete capture of the wrong page, which is the case that used to score
   * *higher* than a real audit because error pages are small and clean.
   */
  it.each([400, 401, 403, 404, 429, 500, 503])('refuses to call a %i page complete', (status) => {
    const evidence = createEvidenceBundle({
      page: {
        url: 'https://app.example.com/dashboard',
        route: '/dashboard',
        title: 'Error',
        statusCode: status,
      },
      run: { journeyId: 'demo-login', stepId: 'dashboard', environment: 'staging' },
      artifacts: {
        screenshotPath: 'shot.png',
        domSnapshotPath: 'dom.html',
        axTreePath: 'ax.json',
      },
    });

    expect(evidence.status).toBe('degraded');
  });

  it.each([200, 204, 301, 302, 304, 399])('keeps a %i page complete', (status) => {
    // 3xx included deliberately. A redirect that was followed ends at the
    // status of wherever it landed; one that was not is what the page is.
    // Neither is an error, and treating them as one would degrade every
    // journey that passes through a login redirect — the normal case.
    const evidence = createEvidenceBundle({
      page: {
        url: 'https://app.example.com/dashboard',
        route: '/dashboard',
        title: 'Dashboard',
        statusCode: status,
      },
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
   * Absent is not 200.
   *
   * A `file://` fixture run has no HTTP status, and so does every page
   * recorded before the column existed. If absence defaulted to an error the
   * whole browser suite would degrade; if it defaulted to 200 the field would
   * be asserting a measurement nobody took. It has to mean neither.
   */
  it('treats a missing status as not measured, not as an error', () => {
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
    expect(evidence.page.statusCode).toBeUndefined();
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

describe('boundTitle', () => {
  // Why it exists and why it is not a `.max()` are in the source docblock.
  // What these pin is the behaviour: pass through, cut with a marker, and do
  // not mark a title that fits.
  it('leaves a real title alone', () => {
    expect(boundTitle('Checkout — Acme')).toBe('Checkout — Acme');
    expect(boundTitle('')).toBe('');
  });

  it('cuts a hostile title down and says that it cut it', () => {
    const bounded = boundTitle('a'.repeat(50_000));

    // The marker matters: a silent cut presents a fragment as the whole title.
    expect(bounded.endsWith('…')).toBe(true);
    expect(bounded.length).toBeLessThan(400);
  });

  it('does not add a marker to a title that fits exactly', () => {
    const exact = 'a'.repeat(300);

    expect(boundTitle(exact)).toBe(exact);
  });
});
