import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every relative link in a tracked Markdown file names a file that exists.
 *
 * The research index is written to be walked — "read the three under Start
 * here and you have the whole picture" — and eleven of its links led nowhere
 * with nothing to say so. Ten named results files that live on unmerged brief
 * branches, which the briefs protocol kept off master on purpose; the links
 * were written as if they had landed. The eleventh was a spec pointing at
 * `env.md` beside itself rather than in `docs/`.
 *
 * Tracked files only (`git ls-files`), so a gitignored local note cannot fail
 * this and a committed one cannot escape it. Web links and anchors are not
 * checked: whether a URL answers is the network's question, not the tree's.
 */

function trackedMarkdown(): string[] {
  return execFileSync('git', ['ls-files', '-z', '*.md'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

function brokenLinks(file: string, source: string): string[] {
  const broken: string[] = [];
  source.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1] ?? '';
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      // `file.ts:42` and `file.md#section` both name `file`.
      const path = decodeURIComponent(target.split('#')[0]!.replace(/:\d+(?:-\d+)?$/, ''));
      if (path && !existsSync(resolve(dirname(file), path))) broken.push(`${file}:${index + 1} -> ${target}`);
    }
  });
  return broken;
}

describe('markdown links', () => {
  it('lead to files that exist', () => {
    const files = trackedMarkdown();
    expect(files.length).toBeGreaterThan(50);

    const broken = files.flatMap((file) => brokenLinks(file, readFileSync(file, 'utf8')));
    expect(broken.join('\n')).toBe('');
  });

  it('checks relative targets, and leaves web links, anchors and line suffixes alone', () => {
    expect(brokenLinks('docs/a.md', '[x](no-such-file.md)')).toEqual(['docs/a.md:1 -> no-such-file.md']);
    expect(brokenLinks('docs/a.md', '[x](https://example.test/y.md) [y](#top) [z](mailto:a@b.test)')).toEqual([]);
    expect(brokenLinks('docs/a.md', '[x](env.md#section) [y](../AGENTS.md:12)')).toEqual([]);
  });
});
