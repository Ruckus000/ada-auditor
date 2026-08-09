import { describe } from 'vitest';
import { MemoryPlatformStore } from '../../../src/integrations/persistence/memory-platform-store';
import { platformStoreContract } from '../../support/platform-store-contract';

describe('MemoryPlatformStore', () => {
  platformStoreContract(() => new MemoryPlatformStore());
});
