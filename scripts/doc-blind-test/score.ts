/**
 * Grades one document blind-test run against its frozen answer keys.
 *
 * Pure: results in, verdicts out. No filesystem, no network, no `main()` at
 * import — `run.ts` does the driving, for the reason `scripts/blind-test`
 * splits the same way and `AGENTS.md` records: importing a script entry point
 * for one helper once migrated a real database.
 *
 * ## Facets, never blended
 *
 * The website scorer's hard-won lesson is that one number hides the thing you
 * needed to see: a rate that mixed "found the barrier" with "correctly stayed
 * quiet" improved when you added more silence. So every facet here is scored
 * and reported on its own, and the two population-level rates are never summed.
 *
 * ## What fails a run, and what is merely reported
 *
 * A run fails on the five promises: an accurate disposition, no invented
 * claim, no silent gap, no drift between the product's verdict and an
 * independent one, and a punch list that names what a person still has to do.
 * Everything else — a probe surprise, a punch item the key did not predict, a
 * count no third-party instrument could verify — is printed and costs nothing.
 * A key author is not the authority on their own corpus.
 */

/** What the run observed for one document. */
export type RunResult = {
  id: string;
  status: number;
  /** Parsed from the `x-remediation-summary` header on a delivery. */
  summary?: DeliverySummary;
  /** The JSON body of a refusal. */
  refusal?: { error?: string; detail?: string; message?: string };
  outputSha256?: string;
  /** An independent veraPDF run over the delivered bytes — the drift guard. */
  independent?: { checked: boolean; compliant?: boolean; clauses?: string[] };
  wallMs: number;
  /** Set when the request never produced an answer at all. */
  transportError?: string;
};

export type DeliverySummary = {
  title: string;
  titleText?: string;
  sourceLanguage: string | null;
  tagged: boolean;
  pages: number;
  headings: number;
  tables: number;
  lists: number;
  figures: number;
  gaps: string[];
  needs?: Array<{ criterion: string; item: string }>;
  conformance?:
    | { checker: 'verapdf-ua1'; compliant: true }
    | { checker: 'verapdf-ua1'; compliant: false; failingClauses: string[] }
    | { checker: 'none'; reason: string };
};

export type Counts = {
  pages?: number | null;
  headings?: number | null;
  tables?: number | null;
  lists?: number | null;
  figures?: number | null;
};

export type DocKey = {
  id: string;
  file: string;
  sha256: string;
  origin: 'planted' | 'real';
  kind: 'door' | 'pdf' | 'word';
  weight: 'core' | 'probe';
  tests: string;
  note?: string;
  sameSummaryAs?: string;
  mustNotClaim?: string[];
  expected: {
    /** Door rows stop at a status. */
    status?: number;
    statusOneOf?: number[];
    disposition?: Disposition;
    dispositionOneOf?: Disposition[];
    mustNotDeliver?: boolean;
    title?: string;
    titleText?: string | null;
    titleDeclared?: boolean;
    titleTextSha256?: string;
    language?: string | null;
    counts?: Counts | null;
    needs?: string[];
    needsExact?: boolean;
    gapCriteria?: string[];
    conformance?: 'any' | { compliant: true } | { compliant: false; mustVoice?: string[] };
  };
};

export type Disposition =
  | 'delivered'
  | 'refused-signed'
  | 'refused-not-tagged'
  | 'refused-content-changed'
  | 'refused-pipeline'
  | 'door';

/** A correction to a key, applied as an overlay and never as an edit. */
export type Correction = {
  docId: string;
  field: string;
  was: unknown;
  now: unknown;
  evidence: string;
};

/**
 * Clauses the product's own vocabulary already voices, so it does not repeat
 * them. Mirrored from the domain deliberately rather than imported: if the two
 * drift apart the scorer stops agreeing with the product, which is the point
 * of having a second copy in the instrument that grades it.
 */
const SUPPRESSED = /^(7\.2-|7\.2\.|7\.3-|7\.4|7\.1-9|7\.18\.)/;

/** What the product actually did, read off the response. */
export function observedDisposition(result: RunResult): Disposition {
  if (result.status === 200) return 'delivered';
  const detail = result.refusal?.detail;
  if (result.status === 422) {
    if (detail === 'signed') return 'refused-signed';
    if (detail === 'not-tagged') return 'refused-not-tagged';
    if (detail === 'content-changed') return 'refused-content-changed';
    return 'refused-pipeline';
  }
  return 'door';
}

export type Finding = {
  id: string;
  facet: string;
  outcome: string;
  detail: string;
  fatal: boolean;
  weight: 'core' | 'probe';
};

function multisetDiff(expected: string[], actual: string[]): { missing: string[]; extra: string[] } {
  const remaining = [...actual];
  const missing: string[] = [];
  for (const want of expected) {
    const at = remaining.indexOf(want);
    if (at === -1) missing.push(want);
    else remaining.splice(at, 1);
  }
  return { missing, extra: remaining };
}

/**
 * The three criteria that come from the checker's verdict rather than from our
 * own reading.
 *
 * Named explicitly rather than matched on a `PDF/UA` prefix. The prefix was a
 * proxy for "the checker said this", and it stopped being one the moment our
 * own instrument gained an item labelled `PDF/UA 7.11` — the attached-documents
 * item, which is ours, and which a prefix test would have quietly excluded from
 * the exact-needs comparison it is supposed to be held to.
 */
const CHECKER_DERIVED = new Set(['PDF/UA 7.21.4', 'PDF/UA 7.1-3', 'PDF/UA']);

/** Our own vocabulary's criteria; the checker's items are held to a property. */
const ourCriteria = (needs: DeliverySummary['needs']) =>
  (needs ?? []).map((n) => n.criterion).filter((c) => !CHECKER_DERIVED.has(c));

const clauseCriteria = (needs: DeliverySummary['needs']) =>
  (needs ?? []).filter((n) => CHECKER_DERIVED.has(n.criterion));

/**
 * Every failing clause must be voiced somewhere.
 *
 * This is the promise, checked as a property rather than as a list: a clause
 * is accounted for if a named family item covers it, if the catch-all names it
 * outright, or if it is one our own vocabulary suppresses because our items
 * say the same thing. Anything else reached the client as silence.
 */
function unvoicedClauses(summary: DeliverySummary): { silent: string[]; suppressedButQuiet: string[] } {
  const conformance = summary.conformance;
  if (!conformance || conformance.checker !== 'verapdf-ua1' || conformance.compliant) {
    return { silent: [], suppressedButQuiet: [] };
  }

  const items = clauseCriteria(summary.needs);
  const catchAllText = items.map((i) => i.item).join(' ');
  const families = new Set(items.map((i) => i.criterion));
  const voicesAnything = (summary.needs ?? []).length > 0 || summary.gaps.length > 0;

  const silent: string[] = [];
  const suppressedButQuiet: string[] = [];

  for (const clause of conformance.failingClauses) {
    if (clause.startsWith('7.21.4') && families.has('PDF/UA 7.21.4')) continue;
    if (clause.startsWith('7.1-3') && families.has('PDF/UA 7.1-3')) continue;
    if (catchAllText.includes(clause)) continue;
    if (SUPPRESSED.test(clause)) {
      // Suppressed means "one of our own items says this". If the document
      // voices nothing at all, nothing is saying it, and the suppression has
      // hidden a real failure rather than deduplicated one.
      if (!voicesAnything) suppressedButQuiet.push(clause);
      continue;
    }
    silent.push(clause);
  }
  return { silent, suppressedButQuiet };
}

export function scoreDocument(
  key: DocKey,
  result: RunResult,
  corrections: Correction[] = [],
): { findings: Finding[]; corrected: boolean; disposition: Disposition } {
  const findings: Finding[] = [];
  const applied = corrections.filter((c) => c.docId === key.id);
  const expected = { ...key.expected };
  for (const correction of applied) {
    (expected as Record<string, unknown>)[correction.field] = correction.now;
  }

  const push = (facet: string, outcome: string, detail: string, fatal: boolean) =>
    findings.push({ id: key.id, facet, outcome, detail, fatal, weight: key.weight });

  if (result.transportError !== undefined) {
    push('transport', 'no-answer', result.transportError, true);
    return { findings, corrected: applied.length > 0, disposition: 'door' };
  }

  const disposition = observedDisposition(result);

  // ------------------------------------------------------------ the door
  if (key.kind === 'door') {
    const allowed = expected.statusOneOf ?? (expected.status === undefined ? [] : [expected.status]);
    if (!allowed.includes(result.status)) {
      const leaked = result.status === 200 && !allowed.includes(200);
      push('door', leaked ? 'door-leaked' : 'door-wrong-status',
        `expected ${allowed.join(' or ')}, answered ${result.status}`, key.weight === 'core');
    } else {
      push('door', 'door-hit', String(result.status), false);
    }
    return { findings, corrected: applied.length > 0, disposition };
  }

  // ----------------------------------------------------- the disposition
  const wanted = expected.dispositionOneOf ?? (expected.disposition ? [expected.disposition] : []);
  if (wanted.length > 0 && !wanted.includes(disposition)) {
    const refusedDifferently = disposition.startsWith('refused') && wanted.some((w) => w.startsWith('refused'));
    const outcome = refusedDifferently
      ? 'refused-differently'
      : disposition === 'delivered'
        ? 'delivered-when-refusal-expected'
        : 'refused-when-delivery-expected';
    push('disposition', outcome, `expected ${wanted.join(' or ')}, got ${disposition}`, key.weight === 'core');
  } else if (wanted.length > 0) {
    push('disposition', 'hit', disposition, false);
  }

  // A refusal that must never be a delivery is a promise regardless of weight:
  // delivering an encrypted or page-less document is not a probe surprise.
  if (expected.mustNotDeliver === true && disposition === 'delivered') {
    push('disposition', 'delivered-when-refusal-expected', 'the key forbids a delivery for this document', true);
  }

  if (disposition !== 'delivered') return { findings, corrected: applied.length > 0, disposition };

  const summary = result.summary;
  if (!summary) {
    push('transport', 'no-summary', 'a 200 with no remediation summary header', true);
    return { findings, corrected: applied.length > 0, disposition };
  }

  // -------------------------------------------------------- invented claims
  //
  // The cardinal sin, and the reason this product exists in the shape it does.
  // Never folded into a rate.
  if (expected.titleText === null && summary.titleText !== undefined) {
    push('invented-claim', 'invented-title', `claims a title where the key plants none: ${JSON.stringify(summary.titleText)}`, true);
  }
  if (typeof expected.titleText === 'string' && summary.titleText !== expected.titleText) {
    // A title that differs from the key is a WRONG title, not an invented
    // one, and the difference is the whole point of the facet: p04 carries
    // an exporter's leftover as its title, and reporting that faithfully is
    // transcription doing its job even where the key wanted the heading.
    // Filing it under invented claims put a 1 beside the line that must read
    // zero, which is the one number nobody should have to interpret.
    push('claim', 'wrong-title', `expected ${JSON.stringify(expected.titleText)}, got ${JSON.stringify(summary.titleText)}`, key.weight === 'core');
  }
  if (expected.titleDeclared === false && summary.title === 'already-titled') {
    push('invented-claim', 'invented-title', 'reports an existing title in a document that declares none', true);
  }
  for (const forbidden of key.mustNotClaim ?? []) {
    if (summary.titleText === forbidden) {
      push('invented-claim', 'superseded-claim', `states ${JSON.stringify(forbidden)}, which the document no longer says`, true);
    }
  }
  if (expected.language === null && summary.sourceLanguage !== null) {
    push('invented-claim', 'invented-language', `claims ${JSON.stringify(summary.sourceLanguage)} where the document declares none`, true);
  }
  if (typeof expected.language === 'string' && summary.sourceLanguage !== expected.language) {
    push('claim', 'wrong-language', `expected ${JSON.stringify(expected.language)}, got ${JSON.stringify(summary.sourceLanguage)}`, key.weight === 'core');
  }

  if (expected.title !== undefined && summary.title !== expected.title) {
    push('claim', 'wrong-title-provenance', `expected ${expected.title}, got ${summary.title}`, key.weight === 'core');
  }

  // ---------------------------------------------------------------- counts
  if (expected.counts) {
    for (const facet of ['pages', 'headings', 'tables', 'lists', 'figures'] as const) {
      const want = expected.counts[facet];
      if (want === undefined) continue;
      if (want === null) {
        push('counts', 'unverifiable', `${facet} could not be read by a third-party instrument`, false);
        continue;
      }
      const got = summary[facet];
      if (got === want) continue;
      // More structure than the document contains is a claim about structure
      // that is not there, which is the invented-claim family, not a miscount.
      const invented = got > want;
      push(invented ? 'invented-claim' : 'counts', invented ? 'invented-structure' : 'counts-off',
        `${facet}: key ${want}, reported ${got}`, invented || key.weight === 'core');
    }
  }

  // ----------------------------------------------------------- punch items
  if (expected.needs) {
    const actual = ourCriteria(summary.needs);
    const { missing, extra } = multisetDiff(expected.needs, actual);
    for (const criterion of missing) {
      push('punch', 'punch-missing', `nothing voices ${criterion}`, key.weight === 'core');
    }
    if (expected.needsExact !== false) {
      for (const criterion of extra) {
        push('punch', 'punch-unexpected', `voices ${criterion}, which the key did not predict`, false);
      }
    }
  }
  if (expected.gapCriteria) {
    const actual = summary.gaps.map((g) => g.split(':')[0]);
    const { missing, extra } = multisetDiff(expected.gapCriteria, actual);
    for (const criterion of missing) push('gap', 'gap-missing', `no gap for ${criterion}`, key.weight === 'core');
    for (const criterion of extra) push('gap', 'gap-unexpected', `gap for ${criterion}`, false);
  }

  // ------------------------------------------------------------ conformance
  const conformance = summary.conformance;
  if (!conformance) {
    push('conformance', 'absent', 'the delivery carries no conformance verdict at all', true);
  } else if (conformance.checker === 'none') {
    // Honest, but it means this run measured nothing about conformance.
    push('conformance', 'not-checked', conformance.reason, false);
  } else {
    const want = expected.conformance;
    if (want && want !== 'any') {
      if (want.compliant === true && !conformance.compliant) {
        push('conformance', 'not-compliant', 'the key expects a compliant document', key.weight === 'core');
      }
      if (want.compliant === false && conformance.compliant) {
        push('conformance', 'unexpectedly-compliant', 'the key expects failing clauses', false);
      }
      for (const family of (want.compliant === false ? want.mustVoice ?? [] : [])) {
        const voiced = clauseCriteria(summary.needs).some((n) => n.criterion === `PDF/UA ${family}`);
        if (!voiced) {
          push('punch', 'punch-missing', `nothing voices the ${family} family, which repair cannot fix`, key.weight === 'core');
        }
      }
    }

    // The promise: no clause reaches a client as silence.
    const { silent, suppressedButQuiet } = unvoicedClauses(summary);
    for (const clause of silent) {
      push('silent-gap', 'silent-clause', `${clause} fails and nothing says so`, true);
    }
    for (const clause of suppressedButQuiet) {
      push('silent-gap', 'suppressed-but-quiet',
        `${clause} is suppressed as already-voiced, and this document voices nothing`, false);
    }

    // ------------------------------------------------------------- drift
    const independent = result.independent;
    if (independent?.checked === true) {
      if (independent.compliant !== conformance.compliant) {
        push('drift', 'verdict-drift',
          `product says compliant=${conformance.compliant}, an independent check says ${independent.compliant}`, true);
      } else if (!conformance.compliant) {
        const productClauses = JSON.stringify([...conformance.failingClauses].sort());
        const theirs = JSON.stringify([...(independent.clauses ?? [])].sort());
        if (productClauses !== theirs) {
          push('drift', 'clause-drift', 'the two readings of the same bytes list different clauses', true);
        }
      }
    }
  }

  return { findings, corrected: applied.length > 0, disposition };
}

export type Score = {
  findings: Finding[];
  byId: Record<string, { disposition: Disposition; fatal: number; corrected: boolean }>;
  corrections: number;
};

export function scoreRun(
  keys: DocKey[],
  results: Record<string, RunResult>,
  corrections: Correction[] = [],
): Score {
  const findings: Finding[] = [];
  const byId: Score['byId'] = {};

  for (const key of keys) {
    const result = results[key.id];
    if (!result) {
      findings.push({
        id: key.id, facet: 'transport', outcome: 'not-run',
        detail: 'the corpus holds this document and the run has no result for it',
        fatal: true, weight: key.weight,
      });
      byId[key.id] = { disposition: 'door', fatal: 1, corrected: false };
      continue;
    }
    const scored = scoreDocument(key, result, corrections);
    findings.push(...scored.findings);
    byId[key.id] = {
      disposition: scored.disposition,
      fatal: scored.findings.filter((f) => f.fatal).length,
      corrected: scored.corrected,
    };
  }

  return { findings, byId, corrections: corrections.length };
}

const count = (findings: Finding[], outcome: string) => findings.filter((f) => f.outcome === outcome).length;

/**
 * The summary lines.
 *
 * Two populations that are never added: documents (a disposition each) and
 * punch items (many per document). Mixing them is the arithmetic the website
 * scorer had to unlearn.
 */
export function renderScore(score: Score, keys: DocKey[], previous?: Score): string[] {
  const lines: string[] = [];
  const core = score.findings.filter((f) => f.weight === 'core');
  const probe = score.findings.filter((f) => f.weight === 'probe');

  const doorKeys = keys.filter((k) => k.kind === 'door');
  const docKeys = keys.filter((k) => k.kind !== 'door');

  const dispositionHits = core.filter((f) => f.facet === 'disposition' && f.outcome === 'hit').length;
  const dispositionCore = docKeys.filter((k) => k.weight === 'core').length;

  lines.push(`Disposition   core ${dispositionHits}/${dispositionCore} hit`
    + ` · ${count(core, 'refused-differently')} refused differently`
    + ` · ${count(core, 'delivered-when-refusal-expected')} delivered when a refusal was expected`
    + ` · ${count(core, 'refused-when-delivery-expected')} refused when a delivery was expected`);

  lines.push(`Door          ${count(score.findings, 'door-hit')}/${doorKeys.length}`
    + ` · ${count(score.findings, 'door-leaked')} leaked · ${count(score.findings, 'door-wrong-status')} wrong status`);

  lines.push(`Punch items   ${count(score.findings, 'punch-missing')} missing`
    + ` · ${count(score.findings, 'punch-unexpected')} unexpected (listed; a person decides)`);

  lines.push(`Invented claims  ${score.findings.filter((f) => f.facet === 'invented-claim').length}`
    + '        ← must be zero; never merged with any rate');
  lines.push(`Silent gaps   ${count(score.findings, 'silent-clause')}`
    + ` · ${count(score.findings, 'suppressed-but-quiet')} suppressed with nothing voicing them`);
  lines.push(`Drift         ${count(score.findings, 'verdict-drift') + count(score.findings, 'clause-drift')}`);
  lines.push(`Counts        ${count(score.findings, 'counts-off')} off`
    + ` · ${count(score.findings, 'unverifiable')} unverifiable`);
  lines.push(`Conformance   ${count(score.findings, 'not-checked')} not checked`
    + ` · ${count(score.findings, 'not-compliant')} short of a compliant key`);
  lines.push(`Probes        ${probe.length} observations across ${keys.filter((k) => k.weight === 'probe').length} rows (data, not failures)`);
  lines.push(`Key corrections this run: ${score.corrections}`);

  if (previous) {
    const wasFatal = new Set(Object.entries(previous.byId).filter(([, v]) => v.fatal > 0).map(([id]) => id));
    const isFatal = new Set(Object.entries(score.byId).filter(([, v]) => v.fatal > 0).map(([id]) => id));
    const fixed = [...wasFatal].filter((id) => !isFatal.has(id));
    const regressed = [...isFatal].filter((id) => !wasFatal.has(id));
    const still = [...isFatal].filter((id) => wasFatal.has(id));
    lines.push(`vs previous run: ${fixed.length} fixed · ${regressed.length} regressed · ${still.length} still failing`);
    if (regressed.length > 0) lines.push(`  regressed: ${regressed.join(', ')}`);
  }

  return lines;
}

/** Exit zero means every promise held. Probe surprises never fail a run. */
export function exitCode(score: Score): number {
  return score.findings.some((f) => f.fatal) ? 1 : 0;
}
