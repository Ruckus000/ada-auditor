import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';

/**
 * The deployment config knows something the code does not, and nothing checks it.
 *
 * `next.config.mjs` names which routes get the browser packaged beside them;
 * `vercel.json` names which get enough memory to launch it. Both are keyed by
 * path. A route that launches Chromium from a path neither covers builds
 * clean, deploys clean, passes every suite, and dies on its first production
 * request. `next.config.mjs`'s own comment records paying for that twice.
 *
 * Static rather than dynamic on purpose: importing the routes would drag
 * Playwright into the fast suite, which `vitest.config.ts` exists to prevent.
 * `tests/services/log-shape.test.ts` is the precedent for a test that reads
 * the tree rather than running it.
 */

const SRC_ROOT = 'src';
const API_DIR = join(SRC_ROOT, 'app', 'api');
const LAUNCH = join(SRC_ROOT, 'integrations', 'browser', 'launch.ts');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...routeFiles(path));
    else if (entry === 'route.ts') out.push(path);
  }
  return out;
}

/**
 * Every module specifier in a file, minus the `import type` ones.
 *
 * A type-only import is erased before anything runs, so a route that imports
 * only a `type` from the browser layer launches nothing and needs no binaries
 * packaged beside it. Counting it would demand 3009 MB for a route that
 * returns JSON.
 *
 * Three patterns run independently rather than as one alternation, and that is
 * a fix rather than a style: as a single alternation the `from` branch is tried
 * first at every position, and its lazy middle would run *across* a preceding
 * side-effect import to reach the next `from`. `import './launch';` on line 1
 * followed by any `from`-import was consumed as one match and the side effect
 * was lost — a route importing the browser purely for its side effect was
 * invisible to this whole file. Separate passes cannot swallow each other, and
 * the middle below additionally refuses quotes and semicolons so it cannot
 * leave the statement it started in.
 *
 * Dynamic `import()` counts, because it is still a call that ends in a running
 * module — `launch.ts` reaches `@sparticuz/chromium` that way itself.
 */
const SPECIFIER_PATTERNS = [
  // `import x from '…'` / `export { x } from '…'`, and never `import type`.
  /(?:^|[^.\w])(?:import|export)\s+(?!type\b)[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // `import '…'` for its side effects alone.
  /(?:^|[^.\w])import\s*['"]([^'"]+)['"]/g,
];

function specifiers(source: string): string[] {
  const out = new Set<string>();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) out.add(match[1]);
    }
  }
  return [...out];
}

/**
 * Where a specifier points, or `null` for a package.
 *
 * Two forms are followed, because the repo offers two. Relative is what every
 * `src` file happens to use today; `@/…` is the `tsconfig.json` path alias, and
 * `src/integrations/browser/README.md` teaches new call sites in exactly that
 * form — so the one thing a person is most likely to copy was the one form this
 * walk could not see. A route importing `@/integrations/browser/launch` from an
 * unpackaged path passed the guard silently.
 *
 * A bare specifier is a package and stops the walk: nothing in `node_modules`
 * imports this repo's `launch.ts`.
 *
 * An unresolvable specifier is a hard failure rather than a skip: a resolver
 * that quietly stopped resolving would report every route as browser-free and
 * this whole file would pass by finding nothing.
 */
function resolveSpecifier(from: string, spec: string, srcRoot: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else if (spec.startsWith('@/')) base = resolve(srcRoot, spec.slice('@/'.length));
  else return null;

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${from} imports '${spec}', which does not resolve to a file`);
}

/**
 * Depth-first with a `seen` set — import cycles are ordinary in this tree.
 *
 * Fully parameterised, with no defaults, so the fixture tree below can be
 * walked by the same code the repo is. Defaults were tried and removed: the
 * repo call site is a `.filter()`, which passes an array index as the second
 * argument.
 */
function reachesFrom(entry: string, launch: string, srcRoot: string): boolean {
  const target = resolve(launch);
  const seen = new Set<string>();
  const stack = [resolve(entry)];

  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    if (file === target) return true;

    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      const resolved = resolveSpecifier(file, spec, srcRoot);
      if (resolved !== null) stack.push(resolved);
    }
  }

  return false;
}

/**
 * The narrowest matcher that reads these two files, and deliberately not a
 * glob engine.
 *
 * picomatch already implements one for Next and Vercel implements another for
 * `functions`; a third here would be a third set of edge cases to disagree
 * about. So this understands exactly the two key shapes both files actually
 * use: a literal path, and one containing a single `**`.
 *
 * Two keys behave differently and neither can produce a false pass. More than
 * one `**` **throws**, because two wildcards are where a hand-rolled match and
 * a real one start disagreeing about which is greedy. A single `*` is not
 * special-cased at all — it falls through to literal comparison and simply
 * does not match, so a key using one is reported as covering nothing and the
 * route it was meant to cover fails loudly. Under-matching is the safe
 * direction; the unsafe one is claiming coverage that is not there.
 *
 * `X/**` also covers `X` itself, which is what picomatch does and is the case
 * the discovery route depends on: its page path is `/api/platform/discover`
 * exactly, with nothing beneath it.
 */
function covers(pattern: string, path: string): boolean {
  const parts = pattern.split('**');
  if (parts.length === 1) return pattern === path;
  if (parts.length > 2 || parts.some((part) => part.includes('*'))) {
    throw new Error(`this test cannot judge the config key '${pattern}'`);
  }

  const [prefix, suffix] = parts as [string, string];
  if (suffix === '' && prefix.endsWith('/') && path === prefix.slice(0, -1)) return true;
  return (
    path.length >= prefix.length + suffix.length &&
    path.startsWith(prefix) &&
    path.endsWith(suffix)
  );
}

/** `src/app/api/platform/discover/route.ts` → `/api/platform/discover`. */
function pagePath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^src\/app/, '').replace(/\/route\.ts$/, '');
}

const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  functions: Record<string, { memory?: number }>;
};

const tracingIncludes = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>;

const browserRoutes = routeFiles(API_DIR).filter((file) => reachesFrom(file, LAUNCH, SRC_ROOT));

/**
 * The walk itself, against a tree written for the purpose.
 *
 * Everything below this block asserts about the walk's *output on today's
 * tree*, and that is exactly how two silent holes survived review: no `src`
 * file uses the `@/` alias and none imports the browser purely for its side
 * effect, so a walk blind to both forms still produced the right answer today
 * and would have missed the first route that used either. The point of this
 * guard is the next person, and the next person following
 * `src/integrations/browser/README.md` writes `@/integrations/browser/…`.
 *
 * A temp directory rather than real routes: proving the walk sees a form
 * requires a file written in that form, and adding one to `src/app/api` would
 * mean shipping a route to satisfy a test.
 */
describe('the import walk', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'browser-routes-'));
    const src = join(root, 'src');
    const write = (path: string, body: string) => {
      mkdirSync(dirname(join(src, path)), { recursive: true });
      writeFileSync(join(src, path), body);
    };

    write('integrations/browser/launch.ts', 'export function launchChromium() {}\n');
    write('app/api/alias/route.ts', "import { launchChromium } from '@/integrations/browser/launch';\nexport const GET = () => launchChromium();\n");
    // The side effect first and a `from`-import after it: the order that used
    // to be swallowed. Reversed, it was always found.
    write('app/api/side-effect/route.ts', "import '../../../integrations/browser/launch';\nimport { helper } from './helper';\nexport const GET = () => helper();\n");
    write('app/api/side-effect/helper.ts', 'export function helper() {}\n');
    write('app/api/plain/route.ts', "import { helper } from '../side-effect/helper';\nexport const GET = () => helper();\n");
    // A side effect followed by a *type-only* import of the browser. The only
    // shape that tells the two halves of the fix apart: separate passes alone
    // still let the first pattern start on line 1 and run to line 2's `from`,
    // reading a type-only import as a real one.
    write('app/api/type-only/route.ts', "import './helper';\nimport type { Browser } from '@/integrations/browser/launch';\nexport const GET = (): Browser | null => null;\n");
    write('app/api/type-only/helper.ts', 'export function helper() {}\n');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const reaches = (route: string) =>
    reachesFrom(
      join(root, 'src', 'app', 'api', route, 'route.ts'),
      join(root, 'src', 'integrations', 'browser', 'launch.ts'),
      join(root, 'src'),
    );

  it('follows the `@/` alias the README tells people to use', () => {
    expect(reaches('alias')).toBe(true);
  });

  it('follows a side-effect import that comes before a named one', () => {
    expect(reaches('side-effect')).toBe(true);
  });

  // The other half: a walk that answered `true` for everything would pass both
  // cases above while asserting nothing at all.
  it('does not claim a route reaches the browser when it does not', () => {
    expect(reaches('plain')).toBe(false);
  });

  it('does not count a type-only import that follows a side-effect one', () => {
    // A `type` import is erased before anything runs. Counting this one would
    // demand 3009 MB and a packaged Chromium for a route that returns JSON —
    // and it is the case that proves the statement bound in the first pattern
    // is doing work, not just the separation into three passes.
    expect(reaches('type-only')).toBe(false);
  });
});

describe('routes that launch Chromium', () => {
  // Non-vacuity. Everything below is an assertion about a list, and a list
  // built by a resolver that silently stopped resolving would be empty — so
  // every case would pass by covering nothing. `/api/audit/run` is the oldest
  // browser route in the repo and the last one that would ever stop being one.
  it('are actually found by the import walk', () => {
    expect(browserRoutes.map(pagePath)).toContain('/api/audit/run');
  });

  it.each(browserRoutes)('%s has the browser packaged beside it', (file) => {
    const page = pagePath(file);
    const key = Object.keys(tracingIncludes).find((pattern) => covers(pattern, page));

    expect(key, `no next.config.mjs outputFileTracingIncludes key covers ${page}`).toBeDefined();
    // Both, because they are two separate production failures a week apart:
    // `playwright-core` missing `browsers.json`, then `@sparticuz/chromium`
    // missing its brotli-compressed `bin/`.
    const included = (tracingIncludes[key as string] ?? []).join('\n');
    expect(included).toContain('playwright-core');
    expect(included).toContain('@sparticuz/chromium');
  });

  it.each(browserRoutes)('%s has enough memory to launch it', (file) => {
    const path = file.replaceAll('\\', '/');
    const key = Object.keys(vercelConfig.functions).find((pattern) => covers(pattern, path));

    expect(key, `no vercel.json functions key covers ${path}`).toBeDefined();
    // A floor rather than 3009, so `vercel.json` stays the source of truth for
    // what each route costs: `report.pdf` legitimately runs at 2048, and
    // hardcoding one number here would make this test the place memory is
    // decided.
    expect(vercelConfig.functions[key as string]?.memory ?? 0).toBeGreaterThanOrEqual(2048);
  });
});
