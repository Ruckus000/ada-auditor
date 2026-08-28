import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  DOCUMENT_CLASSES_DIR,
  DOCUMENT_JAVA_DIR,
} from '../../src/integrations/documents/java-runtime';

/**
 * Whether the compiled document stages were built from the sources on disk.
 *
 * `npm run test:documents` spawns a real JVM against `dist/documents/classes`,
 * which is gitignored and which nothing rebuilds on its own. So the suite has
 * always been able to report on class files compiled from a *different*
 * revision of the Java, and it did: two `StackOverflowError` failures were
 * chased as a live cycle bug in `Inspect.walk` when the guard had already
 * landed and the classes simply predated it by a day.
 *
 * The false red cost an afternoon. The false green is the one that matters —
 * edit a stage, forget to build, and the suite passes on code it never
 * compiled. `localci.yml` is immune because its step is
 * `npm run build:documents && npm run test:documents`; the developer loop had
 * no such thing, which is exactly why nobody noticed.
 *
 * Test-side rather than in `resolveJavaRuntime`, because that answers a
 * capability question for `/api/ready` and the settings screen, in an
 * environment where a deployed bundle carries classes and no sources at all.
 * "Did somebody forget to rebuild" is a question about a working tree.
 */

/**
 * The name of a source newer than the compiled output, or `null`.
 *
 * Newest source against **oldest** class: one untouched class is enough to mean
 * the last compile did not cover everything, and a partial build is as
 * misleading as no build.
 *
 * mtime rather than a content hash, which would need a manifest nothing writes.
 * It is sound for the case that caused this: `git checkout` stamps a restored
 * file with *now*, so moving the tree backwards onto older sources reads as
 * stale too, not just editing forwards.
 */
export function staleDocumentStage(root: string = process.cwd()): string | null {
  const sources = entries(join(root, DOCUMENT_JAVA_DIR), '.java');

  // No sources to compare against. A deployed function bundle ships the classes
  // without them, and this must not invent a complaint about a tree it cannot
  // see.
  if (sources.length === 0) return null;

  const newest = sources.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));

  const classes = entries(join(root, DOCUMENT_CLASSES_DIR), '.class');
  // Never compiled and compiled too long ago have the same fix, so they get the
  // same answer. `resolveJavaRuntime` only checks that the directory exists, so
  // an empty one reaches here reporting available.
  if (classes.length === 0) return newest.name;

  const oldest = classes.reduce((a, b) => (b.mtimeMs < a.mtimeMs ? b : a));

  return newest.mtimeMs > oldest.mtimeMs ? newest.name : null;
}

function entries(dir: string, extension: string): { name: string; mtimeMs: number }[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    // An absent directory is the "nothing to compare" case above, not an error
    // worth stopping a test run for.
    return [];
  }

  return names
    .filter((name) => name.endsWith(extension))
    .map((name) => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }));
}
