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
