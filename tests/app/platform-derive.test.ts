import { describe, expect, it } from 'vitest';
import {
  activityCountLabel,
  activityDays,
  clientLinkView,
  clientView,
  draftReport,
  findingDetail,
  findingFilterCount,
  findingRows,
  findingSummary,
  findingsFor,
  journeysFor,
  reportSections,
  searchHint,
  searchResults,
  shareLink,
  siteViews,
  standardChips,
  type FindingOverrides,
} from '@/app/platform/lib/derive';

const NONE: FindingOverrides = {};

describe('portfolio rows', () => {
  it('counts only open findings as must-fix', () => {
    const acme = siteViews(NONE).find((s) => s.name === 'Acme Outfitters')!;
    // Acme has four must-fix findings, none of them dismissed in the fixture.
    expect(acme.must).toBe(4);
    // One "should fix" is dismissed, so it is not counted.
    expect(acme.should).toBe(2);
  });

  it('drops a finding from the open count once it is dismissed', () => {
    const overrides: FindingOverrides = { 'Acme Outfitters': { 0: 'Dismissed' } };
    const acme = siteViews(overrides).find((s) => s.name === 'Acme Outfitters')!;
    expect(acme.must).toBe(3);
  });

  it('marking fixed keeps the finding open until a run confirms it', () => {
    const overrides: FindingOverrides = { 'Acme Outfitters': { 0: 'Retest due' } };
    const acme = siteViews(overrides).find((s) => s.name === 'Acme Outfitters')!;
    expect(acme.must).toBe(4);
  });

  it('reports a scanning client without a score', () => {
    const brightside = siteViews(NONE).find((s) => s.name === 'Brightside Clinic')!;
    expect(brightside.score).toBe('—');
    expect(brightside.deltaLong).toBe('still running');
  });

  it('pluralises the score delta', () => {
    const rows = siteViews(NONE);
    expect(rows.find((s) => s.name === 'Fern & Foster')!.deltaLong).toBe('+1 point');
    expect(rows.find((s) => s.name === 'Acme Outfitters')!.deltaLong).toBe('+3 points');
    expect(rows.find((s) => s.name === 'Lumen Learning')!.deltaLong).toBe('no change');
  });
});

describe('client verdict', () => {
  it('leads with the number of blocking findings', () => {
    const acme = clientView(2, NONE);
    expect(acme.verdictBody.startsWith('4 findings block conformance today.')).toBe(true);
    expect(acme.hasBlocking).toBe(true);
    expect(acme.blocking).toHaveLength(4);
  });

  it('says nothing blocks when a client is clean', () => {
    const cedar = clientView(7, NONE);
    expect(cedar.verdictBody.startsWith('Nothing blocks conformance today.')).toBe(true);
    expect(cedar.hasBlocking).toBe(false);
  });

  it('flags a run that is still going rather than claiming a verdict', () => {
    const brightside = clientView(4, NONE);
    expect(brightside.verdictBody.startsWith('This run is still going.')).toBe(true);
    expect(brightside.verdictHead).toBe('Still testing');
  });

  it('warns that dismissals stay counted when generating a report', () => {
    expect(clientView(2, NONE).genWarning).toContain('stay counted as unresolved');
    expect(clientView(7, NONE).genWarning).toContain('manual review is recommended');
  });

  it('excludes skipped pages from the tested count', () => {
    const acme = clientView(2, NONE);
    expect(acme.coverage[0]).toEqual({ label: 'Pages tested', n: 18, color: '#0b5f58' });
    expect(acme.coverage[1].n).toBe(6);
    expect(acme.hasSkipped).toBe(true);
  });
});

describe('journeys', () => {
  it('collapses runs of three or more clean steps on long journeys', () => {
    const mortgage = journeysFor('Halcyon Bank', {}).find(
      (j) => j.name === 'Apply for a mortgage',
    )!;
    expect(mortgage.canToggle).toBe(true);
    const gaps = mortgage.items.filter((i) => i.isGap);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ label: '4 clean steps', range: '4–7' });
  });

  it('shows every step once expanded', () => {
    const key = 'Halcyon Bank·Apply for a mortgage';
    const mortgage = journeysFor('Halcyon Bank', { [key]: true }).find(
      (j) => j.name === 'Apply for a mortgage',
    )!;
    expect(mortgage.items).toHaveLength(11);
    expect(mortgage.items.every((i) => !i.isGap)).toBe(true);
  });

  it('never collapses a short journey', () => {
    const checkout = journeysFor('Acme Outfitters', {}).find(
      (j) => j.name === 'Guest checkout',
    )!;
    expect(checkout.canToggle).toBe(false);
    expect(checkout.items).toHaveLength(6);
  });

  it('names the first step that breaks', () => {
    const checkout = journeysFor('Acme Outfitters', {}).find(
      (j) => j.name === 'Guest checkout',
    )!;
    expect(checkout.firstBreak).toBe('first breaks at step 3 · Add to cart');
    const enrol = journeysFor('Lumen Learning', {}).find((j) => j.name === 'Enrol in a course')!;
    expect(enrol.firstBreak).toBe('no barriers found');
  });
});

describe('findings list', () => {
  const acme = findingsFor('Acme Outfitters', NONE);

  it('counts each filter against open findings only', () => {
    expect(findingFilterCount(acme, 'all')).toBe(7);
    expect(findingFilterCount(acme, 'must')).toBe(4);
    expect(findingFilterCount(acme, 'dismissed')).toBe(1);
  });

  it('hides dismissed findings from every open filter', () => {
    expect(findingRows(acme, 'all').some((r) => r.status === 'Dismissed')).toBe(false);
    expect(findingRows(acme, 'should')).toHaveLength(2);
    expect(findingRows(acme, 'dismissed')).toHaveLength(1);
  });

  it('keeps row indices pointing at the underlying record', () => {
    const dismissed = findingRows(acme, 'dismissed')[0];
    expect(acme[dismissed.index].what).toBe(dismissed.what);
  });

  it('summarises a clean client without inventing counts', () => {
    expect(findingSummary(findingsFor('Cedar & Co', NONE), 40)).toBe(
      'No findings in run #40 — clean for this standard',
    );
    expect(findingSummary(acme, 131)).toBe('4 must fix · 2 should fix · run #131');
  });
});

describe('finding detail', () => {
  it('explains that one template change closes every occurrence', () => {
    const acme = findingsFor('Acme Outfitters', NONE);
    const detail = findingDetail('Acme Outfitters', acme, 0, 131)!;
    expect(detail.fileNote).toContain('one change closes all 5');
    expect(detail.wcagLabel).toBe('WCAG 4.1.2 · Name, Role, Value');
    expect(detail.crumb).toBe('Acme Outfitters / Run #131 / Finding 01');
  });

  it('uses the singular note when a finding sits on one page', () => {
    const acme = findingsFor('Acme Outfitters', NONE);
    const detail = findingDetail('Acme Outfitters', acme, 1, 131)!;
    expect(detail.fileNote).toBe('The change lives in checkout/PaymentFrame.tsx.');
  });

  it('returns nothing for a client with no findings', () => {
    expect(findingDetail('Cedar & Co', findingsFor('Cedar & Co', NONE), 0, 40)).toBeNull();
  });

  it('clamps an out-of-range index instead of throwing', () => {
    const acme = findingsFor('Acme Outfitters', NONE);
    expect(findingDetail('Acme Outfitters', acme, 99, 131)!.crumb).toContain('Finding 08');
  });
});

describe('activity', () => {
  it('filters the log to one client', () => {
    const days = activityDays('Portland Transit', {});
    expect(days).toHaveLength(1);
    expect(days[0].rows).toHaveLength(1);
  });

  it('marks a row undone rather than removing it', () => {
    const target = 'Heading level skips from h1 to h4';
    const [today] = activityDays('all', { [target]: true });
    const row = today.rows.find((r) => r.target === target)!;
    expect(row.revertable).toBe(false);
    expect(row.reverted).toBe(true);
  });

  it('labels the entry count', () => {
    expect(activityCountLabel(1, 'all')).toBe('1 entry · last 7 days');
    expect(activityCountLabel(4, 'Acme Outfitters')).toBe('4 entries · Acme Outfitters');
  });
});

describe('reports', () => {
  it('drops the criteria table for an executive audience', () => {
    const exec = reportSections('exec').map((s) => [s.label, s.tick]);
    expect(exec).toContainEqual(['Criterion-by-criterion table', '']);
    expect(exec).toContainEqual(['Untested pages disclosure', '✓']);
    const dev = reportSections('dev').map((s) => [s.label, s.tick]);
    expect(dev).toContainEqual(['Code and file paths', '✓']);
  });

  it('marks the 508 chip for a public-sector standard', () => {
    const chips = standardChips({
      standard: 'Section 508 · WCAG 2.0 Level AA',
    } as Parameters<typeof standardChips>[0]);
    expect(chips.find((c) => c.label === '508')!.color).toBe('#fff');
    expect(chips.find((c) => c.label === 'WCAG 2.2 AA')!.color).toBe('#55636b');
  });

  it('builds a draft from the live counts, not a frozen report', () => {
    const acme = clientView(2, NONE);
    const draft = draftReport(acme, findingsFor('Acme Outfitters', NONE));
    expect(draft.verdict).toBe('DOES NOT CONFORM');
    expect(draft.sev[0]).toBe(4);
    expect(draft.para1).toContain('4 findings block conformance today.');
    expect(draft.para2).toContain('has not been issued');
  });
});

describe('client link', () => {
  it('hides dismissed findings from the client-facing view', () => {
    const view = clientLinkView('Acme Outfitters', NONE);
    expect(view.findings.every((f) => f.what !== 'Heading levels skip from h1 to h4')).toBe(true);
    expect(view.findings).toHaveLength(3);
  });

  it('names the excluded pages in the footer', () => {
    expect(clientLinkView('Acme Outfitters', NONE).footer).toContain(
      '6 pages behind a sign-in were not tested',
    );
    expect(clientLinkView('Cedar & Co', NONE).footer).not.toContain('behind a sign-in');
  });

  it('marks an expired share link as dead', () => {
    expect(shareLink('Cedar & Co', 40)).toMatchObject({
      live: false,
      deadLabel: 'EXPIRED',
      urlDecoration: 'line-through',
    });
    expect(shareLink('Halcyon Bank', 52)).toMatchObject({ live: false, deadLabel: 'NO LINK' });
    expect(shareLink('Acme Outfitters', 131).url).toBe('meridian.audit/acme/131');
  });
});

describe('client search', () => {
  it('offers the clients that need work when there is no query', () => {
    const results = searchResults('', NONE);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.mustLabel.includes('must fix'))).toBe(true);
    expect(searchHint('', results)).toBe('NEEDS WORK FIRST');
  });

  it('matches on domain as well as name', () => {
    const results = searchResults('portland.gov', NONE);
    expect(results.map((r) => r.name)).toEqual(['Portland Transit']);
    expect(searchHint('portland.gov', results)).toBe('1 MATCH');
  });

  it('reports no matches rather than falling back to a list', () => {
    const results = searchResults('zzzz', NONE);
    expect(results).toHaveLength(0);
    expect(searchHint('zzzz', results)).toBe('0 MATCHES');
  });
});
