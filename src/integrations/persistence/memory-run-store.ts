import type { Environment } from '../../domain/contracts';
import { isAbandoned, reconcileRunStatus } from '../../domain/run-staleness';
import type { ListRunsOptions, RunStore, StoredRunRecord } from '../../domain/persistence';

/**
 * An in-process run store, for tests and nothing else.
 *
 * `FileRunStore` and `KvRunStore` were deleted rather than kept as the local
 * option: a file store that reads its whole directory to answer one query, and
 * a KV store with a two-deep pointer chain, are two more persistence
 * behaviours to keep correct for no production benefit now that there is a
 * real database. But the unit suite must not need one — a test that cannot run
 * without network credentials is a test that stops being run — so the seam
 * keeps a trivial double instead.
 *
 * It is deliberately not exported from the package index as a production
 * option: `getRunStore()` fails loudly without `DATABASE_URL` rather than
 * quietly falling back to memory and losing every run when the process exits.
 */
export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, StoredRunRecord>();

  async saveRun(record: StoredRunRecord): Promise<void> {
    // Structured-cloned so a caller mutating the object it saved cannot reach
    // back into stored state — the database cannot be mutated that way either,
    // and a double that allows it hides bugs.
    this.runs.set(record.requestId, structuredClone(record));
  }

  async getRun(requestId: string): Promise<StoredRunRecord | null> {
    const record = this.runs.get(requestId);
    return record ? reconcileRunStatus(structuredClone(record)) : null;
  }

  async getLatestRun(
    journeyId: string,
    environment: Environment,
    excludeRequestId?: string,
  ): Promise<StoredRunRecord | null> {
    const [latest] = this.ordered().filter(
      (run) =>
        run.journeyId === journeyId &&
        run.environment === environment &&
        run.requestId !== excludeRequestId,
    );

    return latest ? reconcileRunStatus(structuredClone(latest)) : null;
  }

  async list(options: ListRunsOptions = {}): Promise<StoredRunRecord[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

    return this.ordered()
      .filter(
        (run) =>
          (options.journeyId === undefined || run.journeyId === options.journeyId) &&
          (options.environment === undefined || run.environment === options.environment),
      )
      .slice(0, limit)
      .map((run) => reconcileRunStatus(structuredClone(run)));
  }

  async reconcileStaleRuns(olderThanMs: number): Promise<number> {
    const now = Date.now();
    let reconciled = 0;

    for (const [requestId, record] of this.runs) {
      if (!isAbandoned(record, now, olderThanMs)) continue;
      this.runs.set(requestId, {
        ...record,
        status: 'failed',
        failureReason: 'run_timed_out',
      });
      reconciled += 1;
    }

    return reconciled;
  }

  /**
   * Newest first, breaking ties on requestId — the same total order the
   * Postgres store's index gives, so a test cannot pass against one and fail
   * against the other.
   */
  private ordered(): StoredRunRecord[] {
    return [...this.runs.values()].sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? 1 : -1;
      }
      return a.requestId < b.requestId ? 1 : -1;
    });
  }
}
