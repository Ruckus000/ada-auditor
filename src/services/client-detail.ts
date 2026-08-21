import { environmentSchema, type Environment } from '../domain/contracts';
import { toStepViews, type JourneyStepView } from '../domain/journey-step';
import type { RunStore, StoredRunRecord } from '../domain/persistence';
import {
  journeyRunRefusal,
  type ClientStore,
  type JourneyRunRefusal,
  type JourneyStore,
} from '../domain/platform';
import { newestCompletedRun } from './completed-run';
import { credentialsForSteps, type CredentialPresence } from './credential-presence';
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
  /**
   * What the journey actually does, in order.
   *
   * The screen showed only `stepCount`, so an operator could not tell what a
   * journey walked without reading the database — and a step list nobody can
   * see is the reason no static rule can be trusted to police it.
   *
   * Redacted by `toStepViews`: a literal `value` is reported as present and
   * never echoed, because rows written before `authoredStepSchema` can hold a
   * real password.
   *
   * This replaced a separate `stepCount`. Two fields for one fact is a pair
   * that drifts, and the count is `steps.length` — including for a row holding
   * something that is not an array, where `toStepViews` answers `[]` for the
   * same reason the old guard answered `0`.
   */
  steps: JourneyStepView[];
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
  /**
   * Where this journey runs, which decides what a step is allowed to do.
   *
   * On the screen because the step editor needs it. `submit-safe` and
   * `mutate-test-data` are authorable — some environment permits them — and
   * production permits neither, so offering them on a production journey
   * stores steps that walk 1..N-1 against a live site and then abort. The
   * editor can only avoid that if it knows which environment it is editing.
   *
   * `production` when the row does not say, matching the run route: a journey
   * with no stored environment is run as production, so the editor must
   * constrain it as production too or the two disagree about the same journey.
   */
  environment: Environment;
  /**
   * The credentials this journey names, and whether each is configured.
   *
   * Presence only — never a value, never an input. The step editor lets an
   * operator type a `credentialRef`, and until this the only way to find out
   * whether it resolved was to start a run and watch it fail at the login,
   * after a browser had launched and walked that far.
   */
  credentials: CredentialPresence[];
  /**
   * When the journey was recorded, which is what makes "the journey the wizard
   * is walking" a stable answer.
   *
   * Both stores list journeys `order by name asc`, so a selection that took the
   * first runnable one changed its mind whenever a second journey was added or
   * an existing one renamed — the Run button would launch a journey the
   * operator never authored. Nothing records which journey the wizard walks, so
   * the resolver picks the oldest instead: a fact about the row that no later
   * edit moves.
   */
  createdAt: string;
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
  /**
   * Why the run stopped, on a run that stopped. Absent on one that finished.
   *
   * Stored since failures were first classified, and read by nothing — so
   * every failure rendered as `? INCONCLUSIVE` with no explanation, and a
   * stale selector looked exactly like a browser crash. It is the stable
   * code, never the raw message: `audit-run-handler` stores
   * `classifyRunFailure`'s output precisely so this can be shown.
   *
   * `RunSummary` is also embedded in `SharedReport`, which is what the public
   * `/r/[token]` page renders — so this field structurally reaches an
   * unauthenticated surface. Nothing there reads it, and the page is a Server
   * Component so only its output crosses the wire. Noted because the type
   * gives no signal, and this codebase has already shipped one leak that
   * looked exactly like this.
   */
  failureReason?: string;
};

export type ClientDetail = {
  id: string;
  name: string;
  owner?: string;
  createdAt: string;
  journeys: JourneySummary[];
  /** The newest run across every journey, or null before the first one. */
  lastRun: RunSummary | null;
  /**
   * The newest run that actually finished, and the journey that produced it —
   * null until the first one does. Derived, never stored: this is what
   * "onboarded" means, and what the setup screens key their terminal stage on.
   *
   * Newest-run checks cannot answer it: a failed retry would hide an old
   * success and un-onboard a client. Nor can `lastRun`, which is why the run
   * travels with the flag rather than beside it — the results screen renders
   * the audit that completed, and reading `lastRun` there put a later failed
   * rerun's empty numbers under the heading "First audit complete".
   *
   * `journeyId` may name a journey absent from `journeys` above: archiving the
   * journey does not unmake the run, and the client stays onboarded either way.
   */
  completedRun: { journeyId: string; run: RunSummary } | null;
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
    // Only on a run that actually failed. A reason attached to a finished run
    // would be a leftover from an earlier attempt at the same request id.
    ...(run.status === 'failed' && run.failureReason
      ? { failureReason: run.failureReason }
      : {}),
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

  // Archived rows fetched, then filtered out of the catalog. `journeys` below
  // is what the screens list, and must not show a journey an operator retired;
  // the completed-run probe has to count one, because archiving the journey
  // that holds a client's only finished audit is not un-onboarding them.
  const stored = await deps.journeys.listJourneys(client.id, { includeArchived: true });
  const journeys = stored.filter((journey) => !journey.archivedAt);

  const summarising = journeys.map(async (journey): Promise<JourneySummary> => {
    const [run] = await deps.runs.list({ journeyId: journey.id, limit: 1 });

    return {
      id: journey.id,
      name: journey.name,
      ...(journey.targetUrl === undefined ? {} : { targetUrl: journey.targetUrl }),
      // `toStepViews` carries the guard `stepCount` used to: `steps` is
      // jsonb written before any validation existed, so a row can hold
      // something that is not an array, and it answers `[]` rather than
      // letting `undefined` reach the screen as "undefined steps".
      steps: toStepViews(journey.steps),
      runRefusal: journeyRunRefusal(journey),
      schedule: (journey.schedule as 'off' | 'daily' | 'weekly') ?? 'off',
      // Parsed rather than cast: `environment` is a free `string?` on the
      // stored row, so a value written before the schema existed — or by
      // hand — must not reach the editor as an `Environment` it is not.
      // Anything unrecognised falls to `production`, the same default the
      // run route applies, because the safe answer is the strict one.
      environment: environmentSchema.safeParse(journey.environment).data ?? 'production',
      credentials: credentialsForSteps(journey.steps),
      createdAt: journey.createdAt,
      lastRun: run ? summariseRun(run) : null,
    };
  });

  // The two waves share no data, so they overlap. Serialized — which is how
  // this and the portfolio's twin were written — every render paid two full
  // round-trip latencies back to back for facts neither wave needed from the
  // other.
  const [summaries, completed] = await Promise.all([
    Promise.all(summarising),
    newestCompletedRun(stored, deps.runs),
  ]);

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
    completedRun: completed
      ? { journeyId: completed.journeyId, run: summariseRun(completed) }
      : null,
  };
}
