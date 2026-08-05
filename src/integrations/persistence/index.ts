import { join } from 'node:path';
import { Redis } from '@upstash/redis';
import type { RunStore } from '../../domain/persistence';
import { FileRunStore } from './file-run-store';
import { KvRunStore, type KvClient } from './kv-run-store';

let defaultStore: RunStore | undefined;

export function isKvConfigured(): boolean {
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

function createConfiguredKvClient(): KvClient {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Redis/KV REST credentials are not configured.');
  }
  return new Redis({ url, token });
}

/**
 * Build a run store. Explicit `storeDir` always uses the filesystem adapter
 * (local/CI). Otherwise Upstash Redis/KV wins when REST credentials are present.
 */
export function createRunStore(storeDir?: string, kvClient?: KvClient): RunStore {
  if (storeDir) {
    return new FileRunStore(storeDir);
  }

  if (kvClient) {
    return new KvRunStore(kvClient);
  }

  if (isKvConfigured()) {
    return new KvRunStore(createConfiguredKvClient());
  }

  if (process.env.VERCEL) {
    throw new Error(
      'Durable run store required on Vercel: set KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_*',
    );
  }

  const resolvedDir = process.env.RUN_STORE_PATH ?? join(process.cwd(), 'data/runs');
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
export { KvRunStore } from './kv-run-store';
