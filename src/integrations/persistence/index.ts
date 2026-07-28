import { join } from 'node:path';
import type { RunStore } from '../../domain/persistence';
import { FileRunStore } from './file-run-store';

let defaultStore: RunStore | undefined;

export function createRunStore(storeDir?: string): RunStore {
  const resolvedDir = storeDir ?? process.env.RUN_STORE_PATH ?? join(process.cwd(), 'data/runs');
  return new FileRunStore(resolvedDir);
}

export function getRunStore(): RunStore {
  if (!defaultStore) {
    defaultStore = createRunStore();
  }
  return defaultStore;
}

export function setRunStore(store: RunStore): void {
  defaultStore = store;
}

export function resetRunStore(): void {
  defaultStore = undefined;
}

export { FileRunStore } from './file-run-store';
