import type { RunStore, StoredRunRecord } from '../domain/persistence';
import {
  journeyRunRefusal,
  type ClientStore,
  type JourneyRunRefusal,
  type JourneyStore,
} from '../domain/platform';
import { displaySeverity } from './presentation/severity';
import { runVerdict, type VerdictKind } from './presentation/verdict';

/**
 * One client, as the client page needs it.
 *
 * Built from the same three stores the portfolio uses, and answering the same
 * question one level down: not "which client needs attention" but "what have we
 * actually run for this one, and what did it say".
 *
 * The prototype's client screen carried a domain, a trend arrow, a next-run
 * time, a coverage percentage and a "blocking issues" panel. Of those only the
 * findings counts survive contact with the record. The rest are not omissions
 * to fill in later — nothing in this system schedules a run or tracks coverage,
 * so a number in those places would be an invention.
 */

export type JourneySummary = {
  id: string;
  name: string;
  targetUrl?: string;
  stepCount: number;
  /**
   * Why "Run now" can do nothing with this journey, or `null` when it can.
   *
   * The reason, not a boolean, because there are two of them and the screen
   * printed one of them unconditionally: a journey with a target and no steps
   * was offered a button that answered 422, under a label reading "no target
   * URL" beside the target URL it had.
   */
  runRefusal: JourneyRunRefusal | null;
  /** How often this journey re-runs. `off` unless somebody chose otherwise. */
  schedule: 'off' | 'daily' | 'weekly';
  lastRun: RunSummary | null;
};

export type RunSummary = {
  requestId: string;
  createdAt: string;
  verdict: VerdictKind;
  /** Null when the run could not be scored — never 0, which is a real score. */
  score: number | null;
  mustFix: number;
  shouldFix: number;
  pagesAudited: number;
  evidenceStatus: string;
  /**
   * How long the run took. Null on runs recorded before it was measured —
   * never 0, which would claim a run that took no time.
   */
  durationMs: number | null;
  /** The slowest single page, which is what the page cap is denominated in. */
  slowestPageMs: number | null;
};

export type ClientDetail = {
  id: string;
  name: string;
  owner?: string;
  createdAt: string;
  journeys: JourneySummary[];
  /** The newest run across every journey, or null before the first one. */
  lastRun: RunSummary | null;
};

/** The slowest page's wall clock, or null when no page carries a measurement. */
function slowestPage(run: StoredRunRecord): number | null {
  const measured = (run.pages ?? [])
    .map((page) => page.durationMs)
    .filter((ms): ms is number => typeof ms === 'number');
  return measured.length > 0 ? Math.max(...measured) : null;
}

export function summariseRun(run: StoredRunRecord): RunSummary {
  const deterministic = run.findings.filter((finding) => finding.source === 'deterministic');

  return {
    requestId: run.requestId,
    createdAt: run.createdAt,
    verdict: runVerdict({ status: run.status, ciStatus: run.ciStatus, findings: run.findings }),
    score: run.score ?? null,
    mustFix: deterministic.filter((f) => displaySeverity(f.severity) === 'must').length,
    shouldFix: deterministic.filter((f) => displaySeverity(f.severity) === 'should').length,
    pagesAudited: run.pages?.length ?? 0,
    evidenceStatus: run.evidenceStatus,
    durationMs: run.durationMs || null,
    slowestPageMs: slowestPage(run),
  };
}

export type ClientDetailDeps = {
  clients: ClientStore;
  journeys: JourneyStore;
  runs: RunStore;
};

/**
 * Null for a client that does not exist, so the route can answer 404.
 *
 * That distinction matters more here than it looks: the fixture code this
 * replaces fell back to the *first* client on an unknown slug, which rendered
 * one client's accessibility findings under another client's address. In an
 * auditor product that is the worst available failure, because it looks like
 * an answer.
 */
export async function buildClientDetail(
  clientId: string,
  deps: ClientDetailDeps,
): Promise<ClientDetail | null> {
  const client = await deps.clients.getClient(clientId);
  if (!client) {
    return null;
  }

  const journeys = await deps.journeys.listJourneys(client.id);

  const summaries = await Promise.all(
    journeys.map(async (journey): Promise<JourneySummary> => {
      const [run] = await deps.runs.list({ journeyId: journey.id, limit: 1 });

      return {
        id: journey.id,
        name: journey.name,
        ...(journey.targetUrl === undefined ? {} : { targetUrl: journey.targetUrl }),
        // Guarded for the same reason `journeyRunRefusal` is, two lines down:
        // `steps` is jsonb written before any validation existed, so a row can
        // hold something that is not an array. `.length` on an object is
        // `undefined`, and the journeys screen renders it straight into
        // "undefined steps".
        stepCount: Array.isArray(journey.steps) ? journey.steps.length : 0,
        runRefusal: journeyRunRefusal(journey),
        schedule: (journey.schedule as 'off' | 'daily' | 'weekly') ?? 'off',
        lastRun: run ? summariseRun(run) : null,
      };
    }),
  );

  const lastRun = summaries
    .map((journey) => journey.lastRun)
    .filter((run): run is RunSummary => run !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

  return {
    id: client.id,
    name: client.name,
    ...(client.owner === undefined ? {} : { owner: client.owner }),
    createdAt: client.createdAt,
    journeys: summaries,
    lastRun: lastRun ?? null,
  };
}
