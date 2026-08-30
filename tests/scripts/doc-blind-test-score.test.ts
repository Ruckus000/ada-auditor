import { describe, expect, it } from 'vitest';

import {
  type Correction,
  type DeliverySummary,
  type DocKey,
  type RunResult,
  exitCode,
  observedDisposition,
  renderScore,
  scoreDocument,
  scoreRun,
} from '../../scripts/doc-blind-test/score';

/**
 * The scorer graded before it grades.
 *
 * Every outcome in the taxonomy gets a synthetic result here, because the
 * first real run is the worst possible moment to discover that a facet never
 * fires — a scorer that cannot say "silent gap" reports a clean sweep on a
 * document that reached a client with a clause nobody mentioned.
 */

const summary = (over: Partial<DeliverySummary> = {}): DeliverySummary => ({
  title: 'already-titled',
  titleText: 'Program Notice',
  sourceLanguage: 'en-US',
  tagged: true,
  pages: 1,
  headings: 2,
  tables: 0,
  lists: 0,
  figures: 0,
  gaps: [],
  conformance: { checker: 'verapdf-ua1', compliant: true },
  ...over,
});

const key = (over: Partial<DocKey> = {}): DocKey => ({
  id: 'p01',
  file: 'p01.pdf',
  sha256: 'abc',
  origin: 'planted',
  kind: 'pdf',
  weight: 'core',
  tests: 'the ordinary good case',
  ...over,
  expected: {
    disposition: 'delivered',
    title: 'already-titled',
    titleText: 'Program Notice',
    language: 'en-US',
    counts: { pages: 1, headings: 2, tables: 0, lists: 0, figures: 0 },
    needs: [],
    gapCriteria: [],
    ...over.expected,
  },
});

const delivered = (over: Partial<DeliverySummary> = {}): RunResult => ({
  id: 'p01',
  status: 200,
  summary: summary(over),
  wallMs: 100,
  independent: { checked: true, compliant: true },
});

const fatalOutcomes = (k: DocKey, r: RunResult, c: Correction[] = []) =>
  scoreDocument(k, r, c).findings.filter((f) => f.fatal).map((f) => f.outcome);
const outcomes = (k: DocKey, r: RunResult, c: Correction[] = []) =>
  scoreDocument(k, r, c).findings.map((f) => f.outcome);

describe('reading what the product did off the response', () => {
  it('maps every refusal the pipeline can produce to its own disposition', () => {
    const at = (status: number, detail?: string): RunResult =>
      ({ id: 'x', status, refusal: { detail }, wallMs: 1 });

    expect(observedDisposition({ id: 'x', status: 200, wallMs: 1 })).toBe('delivered');
    expect(observedDisposition(at(422, 'signed'))).toBe('refused-signed');
    expect(observedDisposition(at(422, 'not-tagged'))).toBe('refused-not-tagged');
    expect(observedDisposition(at(422, 'content-changed'))).toBe('refused-content-changed');
    expect(observedDisposition(at(422, 'converter-failed'))).toBe('refused-pipeline');
    expect(observedDisposition(at(415))).toBe('door');
  });
});

describe('the clean case', () => {
  it('finds nothing fatal when the delivery matches its key', () => {
    expect(fatalOutcomes(key(), delivered())).toEqual([]);
  });
});

describe('disposition', () => {
  it('records a refusal of the wrong kind as a difference, not as a miss', () => {
    const k = key({ expected: { disposition: 'refused-signed' } });
    const result: RunResult = { id: 'p01', status: 422, refusal: { detail: 'not-tagged' }, wallMs: 1 };
    expect(outcomes(k, result)).toContain('refused-differently');
  });

  it('fails a delivery where the key expected a refusal', () => {
    const k = key({ expected: { disposition: 'refused-not-tagged' } });
    expect(fatalOutcomes(k, delivered())).toContain('delivered-when-refusal-expected');
  });

  it('accepts either of the dispositions an open question allows', () => {
    const k = key({
      weight: 'probe',
      expected: { dispositionOneOf: ['delivered', 'refused-not-tagged'], counts: null, needs: undefined, gapCriteria: undefined },
    });
    expect(fatalOutcomes(k, delivered())).toEqual([]);
  });

  it('fails a delivery the key forbids outright, even on a probe row', () => {
    // An encrypted document delivered is not a probe surprise. Weight governs
    // predictions; it does not soften promises.
    const k = key({
      weight: 'probe',
      expected: { dispositionOneOf: ['refused-pipeline'], mustNotDeliver: true },
    });
    expect(fatalOutcomes(k, delivered())).toContain('delivered-when-refusal-expected');
  });
});

describe('the door', () => {
  const doorKey = (over: Partial<DocKey['expected']> = {}) =>
    key({ id: 'd01', kind: 'door', expected: { status: 415, ...over } });

  it('passes when the status is the one the key names', () => {
    expect(outcomes(doorKey(), { id: 'd01', status: 415, wallMs: 1 })).toEqual(['door-hit']);
  });

  it('calls an accepted document that should have bounced a leak', () => {
    expect(fatalOutcomes(doorKey(), { id: 'd01', status: 200, summary: summary(), wallMs: 1 }))
      .toEqual(['door-leaked']);
  });

  it('reports a refusal with the wrong status without calling it a leak', () => {
    expect(outcomes(doorKey(), { id: 'd01', status: 400, wallMs: 1 })).toEqual(['door-wrong-status']);
  });

  it('accepts any of the statuses an open question allows', () => {
    const k = doorKey({ status: undefined, statusOneOf: [400, 415, 422] });
    expect(outcomes(k, { id: 'd01', status: 422, wallMs: 1 })).toEqual(['door-hit']);
  });
});

describe('invented claims', () => {
  it('fails a title claimed where the key plants none', () => {
    const k = key({ expected: { titleText: null, title: 'no-heading-to-copy' } });
    expect(fatalOutcomes(k, delivered({ title: 'no-heading-to-copy', titleText: 'Invented' })))
      .toContain('invented-title');
  });

  it('fails a language claimed where the document declares none', () => {
    const k = key({ expected: { language: null } });
    expect(fatalOutcomes(k, delivered({ sourceLanguage: 'en-US' }))).toContain('invented-language');
  });

  it('does not call a wrong title an invented one', () => {
    // p04 carries an exporter's leftover as its title. Reporting that
    // faithfully is transcription working, even where the key wanted the
    // heading instead — and the invented-claims line has to mean what it says.
    const k = key({ weight: 'probe', expected: { titleText: 'Annual Report' } });
    const found = scoreDocument(k, delivered({ titleText: 'Microsoft Word - Document1.docx' })).findings;

    expect(found.map((f) => f.outcome)).toContain('wrong-title');
    expect(found.every((f) => f.facet !== 'invented-claim')).toBe(true);
  });

  it('fails a title the document superseded', () => {
    const k = key({ mustNotClaim: ['Superseded Title'], expected: { titleText: 'Current Title' } });
    expect(fatalOutcomes(k, delivered({ titleText: 'Superseded Title' }))).toContain('superseded-claim');
  });

  it('fails an already-titled claim about a document that declares no title', () => {
    // The real-document form of the same sin: keys for real files carry a
    // hash of the title rather than the title, so this is what remains
    // checkable, and it is the half that matters.
    const k = key({ origin: 'real', expected: { titleDeclared: false, titleText: undefined, title: undefined } });
    expect(fatalOutcomes(k, delivered({ title: 'already-titled' }))).toContain('invented-title');
  });

  it('treats more structure than the document holds as an invented claim, not a miscount', () => {
    const k = key({ expected: { counts: { pages: 1, headings: 2, tables: 0, lists: 0, figures: 0 } } });
    const found = scoreDocument(k, delivered({ headings: 5 })).findings;
    expect(found.map((f) => f.outcome)).toContain('invented-structure');
    expect(found.find((f) => f.outcome === 'invented-structure')?.facet).toBe('invented-claim');
  });

  it('treats less structure than the document holds as a miscount', () => {
    const found = scoreDocument(key(), delivered({ headings: 1 })).findings;
    expect(found.map((f) => f.outcome)).toContain('counts-off');
    expect(found.every((f) => f.facet !== 'invented-claim')).toBe(true);
  });

  it('does not score a count no third-party instrument could read', () => {
    const k = key({ origin: 'real', expected: { counts: { pages: null, headings: 2 }, titleText: undefined, title: undefined } });
    const found = scoreDocument(k, delivered()).findings;
    expect(found.map((f) => f.outcome)).toContain('unverifiable');
    expect(found.filter((f) => f.fatal)).toEqual([]);
  });
});

describe('the punch list', () => {
  it('fails a criterion the key requires and nothing voices', () => {
    const k = key({ expected: { needs: ['3.1.1'] } });
    expect(fatalOutcomes(k, delivered())).toContain('punch-missing');
  });

  it('counts one item per undescribed figure', () => {
    const k = key({ expected: { needs: ['1.1.1', '1.1.1'], counts: { figures: 2 } } });
    const one = delivered({
      figures: 2,
      needs: [{ criterion: '1.1.1', item: 'Figure 1 needs a description' }],
    });
    expect(fatalOutcomes(k, one)).toEqual(['punch-missing']);
  });

  it('lists an item the key did not predict without failing the run', () => {
    const found = scoreDocument(key(), delivered({
      needs: [{ criterion: '2.4.10', item: 'Heading levels skip' }],
    })).findings;
    expect(found.map((f) => f.outcome)).toContain('punch-unexpected');
    expect(found.filter((f) => f.fatal)).toEqual([]);
  });

  it('does not call an extra item unexpected when the key is a must-include set', () => {
    // Real-document keys predict what the evidence proves and no more, so a
    // product that voices more than a third-party reading could derive is
    // being thorough, not wrong.
    const k = key({ origin: 'real', expected: { needs: [], needsExact: false, titleText: undefined, title: undefined } });
    const found = scoreDocument(k, delivered({ needs: [{ criterion: '2.4.10', item: 'starts deep' }] })).findings;
    expect(found.map((f) => f.outcome)).not.toContain('punch-unexpected');
  });

  it('fails a clause family repair cannot fix and the punch list does not name', () => {
    const k = key({
      expected: { conformance: { compliant: false, mustVoice: ['7.21.4'] } },
    });
    const result = delivered({
      conformance: { checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.21.4.1-1'] },
      needs: [{ criterion: 'PDF/UA', item: '1 further PDF/UA check fails (7.21.4.1-1) — a person must review' }],
    });
    expect(fatalOutcomes({ ...k, expected: { ...k.expected } }, { ...result, independent: { checked: true, compliant: false, clauses: ['7.21.4.1-1'] } }))
      .toContain('punch-missing');
  });
});

describe('the promise: no clause reaches a client as silence', () => {
  const failing = (clauses: string[], needs: DeliverySummary['needs'], gaps: string[] = []) =>
    delivered({
      conformance: { checker: 'verapdf-ua1', compliant: false, failingClauses: clauses },
      needs,
      gaps,
    });

  it('fails a clause nothing voices', () => {
    const result = { ...failing(['7.9.1-1'], undefined), independent: { checked: true, compliant: false, clauses: ['7.9.1-1'] } };
    expect(fatalOutcomes(key({ expected: { conformance: 'any' } }), result)).toContain('silent-clause');
  });

  it('accepts a clause the catch-all names outright', () => {
    const result = {
      ...failing(['7.9.1-1'], [{ criterion: 'PDF/UA', item: '1 further PDF/UA check fails (7.9.1-1) — a person must review' }]),
      independent: { checked: true, compliant: false, clauses: ['7.9.1-1'] },
    };
    expect(fatalOutcomes(key({ expected: { conformance: 'any' } }), result)).toEqual([]);
  });

  it('accepts a clause a named family item covers', () => {
    const result = {
      ...failing(['7.21.4.1-1'], [{ criterion: 'PDF/UA 7.21.4', item: 'the fonts were never embedded' }]),
      independent: { checked: true, compliant: false, clauses: ['7.21.4.1-1'] },
    };
    expect(fatalOutcomes(key({ expected: { conformance: 'any' } }), result)).toEqual([]);
  });

  it('accepts a suppressed clause when the document voices something of its own', () => {
    const result = {
      ...failing(['7.2-1'], [{ criterion: '3.1.1', item: 'name the language' }]),
      independent: { checked: true, compliant: false, clauses: ['7.2-1'] },
    };
    const k = key({ expected: { conformance: 'any', needs: ['3.1.1'] } });
    expect(fatalOutcomes(k, result)).toEqual([]);
  });

  it('reports a suppressed clause in a document that voices nothing at all', () => {
    // Suppression means "one of our own items already says this". When there
    // are no items, nothing is saying it — reported rather than failed,
    // because the clause-to-item mapping is the product's and this scorer
    // must not invent one.
    const result = {
      ...failing(['7.2-1'], undefined),
      independent: { checked: true, compliant: false, clauses: ['7.2-1'] },
    };
    const found = scoreDocument(key({ expected: { conformance: 'any' } }), result).findings;
    expect(found.map((f) => f.outcome)).toContain('suppressed-but-quiet');
    expect(found.filter((f) => f.fatal)).toEqual([]);
  });

  it('fails a delivery that carries no conformance verdict at all', () => {
    expect(fatalOutcomes(key(), delivered({ conformance: undefined }))).toContain('absent');
  });

  it('does not read an unavailable checker as clean', () => {
    const found = scoreDocument(key(), delivered({ conformance: { checker: 'none', reason: 'unavailable' } })).findings;
    expect(found.map((f) => f.outcome)).toContain('not-checked');
  });
});

describe('drift between the product and an independent reading', () => {
  it('fails when the two disagree about compliance', () => {
    const result: RunResult = {
      ...delivered({ conformance: { checker: 'verapdf-ua1', compliant: true } }),
      independent: { checked: true, compliant: false, clauses: ['7.1-3'] },
    };
    expect(fatalOutcomes(key(), result)).toContain('verdict-drift');
  });

  it('fails when they agree on failure and disagree on which clauses', () => {
    const result: RunResult = {
      ...delivered({ conformance: { checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.1-3'] } }),
      independent: { checked: true, compliant: false, clauses: ['7.9.1-1'] },
    };
    expect(fatalOutcomes(key({ expected: { conformance: 'any' } }), result)).toContain('clause-drift');
  });

  it('ignores clause order, which is not a difference', () => {
    const result: RunResult = {
      ...delivered({
        conformance: { checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.21.4.1-1', '7.1-3'] },
        needs: [
          { criterion: 'PDF/UA 7.21.4', item: 'fonts' },
          { criterion: 'PDF/UA 7.1-3', item: 'untagged' },
        ],
      }),
      independent: { checked: true, compliant: false, clauses: ['7.1-3', '7.21.4.1-1'] },
    };
    expect(fatalOutcomes(key({ expected: { conformance: 'any' } }), result)).toEqual([]);
  });
});

describe('corrections are an overlay, never an edit', () => {
  const correction: Correction[] = [
    { docId: 'p01', field: 'language', was: 'en-US', now: null, evidence: 'qpdf shows no /Lang' },
  ];

  it('applies the corrected value', () => {
    const k = key({ expected: { language: 'en-US' } });
    expect(fatalOutcomes(k, delivered({ sourceLanguage: null }), correction)).toEqual([]);
  });

  it('marks the row as corrected so it can never read as a plain hit', () => {
    expect(scoreDocument(key(), delivered(), correction).corrected).toBe(true);
    expect(scoreDocument(key(), delivered()).corrected).toBe(false);
  });
});

describe('the run as a whole', () => {
  it('fails a corpus document the run never produced a result for', () => {
    const score = scoreRun([key()], {});
    expect(score.findings.map((f) => f.outcome)).toEqual(['not-run']);
    expect(exitCode(score)).toBe(1);
  });

  it('fails a request that never got an answer', () => {
    const score = scoreRun([key()], { p01: { id: 'p01', status: 0, wallMs: 1, transportError: 'socket hang up' } });
    expect(score.findings.map((f) => f.outcome)).toEqual(['no-answer']);
  });

  it('exits zero when every promise held', () => {
    expect(exitCode(scoreRun([key()], { p01: delivered() }))).toBe(0);
  });

  it('exits zero on a probe surprise', () => {
    const k = key({ weight: 'probe', expected: { language: 'fr-CA' } });
    const score = scoreRun([k], { p01: delivered() });
    expect(score.findings.length).toBeGreaterThan(0);
    expect(exitCode(score)).toBe(0);
  });

  it('names what regressed against the previous run', () => {
    const k = key();
    const before = scoreRun([k], { p01: delivered() });
    const after = scoreRun([k], { p01: delivered({ sourceLanguage: 'de-DE' }) });
    const lines = renderScore(after, [k], before).join('\n');
    expect(lines).toContain('1 regressed');
    expect(lines).toContain('regressed: p01');
  });

  it('reports invented claims on their own line and never inside a rate', () => {
    const k = key({ expected: { language: null } });
    const lines = renderScore(scoreRun([k], { p01: delivered() }), [k]);
    expect(lines.some((l) => /^Invented claims {2}1/.test(l))).toBe(true);
  });
});
