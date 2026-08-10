import type { RunStore, StoredFinding, StoredRunRecord } from '../domain/persistence';
import type { ClientStore, JourneyStore, TriageStore, TriageState } from '../domain/platform';
import {
  displaySeverity,
  findingDisplayStatus,
  type DisplaySeverity,
  type FindingDisplayStatus,
} from './presentation/severity';
import { findingKey } from './regression';
import { summariseRun, type RunSummary } from './client-detail';

/**
 * A client's findings, as the findings screen needs them.
 *
 * This is the screen the phase is judged on, so it is worth being explicit
 * about where its words come from. The title is the rule engine's own sentence
 * and the criterion names are quoted from the specification; neither is
 * authored here. What is still absent is the prototype's per-finding
 * explanation, code fix and effort estimate — hand-written for eight fictional
 * clients, and not replaced with hand-written ones for real clients.
 *
 * Findings are grouped by page because a run is a journey and a journey is
 * several pages: an operator fixes a page, not a run. Pages whose evidence was
 * incomplete are still listed, and say so — a page we could not see is not a
 * page that passed.
 */

export type FindingView = {
  /** `source:code:pageUrl:selector`, the same key triage and regression use. */
  key: string;
  code: string;
  /** What the rule checks, in the engine's words. Absent on older runs. */
  title?: string;
  message?: string;
  /**
   * How to fix it, in the engine's words.
   *
   * Two lists, because any **one** entry in `fixAnyOf` clears the finding
   * while every entry in `fixAllOf` has to be done. A screen that merged them
   * would tell a developer to add an alt attribute *and* an aria-label *and* a
   * presentation role, when any one of the three is the fix.
   */
  fixAnyOf: string[];
  fixAllOf: string[];
  severity: DisplaySeverity;
  wcagCriteria: string[];
  conformanceLevel?: string;
  selector?: string;
  htmlSnippet?: string;
  helpUrl?: string;
  source: string;
  /** False for advisory findings, which never gate a build. */
  gateable: boolean;
  status: FindingDisplayStatus;
  triage: TriageState | null;
  triageNote?: string;
};

export type PageFindings = {
  url: string;
  route: string;
  title?: string;
  evidenceStatus: string;
  findings: FindingView[];
};

export type FindingsView = {
  clientId: string;
  clientName: string;
  run: RunSummary | null;
  /** Journey the run walked, for the "which of their journeys is this" question. */
  journeyName: string | null;
  pages: PageFindings[];
  /**
   * Advisory findings, kept apart from the pages.
   *
   * They are produced once over the whole journey rather than per page, so
   * they have no `pageUrl` to file under — and they are `gateable: false`, so
   * mixing them into a page's list would put opinions beside measurements.
   */
  advisory: FindingView[];
  counts: Record<DisplaySeverity, number>;
};

const EMPTY_COUNTS: Record<DisplaySeverity, number> = {
  must: 0,
  should: 0,
  nice: 0,
  review: 0,
  advisory: 0,
};

export type FindingsDeps = {
  clients: ClientStore;
  journeys: JourneyStore;
  triage: TriageStore;
  runs: RunStore;
};

/** Null for a client that does not exist, so the route can answer 404. */
export async function buildFindingsView(
  clientId: string,
  deps: FindingsDeps,
): Promise<FindingsView | null> {
  const client = await deps.clients.getClient(clientId);
  if (!client) {
    return null;
  }

  const journeys = await deps.journeys.listJourneys(client.id);

  const latestPerJourney = await Promise.all(
    journeys.map(async (journey) => {
      const [run] = await deps.runs.list({ journeyId: journey.id, limit: 1 });
      return run ? ({ run, journey } as const) : null;
    }),
  );

  const newest = latestPerJourney
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => (a.run.createdAt < b.run.createdAt ? 1 : -1))[0];

  if (!newest) {
    return {
      clientId: client.id,
      clientName: client.name,
      run: null,
      journeyName: null,
      pages: [],
      advisory: [],
      counts: { ...EMPTY_COUNTS },
    };
  }

  const { run, journey } = newest;

  // The run before this one on the same journey, so a finding can be described
  // as new, still open or fixed rather than merely present.
  const baseline = await deps.runs.getLatestRun(journey.id, run.environment, run.requestId);
  const baselineKeys = new Set(
    (baseline?.findings ?? []).map((finding) => findingKey(finding)),
  );

  const triageByKey = new Map(
    (await deps.triage.listTriage(client.id)).map((entry) => [entry.findingKey, entry]),
  );

  const toView = (finding: StoredFinding): FindingView => {
    const key = findingKey(finding);
    const entry = triageByKey.get(key);

    return {
      key,
      code: finding.code,
      ...(finding.title === undefined ? {} : { title: finding.title }),
      ...(finding.message === undefined ? {} : { message: finding.message }),
      fixAnyOf: finding.remediationAnyOf ?? [],
      fixAllOf: finding.remediationAllOf ?? [],
      severity: displaySeverity(finding.severity),
      wcagCriteria: finding.wcagCriteria ?? [],
      ...(finding.conformanceLevel ? { conformanceLevel: finding.conformanceLevel } : {}),
      ...(finding.selector === undefined ? {} : { selector: finding.selector }),
      ...(finding.htmlSnippet === undefined ? {} : { htmlSnippet: finding.htmlSnippet }),
      ...(finding.helpUrl === undefined ? {} : { helpUrl: finding.helpUrl }),
      source: finding.source,
      gateable: finding.gateable !== false,
      status: findingDisplayStatus({
        inLatestRun: true,
        inBaseline: baselineKeys.has(key),
        triage: entry?.state ?? null,
      }),
      triage: entry?.state ?? null,
      ...(entry?.note === undefined ? {} : { triageNote: entry.note }),
    };
  };

  const deterministic = run.findings.filter((finding) => finding.source === 'deterministic');
  const advisory = run.findings.filter((finding) => finding.source !== 'deterministic');

  const byPage = new Map<string, FindingView[]>();
  for (const finding of deterministic) {
    const url = finding.pageUrl ?? '';
    const list = byPage.get(url) ?? [];
    list.push(toView(finding));
    byPage.set(url, list);
  }

  // Driven by the run's page list, not by the findings: a page with nothing
  // wrong on it is a result, and dropping it would make a partial audit look
  // like a thorough one.
  const pages: PageFindings[] = (run.pages ?? []).map((page) => ({
    url: page.url,
    route: page.route,
    ...(page.title === undefined ? {} : { title: page.title }),
    evidenceStatus: page.evidenceStatus,
    findings: sortBySeverity(byPage.get(page.url) ?? []),
  }));

  // Anything whose page is not in the run's page list — runs stored before
  // per-page evidence existed. Shown under their own heading rather than
  // dropped: a finding that has lost its page is still a barrier somebody hit.
  const known = new Set(pages.map((page) => page.url));
  for (const [url, findings] of byPage) {
    if (!known.has(url)) {
      pages.push({
        url,
        route: url || 'Unattributed',
        evidenceStatus: 'unknown',
        findings: sortBySeverity(findings),
      });
    }
  }

  const counts = { ...EMPTY_COUNTS };
  for (const page of pages) {
    for (const finding of page.findings) {
      counts[finding.severity] += 1;
    }
  }

  return {
    clientId: client.id,
    clientName: client.name,
    run: summariseRun(run),
    journeyName: journey.name,
    pages,
    advisory: advisory.map(toView),
    counts,
  };
}

const SEVERITY_ORDER: Record<DisplaySeverity, number> = {
  must: 0,
  should: 1,
  nice: 2,
  review: 3,
  advisory: 4,
};

function sortBySeverity(findings: FindingView[]): FindingView[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code),
  );
}
