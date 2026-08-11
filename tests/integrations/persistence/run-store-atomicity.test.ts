import { describe, expect, it } from 'vitest';
import { PostgresRunStore, type SqlClient } from '../../../src/integrations/persistence/postgres-run-store';
import type { StoredRunRecord } from '../../../src/domain/persistence';

/**
 * `saveRun` must write a run and its children as one transaction.
 *
 * The contract suite in `postgres-run-store.test.ts` cannot catch this: it
 * writes, then reads, and a sequence of separate statements passes that just
 * as well as a transaction does. What it cannot see is the gap between them —
 * a real audit of four pages produced 239 findings, and while those inserts
 * were landing one at a time `getRun` returned a run marked `complete` with
 * however many had arrived. On a re-save it was worse: the `delete` committed
 * on its own, so for the length of the reinsert a failing run read as a run
 * with no findings at all.
 *
 * Reproducing that race against a real database would mean timing a read
 * against a write, which is flaky by construction. The property that actually
 * matters is structural and can be checked exactly: nothing `saveRun` writes
 * is sent outside a transaction.
 *
 * The double mirrors the one behaviour of the driver this relies on — its
 * tagged template is lazy, so building a statement is not running it. That is
 * what lets `saveRun` describe 245 statements and send them together.
 */

class LazyQuery implements PromiseLike<never[]> {
  constructor(
    readonly text: string,
    private readonly onRun: (query: LazyQuery) => void,
  ) {}

  then<A = never[], B = never>(
    onFulfilled?: ((value: never[]) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    this.onRun(this);
    return Promise.resolve([] as never[]).then(onFulfilled, onRejected);
  }
}

function recordingClient() {
  /** Statements awaited directly — each one its own transaction. */
  const standalone: string[] = [];
  /** One entry per `transaction()` call, holding the statements it carried. */
  const transactions: string[][] = [];

  const client = ((strings: TemplateStringsArray) =>
    new LazyQuery(strings.join('?').replace(/\s+/g, ' ').trim(), (query) =>
      standalone.push(query.text),
    )) as unknown as SqlClient;

  client.transaction = async (queries: readonly Promise<unknown>[]) => {
    // The real driver refuses anything that is not one of its own unstarted
    // queries. Modelling that here matters: a refactor that pushed an
    // already-running promise — an awaited `sql.query`, a `Promise.all`
    // wrapper — would satisfy a laxer fake and throw in production.
    for (const query of queries) {
      if (!(query instanceof LazyQuery)) {
        throw new Error('transaction() expects an array of queries');
      }
    }

    transactions.push((queries as unknown as LazyQuery[]).map((query) => query.text));
    return [];
  };

  return { client, standalone, transactions };
}

const RECORD: StoredRunRecord = {
  requestId: 'atomicity-1',
  journeyId: 'atomicity-journey',
  environment: 'staging',
  platform: 'web',
  evidenceStatus: 'complete',
  ciStatus: 'fail',
  status: 'complete',
  durationMs: 11824,
  createdAt: '2026-08-10T00:00:00.000Z',
  pages: [
    { url: 'https://example.test/', route: '/', title: 'Home', evidenceStatus: 'complete' },
    { url: 'https://example.test/news', route: '/news', title: 'News', evidenceStatus: 'complete' },
  ],
  findings: [
    { code: 'image-alt', severity: 'critical', source: 'deterministic' },
    { code: 'color-contrast', severity: 'serious', source: 'deterministic' },
    { code: 'link-name', severity: 'serious', source: 'deterministic' },
  ],
};

describe('PostgresRunStore.saveRun', () => {
  it('sends every statement in a single transaction', async () => {
    const { client, standalone, transactions } = recordingClient();

    await new PostgresRunStore(client).saveRun(RECORD);

    // The failure this guards is a reader seeing a half-written run. Any
    // statement that commits on its own opens that window, whichever one it is.
    expect(standalone).toEqual([]);
    expect(transactions).toHaveLength(1);
  });

  it('carries the journey, the run and every child in that transaction', async () => {
    const { client, transactions } = recordingClient();

    await new PostgresRunStore(client).saveRun(RECORD);

    const [statements] = transactions;

    // 1 journey + 1 run + 2 deletes + 2 pages + 3 findings, in order. The
    // length is implied by the list below, so it is not asserted twice.
    const kinds = statements.map((text) => {
      const match = /^insert into (\w+)|^delete from (\w+)/.exec(text);
      // Named rather than `!`, so a statement shape nobody anticipated fails
      // as a readable assertion instead of a TypeError.
      return match ? match.slice(1).find(Boolean) : `unrecognised: ${text}`;
    });
    expect(kinds).toEqual([
      'journeys',
      'runs',
      'run_pages',
      'findings',
      'run_pages',
      'run_pages',
      'findings',
      'findings',
      'findings',
    ]);

    // The deletes precede the reinserts, which is only safe because they
    // commit together — this is the ordering that briefly emptied a run.
    expect(statements[2]).toMatch(/^delete from run_pages/);
    expect(statements[3]).toMatch(/^delete from findings/);
  });

  it('still writes a run that has no pages and no findings', async () => {
    // The `running` placeholder written before an audit starts. It must not
    // become a special case that skips the transaction.
    const { client, standalone, transactions } = recordingClient();

    await new PostgresRunStore(client).saveRun({
      ...RECORD,
      status: 'running',
      findings: [],
      ...({ pages: undefined } as Partial<StoredRunRecord>),
    });

    expect(standalone).toEqual([]);
    expect(transactions[0]).toHaveLength(4);
  });
});
