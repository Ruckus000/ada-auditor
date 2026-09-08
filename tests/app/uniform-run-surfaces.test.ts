import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EvidenceStatus } from '../../src/domain/evidence';
import type { StoredFinding, StoredRunPage, StoredRunRecord } from '../../src/domain/persistence';
import { MemoryPlatformStore } from '../../src/integrations/persistence/memory-platform-store';
import { MemoryRunStore } from '../../src/integrations/persistence/memory-run-store';
import { buildClientDetail, type ClientDetail } from '../../src/services/client-detail';
import { buildFindingsView } from '../../src/services/findings-view';
import { buildPortfolio } from '../../src/services/portfolio';
import { severityCounts } from '../../src/services/presentation/severity';
import type { VerdictKind } from '../../src/services/presentation/verdict';
import { renderRunReport } from '../../src/services/report-html';
import { buildSharedReport } from '../../src/services/report-view';
import {
  failsConformance,
  GATE_VERSION,
  summarizeRun,
  type AuditFinding,
} from '../../src/services/reporting';
import {
  countBySource,
  parseAuditResponse,
  type AuditResult,
} from '../../src/app/components/audit-types';
import { FindingsList } from '../../src/app/components/findings-list';
import { VerdictPanel } from '../../src/app/components/verdict-panel';
import { VERDICT_CHIP } from '../../src/app/platform/lib/verdict-chip';
import { SharedReportPage } from '../../src/app/r/[token]/shared-report';

/**
 * One run, every surface, one number.
 *
 * The product renders a stored run on six surfaces: the printable client
 * report, the public share page, the operator's findings screen, the client
 * overview (and the setup wizard's results stage, which shows the same
 * tiles), the portfolio row, and the console. A branch under review gave two
 * of them a different definition of "confirmed issues" — impact-derived
 * (`critical`) on some, gate-derived (`failsConformance`: deterministic, not
 * needs-review, Level A/AA) on others — so a client page could say **0**
 * beside a list of criteria the same run failed.
 *
 * This is the incident `AGENTS.md` records under "Every surface goes through
 * `runVerdict`, including the client's report": `report-html.ts` once keyed
 * its copy on `ciStatus`, which `risk` cannot reach, so a run with unresolved
 * findings read "No blocking issues found" on the document a client's counsel
 * reads while every operator screen said `risk`. Two definitions of one rule,
 * and the softer one was on the copy that mattered. The number beside "Must
 * fix" is the same shape of defect one step further down the page.
 *
 * So every assertion here is made against the **rendered markup**, not the
 * view-model — a count that is right in `RunSummary` and rendered from
 * somewhere else is the exact failure this exists to catch. The fixture is
 * built to separate the two definitions: the one finding that fails
 * conformance is `minor`, the one `critical` finding cites no criterion, and
 * the `needs-review` finding carries a criterion it must not be counted
 * against.
 */

vi.mock('next/navigation', () => ({
  // The server renderer has no app router mounted. Only the hooks are
  // replaced; every component's own markup is the real one.
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => '/clients/acme',
}));

const { ClientFindings } = await import(
  '../../src/app/platform/components/client/client-findings'
);
const { ClientOverview } = await import(
  '../../src/app/platform/components/client/client-overview'
);
const { ClientShell } = await import('../../src/app/platform/components/client/client-shell');
/**
 * `createElement`'s typed form wants `children` inside `props`, and
 * `react/no-children-prop` wants it as the third argument; the shell declares
 * `children` required, so neither form satisfies both. Widened to its other
 * props here only, so the child can be passed the way React asks.
 */
const Shell = ClientShell as ComponentType<{ detail: ClientDetail }>;
const { ResultsStage } = await import('../../src/app/platform/components/setup/results-stage');
const { PortfolioScreen } = await import('../../src/app/platform/components/portfolio');

const CLIENT_ID = 'acme';
const JOURNEY_ID = 'checkout';
const TOKEN = 'share-token-uniform';
const PAGE_URL = 'https://acme.test/checkout';

const PAGE: StoredRunPage = {
  url: PAGE_URL,
  route: '/checkout',
  title: 'Checkout',
  evidenceStatus: 'complete',
  statusCode: 200,
};

/** What `uploadPages` hands the console for a page whose capture succeeded. */
const ARTIFACTS = {
  screenshotUrl: 'https://blob.test/checkout.png',
  domSnapshotUrl: 'https://blob.test/checkout.html',
  axTreeUrl: 'https://blob.test/checkout.json',
};

/**
 * Fails conformance: Level AA, a real criterion, deterministic, decided. The
 * only finding here that does — and it is `minor`, so an impact-keyed count
 * answers 0 for it.
 */
const META_VIEWPORT: StoredFinding = {
  code: 'meta-viewport',
  severity: 'minor',
  source: 'deterministic',
  message: 'The viewport meta disables zoom.',
  conformanceLevel: 'AA',
  wcagCriteria: ['1.4.4'],
  remediationAnyOf: ['Remove user-scalable=no'],
  remediationAllOf: [],
  pageUrl: PAGE_URL,
  selector: 'meta[name="viewport"]',
};

/** A best-practice rule: `critical` impact, no criterion, so it gates nothing. */
const REGION: StoredFinding = {
  code: 'region',
  severity: 'critical',
  source: 'deterministic',
  conformanceLevel: null,
  wcagCriteria: [],
  pageUrl: PAGE_URL,
  selector: 'body > div',
};

/**
 * The human-review queue. It carries a Level AA criterion because
 * `runDeterministicAudit` maps `incomplete` results through the same mapper
 * as violations — and a count that keyed on the level alone would turn the
 * queue into a conformance failure.
 */
const COLOR_CONTRAST: StoredFinding = {
  code: 'color-contrast',
  severity: 'needs-review',
  source: 'deterministic',
  conformanceLevel: 'AA',
  wcagCriteria: ['1.4.3'],
  remediationAnyOf: ['Use a darker foreground'],
  remediationAllOf: ['Ensure a background colour is set'],
  pageUrl: PAGE_URL,
  selector: '.price',
};

/** `gateable: false`, always. A judgement, not a proof. */
const ADVISORY: StoredFinding = {
  code: 'ai-advisory',
  severity: 'advisory',
  source: 'ai-advisory',
  message: 'Heading used for size',
  confidence: 0.8,
  gateable: false,
};

/**
 * A row written before the `conformance_level` column existed:
 * `conformanceLevel` is `undefined`, not `null`, and a gate that tested
 * `=== null` would read that as "has a level".
 */
const LEGACY_RULE: StoredFinding = {
  code: 'legacy-rule',
  severity: 'major',
  source: 'deterministic',
  wcagCriteria: [],
  pageUrl: PAGE_URL,
  selector: '#legacy',
};

const FINDINGS: StoredFinding[] = [META_VIEWPORT, REGION, COLOR_CONTRAST, ADVISORY, LEGACY_RULE];

/**
 * The gate, run over the stored findings.
 *
 * `summarizeRun` is typed to the engine's finding, and the stored finding is
 * the subset of it that survives the database: the gate reads `source`,
 * `severity` and `conformanceLevel`, and all three persist. The cast is the
 * one place this file bridges the two shapes, and it exists so `ciStatus` and
 * `gateVersion` on a record are what the gate said rather than what a fixture
 * typed. (`LEGACY_RULE` cannot be expressed as an engine finding at all — its
 * level is `undefined` — which is the point of it.)
 */
function gate(findings: StoredFinding[], evidenceStatus: EvidenceStatus) {
  return summarizeRun({
    findings: findings as unknown as AuditFinding[],
    evidenceStatus,
    pagesScanned: 1,
  });
}

function record(input: {
  requestId: string;
  findings: StoredFinding[];
  evidenceStatus: EvidenceStatus;
}): { record: StoredRunRecord; gate: ReturnType<typeof summarizeRun> } {
  const verdict = gate(input.findings, input.evidenceStatus);

  return {
    gate: verdict,
    record: {
      requestId: input.requestId,
      journeyId: JOURNEY_ID,
      environment: 'staging',
      platform: 'generic',
      evidenceStatus: input.evidenceStatus,
      ciStatus: verdict.ciStatus,
      gateVersion: verdict.gateVersion,
      findings: input.findings,
      durationMs: 4200,
      createdAt: '2026-09-01T09:00:00.000Z',
      status: 'complete',
      // Evidence is per page and the run takes the worst; with one page the
      // two are the same fact.
      pages: [{ ...PAGE, evidenceStatus: input.evidenceStatus }],
    },
  };
}

/**
 * A client, the journey the run belongs to, the run, and a report issued
 * against it — the chain every builder walks. Fresh stores per call, so no
 * block reads another's record.
 */
async function seed(run: StoredRunRecord) {
  const platform = new MemoryPlatformStore();
  const runs = new MemoryRunStore();

  await platform.upsertClient({ id: CLIENT_ID, name: 'Acme' });
  await platform.upsertJourney({
    id: JOURNEY_ID,
    clientId: CLIENT_ID,
    name: 'Checkout',
    targetUrl: 'https://acme.test/',
    steps: [{ action: 'goto' }],
  });
  await runs.saveRun(run);
  await platform.createReport({
    id: 'report-1',
    requestId: run.requestId,
    shareToken: TOKEN,
    title: 'Acme accessibility audit',
  });

  return { platform, runs };
}

/**
 * The body `POST /api/audit/console` answers with, per `audit-run-handler`:
 * the engine's findings whole — `conformanceLevel` and `wcagCriteria`
 * included — beside the gate's own summary. The fields the console parser
 * reads are named the same on the stored and the engine shape, which is why
 * the stored findings can stand in here.
 */
function consoleResponse(run: StoredRunRecord, verdict: ReturnType<typeof summarizeRun>) {
  return {
    requestId: run.requestId,
    journeyId: run.journeyId,
    environment: run.environment,
    platform: run.platform,
    evidenceStatus: run.evidenceStatus,
    ciStatus: run.ciStatus,
    executionStatus: verdict.executionStatus,
    findings: run.findings,
    executiveSummary: verdict.executiveSummary,
    durationMs: run.durationMs,
    browserMode: true,
    status: 'complete',
    pages: (run.pages ?? []).map((page) => ({ ...page, artifacts: ARTIFACTS })),
    score: null,
  };
}

type Rendered = {
  /** `renderRunReport` — the document a client's counsel reads. */
  printable: string;
  /** `SharedReportPage` over `buildSharedReport` — the public link. */
  shared: string;
  sharedVerdict: VerdictKind;
  /** `ClientFindings` over `buildFindingsView` — the operator's list. */
  findings: string;
  findingsVerdict: VerdictKind;
  /** `ClientShell` around `ClientOverview` over `buildClientDetail`. */
  overview: string;
  /** `ResultsStage` over the same detail — the wizard's last screen. */
  results: string;
  /** `PortfolioScreen` over `buildPortfolio`. */
  portfolio: string;
  /**
   * `VerdictPanel` and `FindingsList` over `parseAuditResponse`. Null when a
   * block has no console: the console renders a response the handler just
   * produced, which carries `GATE_VERSION` by construction, so a record from
   * an older gate can never reach it.
   */
  console: { html: string; result: AuditResult } | null;
};

async function renderSurfaces(
  run: StoredRunRecord,
  verdict: ReturnType<typeof summarizeRun> | null,
): Promise<Rendered> {
  const { platform, runs } = await seed(run);

  const shared = await buildSharedReport(TOKEN, {
    reports: platform,
    runs,
    clients: platform,
    journeys: platform,
  });
  const view = await buildFindingsView(CLIENT_ID, {
    clients: platform,
    journeys: platform,
    triage: platform,
    runs,
  });
  const detail = await buildClientDetail(CLIENT_ID, {
    clients: platform,
    journeys: platform,
    credentials: platform,
    runs,
  });
  const rows = await buildPortfolio({ clients: platform, journeys: platform, runs });

  if (!shared || !view || !detail) {
    throw new Error('the seeded client must build on every surface');
  }

  const result = verdict
    ? parseAuditResponse(consoleResponse(run, verdict), 200, true, false)
    : null;

  return {
    printable: renderRunReport(run),
    shared: renderToStaticMarkup(createElement(SharedReportPage, { report: shared, token: TOKEN })),
    sharedVerdict: shared.run.verdict,
    findings: renderToStaticMarkup(createElement(ClientFindings, { view })),
    findingsVerdict: view.run?.verdict ?? 'scan',
    overview: renderToStaticMarkup(
      createElement(Shell, { detail }, createElement(ClientOverview, { detail })),
    ),
    results: renderToStaticMarkup(createElement(ResultsStage, { detail })),
    portfolio: renderToStaticMarkup(createElement(PortfolioScreen, { clients: rows })),
    console: result
      ? {
          result,
          html:
            renderToStaticMarkup(createElement(VerdictPanel, { result })) +
            renderToStaticMarkup(createElement(FindingsList, { result })),
        }
      : null,
  };
}

/** Build once per block, on first use. */
function once<T>(build: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= build());
}

/* ------------------------------------------------------------ readers --- */

/**
 * The value in the tile labelled `label`.
 *
 * Every platform screen and the shared page render a stat as a `<dt>`/`<dd>`
 * pair with the label upper-cased, so this reads the number the way a person
 * does: by the label beside it, not by its position.
 */
function tile(html: string, label: string, surface: string): string {
  const match = html.match(new RegExp(`${label.toUpperCase()}</dt><dd[^>]*>([^<]*)</dd>`));
  if (!match) throw new Error(`${surface} has no tile labelled "${label}"`);
  return match[1];
}

/**
 * The portfolio's number, from the row's accessible name — the one place that
 * screen says it in words (`"Acme — fail, 1 must fix"`). The visible cell is
 * the same variable rendered without a label.
 */
function portfolioMustFix(html: string): string {
  const match = html.match(/aria-label="[^"]*?([^\s,"]+) must fix/);
  if (!match) throw new Error('the portfolio row names no must-fix count');
  return match[1];
}

/** The findings screen's summary line: `4 across 1 page — 1 must fix, …`. */
function findingsMustFix(html: string): string {
  const match = html.match(/ — (\S+) must fix,/);
  if (!match) throw new Error('the findings screen has no summary line');
  return match[1];
}

/** `<strong>N</strong> blocking` on the printable report, or null when the line is absent. */
function printableBlocking(html: string): string | null {
  const match = html.match(/<strong>([^<]*)<\/strong> blocking/);
  return match ? match[1] : null;
}

/** The section headed "Success criteria not met", or '' when the page has none. */
function criteriaSection(html: string): string {
  const start = html.indexOf('Success criteria not met');
  if (start === -1) return '';
  return html.slice(start, html.indexOf('</section>', start));
}

/** One console card, found by the rule code it prints. */
function consoleCard(html: string, code: string): string {
  const card = html
    .split('<li class="finding ')
    .slice(1)
    .find((one) => one.includes(`>${code}</code>`) || one.includes(`>${code}</p>`));
  if (!card) throw new Error(`the console has no card for ${code}`);
  return card;
}

/** The kind behind `<section class="verdict …">` on the printable report. */
function printableVerdict(html: string): VerdictKind {
  const match = html.match(/<section class="verdict (\w+)">/);
  if (!match) throw new Error('the printable report has no verdict section');
  return match[1] as VerdictKind;
}

/** Which of the platform's chips a screen shows — exactly one, or it is not saying a verdict. */
function pillVerdict(html: string, surface: string): VerdictKind {
  const shown = (Object.keys(VERDICT_CHIP) as VerdictKind[]).filter((kind) =>
    html.includes(VERDICT_CHIP[kind].label),
  );
  expect(shown, `${surface} shows one verdict chip`).toHaveLength(1);
  return shown[0];
}

/** The console panel's word, lower-cased so it compares with a `VerdictKind`. */
function consoleVerdict(html: string): string {
  const match = html.match(/class="verdict-word">([^<]*)</);
  if (!match) throw new Error('the console panel has no verdict word');
  return match[1].toLowerCase();
}

/**
 * The verdict each surface says, in one vocabulary.
 *
 * The share page and the findings screen carry `run.verdict` without
 * rendering a word for it, so theirs is read from the `RunSummary` they were
 * handed — the value they would print if they did.
 */
function verdictsOf(s: Rendered): Record<string, string> {
  return {
    printable: printableVerdict(s.printable),
    shared: s.sharedVerdict,
    findings: s.findingsVerdict,
    overview: pillVerdict(s.overview, 'the client bar'),
    portfolio: pillVerdict(s.portfolio, 'the portfolio'),
    ...(s.console ? { console: consoleVerdict(s.console.html) } : {}),
  };
}

/** The value beside "Must fix" on each stored surface; the console is read separately. */
function mustFixOf(s: Rendered): Record<string, string | null> {
  return {
    printable: printableBlocking(s.printable),
    shared: tile(s.shared, 'Must fix', 'the share page'),
    findings: findingsMustFix(s.findings),
    overview: tile(s.overview, 'Must fix', 'the client overview'),
    results: tile(s.results, 'Must fix', 'the results stage'),
    portfolio: portfolioMustFix(s.portfolio),
  };
}

function expectAllEqual(values: Record<string, string | null>, what: string) {
  const [reference] = Object.values(values);
  for (const [surface, value] of Object.entries(values)) {
    expect(value, `${what}: ${surface} says ${value}; the first surface says ${reference}`).toBe(
      reference,
    );
  }
}

/** The three spellings of "nothing to fix" that a surface must not produce for this run. */
function expectNoZero(html: string, surface: string) {
  for (const pattern of [
    /\b0 must fix/i,
    /MUST FIX<\/dt><dd[^>]*>0</,
    /<strong>0<\/strong> blocking/,
  ]) {
    expect(html, `${surface} says zero`).not.toMatch(pattern);
  }
}

/* -------------------------------------------------------------- cases --- */

describe('one failing run, on every surface', () => {
  const FAILING = record({ requestId: 'run-fail', findings: FINDINGS, evidenceStatus: 'complete' });
  const surfaces = once(() => renderSurfaces(FAILING.record, FAILING.gate));

  it('is a fail by the gate, on one confirmed finding', () => {
    // The precondition, stated so a change to the gate reads as one rather
    // than as six surfaces going wrong at once.
    expect(FAILING.gate.ciStatus).toBe('fail');
    expect(FAILING.gate.executiveSummary.blockingFindings).toBe(1);
    expect(FAILING.record.gateVersion).toBe(GATE_VERSION);
  });

  it('says 1 beside "Must fix" on every surface', async () => {
    const s = await surfaces();

    expect(mustFixOf(s)).toEqual({
      printable: '1',
      shared: '1',
      findings: '1',
      overview: '1',
      results: '1',
      portfolio: '1',
    });

    // The console has no tile; its number is the count the panel's sentence
    // is built from, and the sentence itself.
    expect(countBySource(s.console!.result.findings).blocking).toHaveLength(1);
    expect(s.console!.html).toContain('Fix the 1 issue marked');

    for (const [surface, html] of Object.entries({
      printable: s.printable,
      shared: s.shared,
      findings: s.findings,
      overview: s.overview,
      results: s.results,
      portfolio: s.portfolio,
      console: s.console!.html,
    })) {
      expectNoZero(html, surface);
    }
  });

  it('says FAIL on every surface', async () => {
    const s = await surfaces();

    expect(verdictsOf(s)).toEqual({
      printable: 'fail',
      shared: 'fail',
      findings: 'fail',
      overview: 'fail',
      portfolio: 'fail',
      console: 'fail',
    });
    // The words themselves, from each surface's own copy.
    expect(s.printable).toContain('Does not conform');
    expect(s.overview).toContain(VERDICT_CHIP.fail.label);
    expect(s.portfolio).toContain(VERDICT_CHIP.fail.label);
    expect(s.console!.html).toContain('class="verdict-word">Fail<');
  });

  it('claims 1.4.4 on the share page and not 1.4.3', async () => {
    // "Success criteria not met" is the conformance claim a client's counsel
    // reads. The needs-review finding cites 1.4.3, and axe could not decide
    // it — so listing it there would assert a failure nobody observed, beside
    // a "Must fix" that counts it as nothing.
    const s = await surfaces();
    const claimed = criteriaSection(s.shared);

    expect(claimed).toContain('1.4.4');
    expect(claimed).not.toContain('1.4.3');
  });

  it('flags the console card by the criterion, not the impact', async () => {
    const s = await surfaces();

    expect(consoleCard(s.console!.html, 'meta-viewport')).toContain('Blocks release');
    expect(consoleCard(s.console!.html, 'region')).toContain('Does not block release');
  });

  it('prints both remediation lines for color-contrast wherever it is listed', async () => {
    // "Any one of these" and "all of these" are different instructions, and
    // the second list is the one a surface drops when it flattens them.
    const s = await surfaces();

    for (const html of [s.shared, s.printable, s.findings]) {
      expect(html).toContain('Use a darker foreground');
      expect(html).toContain('Ensure a background colour is set');
    }
  });

  it('shows the advisory finding to the operator and withholds it from the printable report', async () => {
    const s = await surfaces();

    expect(s.findings).toContain('Heading used for size');
    expect(s.console!.html).toContain('Heading used for size');
    // A model's judgement on the document a client's counsel reads is a
    // finding they cannot act on and a claim we cannot stand behind.
    expect(s.printable).not.toContain('Heading used for size');
  });

  it('reads every number from one seam', () => {
    // `severityCounts` is what every builder spreads into its summary, and
    // `failsConformance` is the rule it counts by. If a surface disagrees with
    // these, the surface is wrong; if these disagree with the gate, the seam
    // is.
    expect(severityCounts(FAILING.record)).toEqual({
      confirmed: 1,
      recommendations: 2,
      needsReview: 1,
    });

    expect(FINDINGS.filter(failsConformance).map((finding) => finding.code)).toEqual([
      'meta-viewport',
    ]);
  });
});

describe('a run recorded under an older gate', () => {
  // The same findings, with the verdict gate 1 wrote. Nothing here
  // reinterprets it: a `pass` from an impact-keyed gate is not a `pass` from
  // this one, and a number computed today beside a word decided then would
  // be two gates on one screen. The surfaces print no number — and they
  // agree with each other about the word, whatever it is.
  const OLD_GATE: StoredRunRecord = {
    ...record({ requestId: 'run-gate-1', findings: FINDINGS, evidenceStatus: 'complete' }).record,
    gateVersion: 1,
    ciStatus: 'pass',
  };
  const surfaces = once(() => renderSurfaces(OLD_GATE, null));

  it('prints an em dash beside "Must fix" on every surface', async () => {
    const s = await surfaces();

    expect(mustFixOf(s)).toEqual({
      // The printable report omits the line rather than printing a dash.
      printable: null,
      shared: '—',
      findings: '—',
      overview: '—',
      results: '—',
      portfolio: '—',
    });
  });

  it('says the same verdict word on every surface', async () => {
    const s = await surfaces();

    expectAllEqual(verdictsOf(s), 'verdict');
  });

  it('claims no criteria on the share page', async () => {
    // "Success criteria not met" is the count in words. Gate 1 decided by
    // impact and never named a criterion; a list computed by today's rule
    // beside the dash would be the recount the dash refuses.
    const s = await surfaces();

    expect(criteriaSection(s.shared)).toBe('');
  });
});

describe('a run whose evidence was incomplete', () => {
  const DEGRADED = record({
    requestId: 'run-degraded',
    findings: FINDINGS,
    evidenceStatus: 'degraded',
  });
  const surfaces = once(() => renderSurfaces(DEGRADED.record, DEGRADED.gate));

  it('is inconclusive by the gate, with nothing blocking', () => {
    // The gate's own decision: the first steady-state rule in AGENTS.md.
    // Incomplete evidence is never `pass` and never `fail`, and the surfaces
    // below must not print a number the gate refused to produce.
    expect(DEGRADED.gate.ciStatus).toBe('inconclusive');
    expect(DEGRADED.gate.executiveSummary.blockingFindings).toBe(0);
    expect(DEGRADED.record.gateVersion).toBe(GATE_VERSION);
  });

  it('prints an em dash beside "Must fix" on every surface', async () => {
    const s = await surfaces();

    expect(mustFixOf(s)).toEqual({
      printable: null,
      shared: '—',
      findings: '—',
      overview: '—',
      results: '—',
      portfolio: '—',
    });
    // Not "0 blocking" either: the gate did not count zero, it declined to
    // count. The verdict copy legitimately uses the word, so the assertion
    // is on the count line alone.
    expect(s.printable).not.toMatch(/<\/strong> blocking/);
  });

  it('says inconclusive on every surface, and offers nothing to fix', async () => {
    const s = await surfaces();

    expectAllEqual(verdictsOf(s), 'verdict');
    expect(verdictsOf(s).printable).toBe('inconclusive');
    expect(s.console!.html).not.toMatch(/Fix the \d+ issues? marked/);
  });

  it('claims no criteria on the share page', async () => {
    // The gate declined to judge; the page may not judge for it.
    const s = await surfaces();

    expect(criteriaSection(s.shared)).toBe('');
  });
});

describe('a critical best-practice finding under a passing gate', () => {
  // `region` alone: `critical` by impact, no criterion, so the gate passes
  // it. `runVerdict` then answers `pass` rather than `risk`, because the
  // `risk` rule in `presentation/verdict.ts` keys on `major` and
  // `needs-review` — it was written when `critical` could not survive a
  // passing gate. That is current behaviour, recorded here so the surfaces
  // keep agreeing about it; it is not an endorsement of the word.
  const PASSING = record({ requestId: 'run-region', findings: [REGION], evidenceStatus: 'complete' });
  const surfaces = once(() => renderSurfaces(PASSING.record, PASSING.gate));

  it('is a pass by the gate', () => {
    expect(PASSING.gate.ciStatus).toBe('pass');
  });

  it('says the same verdict word on every surface', async () => {
    const s = await surfaces();

    expectAllEqual(verdictsOf(s), 'verdict');
  });

  it('says the same number beside "Must fix" on every surface', async () => {
    const s = await surfaces();

    expectAllEqual(mustFixOf(s), 'must fix');
  });
});
