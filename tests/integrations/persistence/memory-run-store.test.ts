import { describe, expect, it } from 'vitest';
import { MemoryRunStore } from '../../../src/integrations/persistence/memory-run-store';
import { runStoreContract, runRecord } from '../../support/run-store-contract';

/**
 * The in-process double, held to the same contract as the real store.
 *
 * It exists so the unit suite does not need a database. That only works if it
 * behaves like the database — a double that quietly disagrees means every
 * handler test passes against behaviour production does not have.
 */
describe('MemoryRunStore', () => {
  runStoreContract(() => new MemoryRunStore());

  /**
   * That the store actually *calls* the clamp, which the shared contract
   * cannot afford to prove.
   *
   * Proving a hundred-row cap needs more than a hundred rows. In memory that
   * is milliseconds; against a hosted Postgres it is a hundred round trips, so
   * the contract asserts only that a limit is honoured and this asserts the
   * ceiling. The old contract test tried to have both and got neither — it
   * asserted "at most 100" against three rows, which is true of any number.
   *
   * Not proven here, and said rather than implied: that `PostgresRunStore`
   * calls it too. Both stores share one `clampRunListLimit`, and the cost of
   * demonstrating the second caller is a hundred writes over the network.
   */
  it('caps an absurd limit rather than pulling everything it holds', async () => {
    const store = new MemoryRunStore();
    for (let index = 0; index < 150; index += 1) {
      await store.saveRun(runRecord({ requestId: `cap-${index}` }));
    }

    expect(await store.list({ limit: 100_000 })).toHaveLength(100);
  });

  it('does not hand out references into its own state', async () => {
    // A caller mutating what it saved cannot reach back into stored state
    // through Postgres either, and a double that allows it hides the bug.
    const store = new MemoryRunStore();
    const record = runRecord({ requestId: 'aliasing' });

    await store.saveRun(record);
    record.ciStatus = 'mutated';

    expect((await store.getRun('aliasing'))?.ciStatus).toBe('pass');

    const first = await store.getRun('aliasing');
    first!.ciStatus = 'mutated-again';
    expect((await store.getRun('aliasing'))?.ciStatus).toBe('pass');
  });
});
