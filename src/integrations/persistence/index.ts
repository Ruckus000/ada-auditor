import { neon } from '@neondatabase/serverless';
import type { RunStore } from '../../domain/persistence';
import type { PlatformStore } from '../../domain/platform';
import { MemoryPlatformStore } from './memory-platform-store';
import { MemoryRunStore } from './memory-run-store';
import { PostgresPlatformStore } from './postgres-platform-store';
import { PostgresRunStore, type SqlClient } from './postgres-run-store';

let defaultStore: RunStore | undefined;
let defaultPlatformStore: PlatformStore | undefined;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * An explicit, opt-in ephemeral mode for harnesses that boot the real server.
 *
 * This is deliberately **not** a fallback for a missing `DATABASE_URL`. A
 * fallback would let a misconfigured deploy serve an empty portfolio and
 * silently discard every run, which is exactly the failure the loud throw
 * below exists to prevent. `AUDITOR_STORE=memory` has to be typed by someone
 * who meant it, and it says so on the way past.
 */
function memoryStoreRequested(): boolean {
  if (process.env.AUDITOR_STORE !== 'memory') {
    return false;
  }

  console.warn(
    JSON.stringify({
      event: 'store_memory_mode',
      note: 'AUDITOR_STORE=memory — nothing is persisted. Never set this in a deployed environment.',
    }),
  );
  return true;
}

/**
 * The ephemeral stores live on `globalThis`, not in a module variable.
 *
 * Next bundles route handlers and page components into separate server chunks,
 * so a module-level singleton is not one singleton — the API route and the
 * screen that reads it each get their own. Postgres does not care, because the
 * state is in the database. The memory stores very much do: a client added
 * through the API never appeared on the page, which looks exactly like a
 * broken write and is not one. One process, one store.
 */
const EPHEMERAL = Symbol.for('ada-auditor.ephemeral-stores');

type EphemeralStores = { runs?: RunStore; platform?: PlatformStore };

function ephemeral(): EphemeralStores {
  const host = globalThis as { [EPHEMERAL]?: EphemeralStores };
  host[EPHEMERAL] ??= {};
  return host[EPHEMERAL];
}

/**
 * Builds the run store.
 *
 * There is one, and it needs a database. The filesystem and KV stores that
 * used to sit behind this factory are gone: keeping a local fallback would
 * mean two persistence behaviours to keep correct, and — worse — a
 * misconfigured deploy would quietly write runs to a serverless filesystem
 * that disappears with the invocation instead of failing where someone can
 * see it. Tests inject `MemoryRunStore` through `setRunStore`.
 */
export function createRunStore(sql?: SqlClient): RunStore {
  if (sql) {
    return new PostgresRunStore(sql);
  }

  if (memoryStoreRequested()) {
    const stores = ephemeral();
    stores.runs ??= new MemoryRunStore();
    return stores.runs;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Provision Neon (`vercel integration add neon`) and run `vercel env pull`.',
    );
  }

  // Constructed lazily, inside the factory: `neon()` throws without a URL, and
  // Next evaluates top-level module code at build time, so a module-scope
  // client would crash `next build` on any deploy where the variable is not
  // set yet.
  return new PostgresRunStore(neon(url) as SqlClient);
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

/**
 * The catalog store, built the same way and for the same reasons: lazily, so
 * `next build` does not evaluate `neon()` before the variable exists, and
 * failing loudly rather than degrading to something ephemeral.
 */
export function createPlatformStore(sql?: SqlClient): PlatformStore {
  if (sql) {
    return new PostgresPlatformStore(sql);
  }

  if (memoryStoreRequested()) {
    const stores = ephemeral();
    stores.platform ??= new MemoryPlatformStore();
    return stores.platform;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Provision Neon (`vercel integration add neon`) and run `vercel env pull`.',
    );
  }

  return new PostgresPlatformStore(neon(url) as SqlClient);
}

export function getPlatformStore(): PlatformStore {
  if (!defaultPlatformStore) {
    defaultPlatformStore = createPlatformStore();
  }
  return defaultPlatformStore;
}

export function setPlatformStore(store: PlatformStore): void {
  defaultPlatformStore = store;
}

export function resetPlatformStore(): void {
  defaultPlatformStore = undefined;
}

export { PostgresRunStore } from './postgres-run-store';
export { MemoryRunStore } from './memory-run-store';
export { PostgresPlatformStore } from './postgres-platform-store';
export { MemoryPlatformStore } from './memory-platform-store';
