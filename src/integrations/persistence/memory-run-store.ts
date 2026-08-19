import type { Environment } from '../../domain/contracts';
import { isAbandoned, reconcileRunStatus } from '../../domain/run-staleness';
import {
  clampRunListLimit,
  type ListRunsOptions,
  type RunStore,
  type StoredRunRecord,
} from '../../domain/persistence';

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
    // Intent survives a re-save that omits it, matching the `coalesce` in the
    // Postgres upsert. The reachable second write is `executeRun`'s catch,
    // which records a failure carrying no intent — and blanking the intent of
    // an already-recorded walk would leave a run that cannot be compared and
    // cannot say why. Without this the two stores answered differently and the
    // shared contract, which exists to stop exactly that, did not ask.
    const existing = this.runs.get(record.requestId);
    const intent = record.intent ?? existing?.intent;

    // Structured-cloned so a caller mutating the object it saved cannot reach
    // back into stored state — the database cannot be mutated that way either,
    // and a double that allows it hides bugs.
    this.runs.set(
      record.requestId,
      structuredClone({ ...record, ...(intent ? { intent } : {}) }),
    );
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
    const limit = clampRunListLimit(options.limit);

    return this.ordered()
      .filter(
        (run) =>
          (options.journeyId === undefined || run.journeyId === options.journeyId) &&
          (options.environment === undefined || run.environment === options.environment) &&
          (options.status === undefined || run.status === options.status),
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

  async clearArtifactsBefore(cutoffIso: string): Promise<number> {
    const cutoff = Date.parse(cutoffIso);
    let cleared = 0;

    for (const record of this.runs.values()) {
      if (Date.parse(record.createdAt) >= cutoff) continue;
      for (const page of record.pages ?? []) {
        if (page.artifacts && Object.keys(page.artifacts).length > 0) {
          delete page.artifacts;
          cleared += 1;
        }
      }
    }

    return cleared;
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
