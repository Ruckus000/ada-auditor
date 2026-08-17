import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
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

const API_DIR = join('src', 'app', 'api');
const LAUNCH = join('src', 'integrations', 'browser', 'launch.ts');

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
 * Dynamic `import()` counts, because it is still a call that ends in a running
 * module — `launch.ts` reaches `@sparticuz/chromium` that way itself.
 */
const SPECIFIER =
  /(?:^|[^.\w])(?:import|export)\s+(?!type\b)[\s\S]*?from\s*['"]([^'"]+)['"]|(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[^.\w])import\s*['"]([^'"]+)['"]/g;

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(SPECIFIER)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) out.push(spec);
  }
  return out;
}

/**
 * Only relative specifiers are followed. A bare one is a package, and no
 * package in `node_modules` imports this repo's `launch.ts`.
 *
 * An unresolvable relative specifier is a hard failure rather than a skip: a
 * resolver that quietly stopped resolving would report every route as
 * browser-free and this whole file would pass by finding nothing. The
 * `/api/audit/run` assertion at the bottom is the other half of that guard.
 */
function resolveRelative(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${from} imports '${spec}', which does not resolve to a file`);
}

/** Depth-first with a `seen` set — import cycles are ordinary in this tree. */
function launchesBrowser(entry: string): boolean {
  const target = resolve(LAUNCH);
  const seen = new Set<string>();
  const stack = [resolve(entry)];

  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    if (file === target) return true;

    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) stack.push(resolveRelative(file, spec));
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
 * use — a literal path, and one containing a single `**` — and *throws* on
 * anything else rather than guessing. A key this cannot read is a key nobody
 * should assume is being checked.
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

const browserRoutes = routeFiles(API_DIR).filter(launchesBrowser);

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
