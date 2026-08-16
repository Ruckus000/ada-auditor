import { describe, expect, it } from 'vitest';
import { describePageEvidence } from '../../src/services/presentation/page-evidence';

describe('describePageEvidence', () => {
  it('says nothing about a status when the page was fine', () => {
    // A 200 beside "complete" is noise. The code earns its place only when it
    // explains a problem.
    expect(describePageEvidence('complete', 200)).toBe('evidence complete');
    expect(describePageEvidence('complete')).toBe('evidence complete');
  });

  it('names the code when the code is the reason', () => {
    expect(describePageEvidence('degraded', 500)).toBe('served 500 — not usable as evidence');
    expect(describePageEvidence('degraded', 404)).toBe('served 404 — not usable as evidence');
    expect(describePageEvidence('degraded', 403)).toBe('served 403 — not usable as evidence');
  });

  /**
   * The distinction this whole helper exists for.
   *
   * Both of these are `degraded`, and before this they rendered the same word.
   * One is our capture breaking; the other is the client's server returning an
   * error. Sending the wrong person to look is worse than saying less.
   */
  it('distinguishes a broken capture from an error page', () => {
    const brokenCapture = describePageEvidence('degraded');
    const errorPage = describePageEvidence('degraded', 500);

    expect(brokenCapture).not.toBe(errorPage);
    expect(brokenCapture).toBe('evidence degraded');
  });

  it('does not blame a status that was never measured', () => {
    // A `file://` run and every page predating the column have no status. The
    // page is degraded for the older reason, and inventing a code to blame
    // would send an operator after a server problem that does not exist.
    expect(describePageEvidence('degraded', undefined)).toBe('evidence degraded');
  });

  it('says the capture failed when the page itself was served fine', () => {
    expect(describePageEvidence('degraded', 200)).toBe(
      'evidence degraded (page returned 200)',
    );
  });

  it('passes through a status it does not have a rule for', () => {
    // `unknown` is real: `findings-view` gives it to findings whose page is not
    // in the run's page list.
    expect(describePageEvidence('unknown')).toBe('evidence unknown');
  });
});
