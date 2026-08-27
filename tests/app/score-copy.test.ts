import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No surface prints a bare score beside a verdict.
 *
 * The blind test measured the defect: every planted site scored 97–98 while
 * failing, and a bare "98" under a label saying "Score" is the number a
 * client quotes back as a grade. The copy that says what the number is a
 * rate of lives in `services/presentation/verdict.ts`, and this test is what
 * keeps a future screen from hand-building the old rendering — the same
 * grep-the-tree pattern as `log-shape.test.ts`, for the same reason: a rule
 * that lives only in review comments gets pasted around.
 */

const APP_ROOT = join('src', 'app');

function componentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...componentFiles(path));
    else if (entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

describe('score rendering', () => {
  const files = componentFiles(APP_ROOT).map((file) => ({
    file,
    source: readFileSync(file, 'utf8'),
  }));

  it('is looked at by this test at all', () => {
    // Non-vacuity: a walk that finds no components asserts nothing.
    expect(files.length).toBeGreaterThan(10);
  });

  it('never labels a stat "Score"', () => {
    for (const { file, source } of files) {
      expect(source, `${file} labels a bare score`).not.toMatch(/label=["']Score["']/);
    }
  });

  it('renders every score through the presentation seam', () => {
    for (const { file, source } of files) {
      if (!/\.score\b/.test(source)) continue;
      expect(
        /scoreStatValue|scoreLine/.test(source),
        `${file} reads .score without the seam's copy — use scoreStatValue/scoreLine from services/presentation/verdict`,
      ).toBe(true);
    }
  });
});
