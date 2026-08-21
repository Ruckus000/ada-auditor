import type { RunStore, StoredRunRecord } from '../domain/persistence';
import type { StoredJourney } from '../domain/platform';

/**
 * The client's newest finished run, or null before the first one lands.
 *
 * One predicate, two surfaces. The portfolio negates it into "Setup
 * incomplete" and the client page reads it as the wizard's terminal stage —
 * written out twice, in opposite polarity, with no comment tying them
 * together, they were free to drift, and a bug in the shared reasoning was a
 * bug that had to be fixed twice or the two screens would disagree about the
 * same client.
 *
 * **Pass every journey, archived ones included.** A completed audit does not
 * stop existing because the journey that produced it was retired: the run is
 * still in the database and still on the findings screen, so dropping it here
 * would reopen the wizard for a client who finished setup — which is exactly
 * what "start over" (a DELETE on the wizard's own journey) used to do.
 * `listJourneys` hides archived rows by default, which is right for a catalog
 * and wrong for this.
 */
export async function newestCompletedRun(
  journeys: readonly StoredJourney[],
  runs: RunStore,
): Promise<StoredRunRecord | null> {
  const perJourney = await Promise.all(
    journeys.map(async (journey) => {
      const [completed] = await runs.list({
        journeyId: journey.id,
        status: 'complete',
        limit: 1,
      });
      return completed ?? null;
    }),
  );

  return (
    perJourney
      .filter((run): run is StoredRunRecord => run !== null)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
  );
}
