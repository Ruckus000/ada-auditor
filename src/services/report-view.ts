import type { RunStore, StoredRunRecord } from '../domain/persistence';
import type { ClientStore, JourneyStore, ReportStore, StoredReport } from '../domain/platform';
import { summariseRun, type RunSummary } from './client-detail';

/**
 * Reports: a run, pinned, with a link somebody outside can open.
 *
 * The pinning is the whole point and the reason a report is a row rather than
 * a rendering. A link sent to a client's legal team must not change meaning
 * after tonight's run — if it did, a regulator reading it next month would see
 * a different document from the one that was sent, with no way to tell.
 *
 * So a report names a `requestId`, never "the latest", and every number on the
 * shared page comes from that run.
 */

export type ReportRow = {
  id: string;
  requestId: string;
  title?: string;
  audience?: string;
  issuedBy?: string;
  createdAt: string;
  /** Absent once revoked; the row stays so the history does not lie. */
  shareToken?: string;
  revokedAt?: string;
  clientId?: string;
  clientName?: string;
  run: RunSummary | null;
};

export type ReportDeps = {
  clients: ClientStore;
  journeys: JourneyStore;
  reports: ReportStore;
  runs: RunStore;
};

/**
 * Every report, newest first.
 *
 * `listReports` takes request ids, so the caller has to know which runs exist
 * before it can ask — the reports table has no client column, by design: a
 * report belongs to a run, and the run belongs to a journey, and the journey
 * belongs to a client. One place stores that chain.
 */
export async function buildReports(deps: ReportDeps): Promise<ReportRow[]> {
  const clients = await deps.clients.listClients();

  const runsByClient = await Promise.all(
    clients.map(async (client) => {
      const journeys = await deps.journeys.listJourneys(client.id);
      const runs = await Promise.all(
        journeys.map((journey) => deps.runs.list({ journeyId: journey.id, limit: 50 })),
      );
      return { client, runs: runs.flat() };
    }),
  );

  const byRequestId = new Map<string, { clientId: string; clientName: string; run: StoredRunRecord }>();
  for (const { client, runs } of runsByClient) {
    for (const run of runs) {
      byRequestId.set(run.requestId, { clientId: client.id, clientName: client.name, run });
    }
  }

  const reports = await deps.reports.listReports([...byRequestId.keys()]);

  return reports
    .map((report) => toRow(report, byRequestId.get(report.requestId)))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function toRow(
  report: StoredReport,
  context: { clientId: string; clientName: string; run: StoredRunRecord } | undefined,
): ReportRow {
  return {
    id: report.id,
    requestId: report.requestId,
    ...(report.title === undefined ? {} : { title: report.title }),
    ...(report.audience === undefined ? {} : { audience: report.audience }),
    ...(report.issuedBy === undefined ? {} : { issuedBy: report.issuedBy }),
    createdAt: report.createdAt,
    ...(report.shareToken === undefined ? {} : { shareToken: report.shareToken }),
    ...(report.revokedAt === undefined ? {} : { revokedAt: report.revokedAt }),
    ...(context === undefined
      ? {}
      : { clientId: context.clientId, clientName: context.clientName }),
    run: context ? summariseRun(context.run) : null,
  };
}

export type SharedReport = {
  title: string;
  clientName: string;
  audience?: string;
  issuedBy?: string;
  createdAt: string;
  run: RunSummary;
  /**
   * Findings, grouped by page, as they were in the pinned run.
   *
   * Triage is deliberately not applied here. A dismissal is an internal
   * decision with an internal justification; publishing it to whoever holds
   * the link would leak the note, and hiding the finding because of it would
   * make the shared document disagree with the audit it claims to report.
   */
  pages: Array<{
    url: string;
    route: string;
    title?: string;
    evidenceStatus: string;
    findings: Array<{
      code: string;
      title?: string;
      severity: string;
      wcagCriteria: string[];
      selector?: string;
    }>;
  }>;
};

/**
 * The report behind a share token, or null.
 *
 * Null covers a token that never existed, one that was revoked, and one whose
 * run has since been deleted — the caller answers 404 for all three, because
 * distinguishing them for an unauthenticated holder of a URL tells them
 * whether they had a valid link, which is information they have not earned.
 */
export async function buildSharedReport(
  token: string,
  deps: Pick<ReportDeps, 'reports' | 'runs' | 'clients' | 'journeys'>,
): Promise<SharedReport | null> {
  const report = await deps.reports.getReportByToken(token);
  if (!report) {
    return null;
  }

  const run = await deps.runs.getRun(report.requestId);
  if (!run) {
    return null;
  }

  const journey = await deps.journeys.getJourney(run.journeyId);
  const client = journey ? await deps.clients.getClient(journey.clientId) : null;

  const deterministic = run.findings.filter((finding) => finding.source === 'deterministic');
  const byPage = new Map<string, SharedReport['pages'][number]['findings']>();
  for (const finding of deterministic) {
    const list = byPage.get(finding.pageUrl ?? '') ?? [];
    list.push({
      code: finding.code,
      ...(finding.title === undefined ? {} : { title: finding.title }),
      severity: finding.severity,
      wcagCriteria: finding.wcagCriteria ?? [],
      ...(finding.selector === undefined ? {} : { selector: finding.selector }),
    });
    byPage.set(finding.pageUrl ?? '', list);
  }

  return {
    title: report.title ?? `Accessibility audit — ${client?.name ?? 'report'}`,
    clientName: client?.name ?? 'Unnamed client',
    ...(report.audience === undefined ? {} : { audience: report.audience }),
    ...(report.issuedBy === undefined ? {} : { issuedBy: report.issuedBy }),
    createdAt: report.createdAt,
    run: summariseRun(run),
    pages: (run.pages ?? []).map((page) => ({
      url: page.url,
      route: page.route,
      ...(page.title === undefined ? {} : { title: page.title }),
      evidenceStatus: page.evidenceStatus,
      findings: byPage.get(page.url) ?? [],
    })),
  };
}
