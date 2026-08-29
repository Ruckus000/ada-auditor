import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DOCUMENT_CLASSES_DIR,
  DOCUMENT_JAVA_DIR,
} from '../../../src/integrations/documents/java-runtime';
import { staleDocumentStage, staleStagesComplaint } from '../../support/compiled-stages';

/**
 * The check that decides whether the real-JVM suite is allowed to speak.
 *
 * Wrong in the "never stale" direction it is silently the bug it exists for: a
 * document suite reporting on class files compiled from some other revision of
 * the Java. That happened, was chased as a live `StackOverflowError` in
 * `Inspect.walk`, and the guard it was blamed on had landed a day earlier.
 *
 * No JVM and no javac here — this is `stat` on two directories, so it belongs
 * in the fast suite rather than under `toolchain/`.
 */

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** A tree with the two real directory names, and mtimes set to order. */
function tree(sources: Record<string, number>, classes: Record<string, number>): string {
  root = mkdtempSync(join(tmpdir(), 'ada-compiled-stages-'));

  for (const [dir, files] of [
    [join(root, DOCUMENT_JAVA_DIR), sources],
    [join(root, DOCUMENT_CLASSES_DIR), classes],
  ] as const) {
    mkdirSync(dir, { recursive: true });
    for (const [name, seconds] of Object.entries(files)) {
      const file = join(dir, name);
      writeFileSync(file, '');
      // Explicit rather than written-in-order: a build takes milliseconds and
      // the assertion would rest on filesystem timestamp resolution.
      utimesSync(file, seconds, seconds);
    }
  }

  return root;
}

describe('staleDocumentStage', () => {
  it('reports nothing when every class is newer than every source', () => {
    const dir = tree({ 'Inspect.java': 1000, 'StructText.java': 1000 }, { 'Inspect.class': 2000, 'StructText.class': 2000 });

    expect(staleDocumentStage(dir)).toBeNull();
  });

  /**
   * The bug. An edited stage against classes from before the edit.
   */
  it('names the source when one is newer than the compiled output', () => {
    const dir = tree({ 'Inspect.java': 3000, 'StructText.java': 1000 }, { 'Inspect.class': 2000, 'StructText.class': 2000 });

    expect(staleDocumentStage(dir)).toBe('Inspect.java');
  });

  /**
   * Oldest class, not newest: a build that covered one file and not the other
   * leaves the untouched one behind, and a partial build misleads exactly as
   * much as no build.
   */
  it('is stale when any single class was left behind, not only when all were', () => {
    const dir = tree({ 'Inspect.java': 2500 }, { 'Inspect.class': 3000, 'StructText.class': 2000 });

    expect(staleDocumentStage(dir)).toBe('Inspect.java');
  });

  /**
   * `resolveJavaRuntime` only checks that the directory exists, so an empty one
   * reports the toolchain available and every test dies on NoClassDefFoundError
   * instead of being told to build.
   */
  it('treats nothing compiled as stale, because the fix is the same', () => {
    const dir = tree({ 'Inspect.java': 1000 }, {});

    expect(staleDocumentStage(dir)).toBe('Inspect.java');
  });

  /**
   * A deployed function bundle carries the classes and none of the sources.
   * Nothing to compare is not something to complain about.
   */
  it('reports nothing when there are no sources to compare', () => {
    const dir = tree({}, { 'Inspect.class': 1000 });

    expect(staleDocumentStage(dir)).toBeNull();
  });
});

/**
 * The sentence two suites now print. It lives beside the check rather than in
 * either caller, because a second copy is how one of them comes to name a
 * command that no longer exists.
 */
describe('staleStagesComplaint', () => {
  it('names the stale source and the command that fixes it', () => {
    const dir = tree({ 'Inspect.java': 3000 }, { 'Inspect.class': 2000 });

    const complaint = staleStagesComplaint(dir);

    expect(complaint).toContain('Inspect.java');
    expect(complaint).toContain('npm run build:documents');
  });

  it('says nothing when the build is current', () => {
    const dir = tree({ 'Inspect.java': 1000 }, { 'Inspect.class': 2000 });

    expect(staleStagesComplaint(dir)).toBeNull();
  });
});
