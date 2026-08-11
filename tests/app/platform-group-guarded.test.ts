import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every screen in the `(platform)` group checks for itself.
 *
 * The group was gated once, in its layout, so that "a new screen cannot be
 * added unprotected". That guarantee was never real — a layout cannot stop its
 * children from running, only from being composed — and the pages beneath it
 * queried the database for anonymous visitors and shipped the answer in the
 * flight payload.
 *
 * `guarded()` is the fix, and this is the part of the fix that survives the
 * next screen: it walks the group on disk rather than taking a list, so a file
 * added tomorrow is covered by a test written today. That is the property the
 * layout comment was claiming, moved somewhere it can be enforced.
 *
 * Deliberately a source-text check. The alternative — importing each module
 * and rendering it — needs a Next server-component runtime, `cookies()` and a
 * store, which is the reason this had no test before.
 */

const GROUP = join(process.cwd(), 'src/app/(platform)');

/** `layout.tsx` and `page.tsx` are the two files Next will render on a request. */
function renderableFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...renderableFiles(path));
    } else if (entry.name === 'page.tsx' || entry.name === 'layout.tsx') {
      found.push(path);
    }
  }

  return found;
}

const GROUP_LAYOUT = join(GROUP, 'layout.tsx');

// The group layout is the one file that legitimately checks inline: it is what
// renders the locked screen, so it cannot be wrapped in the thing that returns
// the locked screen.
const SCREENS = renderableFiles(GROUP).filter((path) => path !== GROUP_LAYOUT);

describe('the (platform) route group', () => {
  it('has screens to check', () => {
    // Guards against the whole suite passing vacuously if the group moves.
    expect(SCREENS.length).toBeGreaterThanOrEqual(8);
  });

  it.each(SCREENS.map((path) => [relative(process.cwd(), path), path]))(
    '%s applies the guard to its default export',
    (_label, path) => {
      const source = readFileSync(path, 'utf8');

      expect(source).toMatch(/^export default guarded\(/m);
      expect(source).toMatch(/import \{ guarded \} from '[./]+guard';/);
    },
  );

  it.each(SCREENS.map((path) => [relative(process.cwd(), path), path]))(
    '%s does not read a store or a principal of its own before the guard runs',
    (_label, path) => {
      const source = readFileSync(path, 'utf8');
      const wrapped = source.indexOf('export default guarded(');

      // Anything at module scope runs on import, before any request. A store
      // handle captured there would be shared across principals; a config read
      // there would describe the builder's environment, which this codebase has
      // shipped before.
      const beforeGuard = source.slice(0, wrapped);
      expect(beforeGuard).not.toMatch(/getPlatformStore\(\)|getRunStore\(\)|readDeploymentConfig\(\)/);
    },
  );

  it('gives the group layout its own inline check', () => {
    // Defence in depth, and the thing an anonymous visitor actually sees.
    const source = readFileSync(GROUP_LAYOUT, 'utf8');

    expect(source).toContain('await currentPrincipal()');
    expect(source).toContain('<PlatformLocked />');
  });
});
