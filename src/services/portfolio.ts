import type { RunStore, StoredRunRecord } from '../domain/persistence';
import type { ClientStore, JourneyStore } from '../domain/platform';
import { displaySeverity } from './presentation/severity';
import { runVerdict, type VerdictKind } from './presentation/verdict';

/**
 * The portfolio, built from what the database actually holds.
 *
 * It starts **empty**. Operators add clients; nothing is seeded. That was a
 * deliberate choice over shipping the eight invented clients as real rows —
 * putting fictional client names in a real database is precisely what this
 * phase exists to remove, and it would have made the empty state a screen
 * nobody ever saw until the first real customer arrived.
 *
 * Every field here is one the record can answer. The prototype's row also
 * carried a domain, a page count, a "next run" cadence and a risk flag; three
 * of those had nothing behind them and are gone rather than faked. `nextRun`
 * in particular: nothing in this system schedules anything.
 */

export type PortfolioRow = {
  id: string;
  name: string;
  owner?: string;
  journeyCount: number;
  /** Null until the client's first run finishes. */
  lastRun: {
    requestId: string;
    createdAt: string;
    verdict: VerdictKind;
    /** Null when the run could not be scored — never 0, which is a real score. */
    score: number | null;
    mustFix: number;
    shouldFix: number;
    pagesAudited: number;
  } | null;
};

function summarise(run: StoredRunRecord): NonNullable<PortfolioRow['lastRun']> {
  const deterministic = run.findings.filter((finding) => finding.source === 'deterministic');

  return {
    requestId: run.requestId,
    createdAt: run.createdAt,
    verdict: runVerdict({
      status: run.status,
      ciStatus: run.ciStatus,
      findings: run.findings,
    }),
    score: run.score ?? null,
    mustFix: deterministic.filter((f) => displaySeverity(f.severity) === 'must').length,
    shouldFix: deterministic.filter((f) => displaySeverity(f.severity) === 'should').length,
    pagesAudited: run.pages?.length ?? 0,
  };
}

export type PortfolioDeps = {
  clients: ClientStore;
  journeys: JourneyStore;
  runs: RunStore;
};

/**
 * One row per client, newest run first.
 *
 * A client's runs are reached through its journeys, because that is the only
 * link the schema has: `runs.journey_id` → `journeys.client_id`. The query
 * count is therefore proportional to journeys, not to runs — fine while an
 * agency has tens of clients, and the point at which it stops being fine is a
 * single `join`, not a redesign.
 */
export async function buildPortfolio(deps: PortfolioDeps): Promise<PortfolioRow[]> {
  const clients = await deps.clients.listClients();

  return Promise.all(
    clients.map(async (client) => {
      const journeys = await deps.journeys.listJourneys(client.id);

      const latestPerJourney = await Promise.all(
        journeys.map(async (journey) => {
          const [run] = await deps.runs.list({ journeyId: journey.id, limit: 1 });
          return run ?? null;
        }),
      );

      // Newest across every journey the client owns. A run still in flight
      // counts: the portfolio should show "scanning" rather than yesterday's
      // verdict while an audit is running.
      const latest = latestPerJourney
        .filter((run): run is StoredRunRecord => run !== null)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

      return {
        id: client.id,
        name: client.name,
        ...(client.owner === undefined ? {} : { owner: client.owner }),
        journeyCount: journeys.length,
        lastRun: latest ? summarise(latest) : null,
      } as PortfolioRow;
    }),
  );
}

/**
 * A URL-safe id derived from the client's name.
 *
 * The id *is* the slug, so `/clients/acme-outfitters` needs no lookup table
 * and stays readable. Collisions get a numeric suffix rather than silently
 * merging two clients into one row.
 */
export function clientIdFromName(name: string, taken: readonly string[] = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'client';

  if (!taken.includes(base)) {
    return base;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
}
