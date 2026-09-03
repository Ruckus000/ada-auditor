import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { normalizeAppPath } from 'next/dist/shared/lib/router/utils/app-paths';
import picomatch from 'picomatch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';
import { MAX_RUN_DURATION_MS } from '../../src/domain/run-limits';

/**
 * The deployment config knows something the code does not, and nothing checks it.
 *
 * `next.config.mjs` names which routes get the browser packaged beside them;
 * `vercel.json` names which get enough memory to launch it — though see the
 * memory assertion below, because on this project that half is currently
 * declarative only. Both are keyed by
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
 * module — `launch.ts` reaches `@sparticuz/chromium` that way itself. Only with
 * a *literal* specifier, though: `import(someVariable)` is a known residual
 * hole rather than an oversight, and not one any static reader can close. A
 * route that reaches the browser through a computed specifier is invisible to
 * this file.
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

  // A NodeNext-style specifier names the *emitted* file, so `./foo.js` has to
  // be tried as `./foo.ts` as well. No `src` file writes one today; without
  // this the first that did would fail a deploy test with a resolution error,
  // which is a confusing tripwire for something that is not the bug this file
  // hunts. `base` itself covers a literal hit such as a `.json` import.
  const stem = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
  for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
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
 * How Next decides, using Next's own decider.
 *
 * `collect-build-traces.js` computes `picomatch(key, { dot: true, contains: true })`
 * and tests it against `normalizeAppPath(entryName)`. Both halves are imported
 * here rather than modelled, and that is the whole point: a hand-rolled matcher
 * stood here first and over-matched two shapes, because picomatch treats `**`
 * as a globstar only when a `/` or a string boundary delimits it. The strongest
 * evidence that this corner is not worth re-deriving is that Node's own
 * `path.matchesGlob` disagrees with picomatch on the very key this repo
 * ships — picomatch matches `/api/platform/discover` against
 * `/api/platform/discover/**`, and `path.matchesGlob` does not. Only the
 * production matcher is authoritative.
 *
 * `contains: true` is load-bearing and easy to miss: the subject is
 * `/app/api/…`, not `/api/…`, so `/api/audit/**` matches by being *contained*
 * in it. A test that compared against `/api/…` would be modelling a string Next
 * never builds.
 *
 * The deep import into `next/dist` is the accepted cost. It is typed, and if a
 * Next upgrade moves it this file fails to compile — loudly, which is the only
 * failure mode acceptable for the thing that decides whether Chromium ships.
 */
function nextCovers(key: string, route: string): boolean {
  return picomatch(key, { dot: true, contains: true })(route);
}

/**
 * How Vercel decides — modelled, because its matcher is not picomatch.
 *
 * `functions` keys are globs and Vercel resolves them server-side, so nothing
 * importable here is authoritative. picomatch without `contains` is the closest
 * available model, and it is acceptable only for the shapes actually in use:
 * literal paths, `*`, and `**`. On those, picomatch is at worst *stricter* than
 * a matcher that let a wildcard cross `/` — and stricter is the safe direction
 * here, because this file only ever asks "is this route covered?", so a model
 * that matches less reports a missing entry that is in fact present: loud and
 * wrong-but-safe, against a failure mode of a route covered by nothing at all.
 *
 * That argument does **not** extend to brace expansion or extglobs, which
 * picomatch enables by default and Vercel may not support at all. There the
 * disagreement runs the other way — picomatch would match *more* — so those
 * keys are refused below rather than modelled. None are in use; the throw is
 * what keeps that true.
 *
 * The discovery key is a literal path, so for the route Task 7 adds the
 * question does not arise.
 */
function vercelCovers(key: string, filePath: string): boolean {
  // Refused, not approximated. The hand-rolled matcher that stood here threw
  // on shapes outside its competence, and swapping in picomatch quietly
  // dropped that guard: picomatch applies its own semantics to anything it is
  // handed, so the safety property above became an argument rather than a
  // structural fact. This restores it.
  const unmodelled = [...'{(!+'].find((character) => key.includes(character));
  if (unmodelled !== undefined) {
    throw new Error(
      `vercel.json functions key '${key}' uses '${unmodelled}', a brace or extglob shape this ` +
        `test does not model. picomatch would match more than Vercel might, which is the unsafe ` +
        `direction — establish what Vercel does with it before relying on this test.`,
    );
  }
  return picomatch(key, { dot: true })(filePath);
}

/**
 * `src/app/api/platform/discover/route.ts` → `/app/api/platform/discover`.
 *
 * `normalizeAppPath` is Next's, imported rather than approximated, because the
 * transformations it performs are not guessable from the file path: it drops
 * `(group)` and `@slot` segments as well as the trailing `route`. This repo
 * already uses route groups (`src/app/(platform)/`), and approximating this was
 * worse than a false negative — a route at `api/(browser)/heavy/route.ts` would
 * have been reported as `/api/(browser)/heavy`, and the obvious fix is a
 * `next.config.mjs` key spelled the same way. That key would satisfy this test
 * and match nothing at build time, because Next asks about `/app/api/heavy`.
 * The guard would have handed someone a fix that deploys without Chromium.
 */
function routePath(file: string): string {
  return normalizeAppPath(file.replaceAll('\\', '/').replace(/^src\//, '').replace(/\.ts$/, ''));
}

const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  functions: Record<string, { memory?: number; maxDuration?: number }>;
};

const tracingIncludes = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>;
const tracingExcludes = (nextConfig.outputFileTracingExcludes ?? {}) as Record<string, string[]>;

const browserRoutes = routeFiles(API_DIR).filter((file) => reachesFrom(file, LAUNCH, SRC_ROOT));

/**
 * The other half of tracing: what a function must NOT carry.
 *
 * `libreoffice-runtime.ts` reads the host's filesystem at paths it cannot know
 * until runtime — a `PATH` entry, a wrapper script's target — and Turbopack's
 * answer to a path it cannot resolve is to trace the whole project. Measured
 * on 2026-09-03: every function importing it carried the tests, the docs, the
 * experiments spike and the scripts, ~1,200 entries a function has no use for
 * — and, on a tree holding the blind corpus, real municipal documents inside
 * a deployed function. `outputFileTracingExcludes` is the lever that names
 * those directories as never-a-dependency; `platform-hydration.test.ts` reads
 * the built traces and holds the result. This case holds the config, so the
 * cheap suite says so before anyone builds.
 */
describe('what the tracer is told to leave out', () => {
  it('names every directory no function could need', () => {
    const everywhere = (tracingExcludes['*'] ?? []).join('\n');

    // Each is a distinct way for the whole project to ride along: the spike
    // and its corpora, the suites, the prose, the fixture sites, the operator
    // scripts, run output, and blind-test output derived from real documents.
    for (const junk of [
      './experiments/**',
      './tests/**',
      './docs/**',
      './fixtures/**',
      './scripts/**',
      './artifacts/**',
      './.doc-blind-test/**',
    ]) {
      expect(everywhere, `outputFileTracingExcludes['*'] omits ${junk}`).toContain(junk);
    }
  });
});

/**
 * The same problem, a different binary.
 *
 * A route that spawns a JVM needs a runtime, PDFBox and the compiled stages
 * packaged beside it. Nothing in the route says so — the knowledge lives in
 * `next.config.mjs` — which is the exact shape that cost this project two
 * production failures with Chromium.
 *
 * Anchored on `stage.ts`, which is where the JVM is actually spawned, for the
 * same reason the browser rule anchors on `launch.ts` rather than on anything
 * that merely mentions a browser. `java-runtime.ts` would be the wrong anchor
 * and the first run of this rule proved it: `/api/ready` imports it to *stat* a
 * path for `documentToolchainAvailable` and spawns nothing, so keying on it
 * demanded a 40MB runtime beside a health check.
 */
const JVM_SPAWN = join(SRC_ROOT, 'integrations', 'documents', 'stage.ts');

const jvmRoutes = routeFiles(API_DIR).filter((file) => reachesFrom(file, JVM_SPAWN, SRC_ROOT));

/**
 * The third binary, and the one whose absence is quietest.
 *
 * A route that converts spawns `soffice` as well as a JVM, and the two are
 * packaged by different keys. A converting route covered only by a JVM entry
 * deploys clean, passes every suite, and then refuses every request with
 * `converter_unavailable` — which reads as a *host* that cannot convert rather
 * than a deployment that forgot something, so it would be believed.
 *
 * Anchored on `convert.ts`, where `soffice` is actually spawned, for the same
 * reason the JVM rule anchors on `stage.ts`: `libreoffice-runtime.ts` would be
 * the wrong anchor, because `/api/ready` imports it to stat a path and spawns
 * nothing.
 */
const SOFFICE_SPAWN = join(SRC_ROOT, 'integrations', 'documents', 'convert.ts');

const convertingRoutes = routeFiles(API_DIR).filter((file) =>
  reachesFrom(file, SOFFICE_SPAWN, SRC_ROOT),
);

/** `export const maxDuration = 300;` in a route file, or `null` when absent. */
function exportedMaxDuration(file: string): number | null {
  const match = /export const maxDuration\s*=\s*(\d+)\s*;/.exec(readFileSync(file, 'utf8'));
  return match ? Number(match[1]) : null;
}

/**
 * How long a function may run has one home, and it is the route file.
 *
 * `vercel.json` can also carry `maxDuration`, and for three weeks it did — 600
 * on the three converting routes, while those files exported 300. Two sources
 * for one number is how a document about the ceiling comes to be wrong: every
 * timeout, stale-run window and reserve in this tree is derived from 300
 * (`MAX_RUN_DURATION_MS`), and a config file saying otherwise beside them is
 * either inert or contradicting them, and nothing said which. `docs/env.md`
 * states the rule; this is what keeps it true.
 */
describe('how long a function may run', () => {
  it('is declared in the route files and never in vercel.json', () => {
    for (const [key, entry] of Object.entries(vercelConfig.functions)) {
      expect(entry.maxDuration, `${key} sets maxDuration in vercel.json`).toBeUndefined();
    }
  });

  it('never exceeds the ceiling the rest of the tree is derived from', () => {
    const declared = routeFiles(join(SRC_ROOT, 'app'))
      .map((file) => [file, exportedMaxDuration(file)] as const)
      .filter((pair): pair is readonly [string, number] => pair[1] !== null);

    expect(declared.length, 'no route declares a maxDuration').toBeGreaterThan(0);
    for (const [file, seconds] of declared) {
      expect(seconds, file).toBeLessThanOrEqual(MAX_RUN_DURATION_MS / 1000);
    }
  });
});

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
    // A NodeNext-style specifier: it names the emitted `.js`, and only the
    // `.ts` exists on disk.
    write('app/api/emitted-extension/route.ts', "import { launchChromium } from './launcher.js';\nexport const GET = () => launchChromium();\n");
    write('app/api/emitted-extension/launcher.ts', "export { launchChromium } from '../../../integrations/browser/launch';\n");
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

  it('follows a specifier that names the emitted `.js`', () => {
    // NodeNext style. Nothing in `src` writes one today; without the fallback
    // the first that did would fail this deploy test with a module-resolution
    // error, which is a confusing tripwire for something that is not the bug
    // this file hunts.
    expect(reaches('emitted-extension')).toBe(true);
  });

  it('does not count a type-only import that follows a side-effect one', () => {
    // A `type` import is erased before anything runs. Counting this one would
    // demand 3009 MB and a packaged Chromium for a route that returns JSON —
    // and it is the case that proves the statement bound in the first pattern
    // is doing work, not just the separation into three passes.
    expect(reaches('type-only')).toBe(false);
  });
});

describe('the path Next matches keys against', () => {
  it('drops a route group, as `normalizeAppPath` does', () => {
    // This repo already uses route groups, and a route path carrying one would
    // invite a `next.config.mjs` key spelled the same way: green here, matching
    // nothing at build time, deployed without Chromium.
    expect(routePath(join('src', 'app', 'api', '(browser)', 'heavy', 'route.ts'))).toBe('/app/api/heavy');
  });

  it('keeps the dynamic segments, which are part of the path Next asks about', () => {
    expect(routePath(join('src', 'app', 'api', 'audit', 'runs', '[requestId]', 'report.pdf', 'route.ts'))).toBe(
      '/app/api/audit/runs/[requestId]/report.pdf',
    );
  });

  it('does not treat an undelimited `**` as a globstar', () => {
    // The two shapes the hand-rolled matcher that stood here got wrong: it
    // split on `**` and let the wildcard cross `/` unconditionally. picomatch
    // makes `**` a globstar only when a `/` or a string boundary delimits it,
    // so `**runs` degrades to `*runs` and stays inside one segment.
    expect(vercelCovers('src/app/api/**runs/route.ts', 'src/app/api/platform/x/runs/route.ts')).toBe(false);
    expect(nextCovers('src/app/api/**runs/route.ts', 'src/app/api/platform/x/runs/route.ts')).toBe(false);
    expect(vercelCovers('/api/audit**', '/api/audity/z/route')).toBe(false);
  });

  it('refuses a `vercel.json` key shape it does not model', () => {
    const key = 'src/app/api/{audit,platform}/**';

    // The reason the guard is worth having: picomatch expands the brace
    // happily, so without the throw this file would silently report the route
    // as covered on the strength of picomatch's semantics rather than
    // Vercel's — and unlike `*` and `**`, that disagreement runs in the unsafe
    // direction.
    expect(picomatch(key, { dot: true })('src/app/api/audit/run/route.ts')).toBe(true);
    expect(() => vercelCovers(key, 'src/app/api/audit/run/route.ts')).toThrow(/does not model/);
  });

  it('matches a key against the `/app`-prefixed path, which needs `contains`', () => {
    // The subject is `/app/api/…`; without `contains: true` no key in
    // `next.config.mjs` would match anything, and this file would fail closed
    // for the wrong reason.
    expect(nextCovers('/api/audit/**', '/app/api/audit/run')).toBe(true);
    expect(picomatch('/api/audit/**', { dot: true })('/app/api/audit/run')).toBe(false);
  });
});

describe('routes that launch Chromium', () => {
  // Non-vacuity. Everything below is an assertion about a list, and a list
  // built by a resolver that silently stopped resolving would be empty — so
  // every case would pass by covering nothing. `/api/audit/run` is the oldest
  // browser route in the repo and the last one that would ever stop being one.
  it('are actually found by the import walk', () => {
    expect(browserRoutes.map(routePath)).toContain('/app/api/audit/run');
  });

  it.each(browserRoutes)('%s has the browser packaged beside it', (file) => {
    const page = routePath(file);
    const key = Object.keys(tracingIncludes).find((pattern) => nextCovers(pattern, page));

    expect(key, `no next.config.mjs outputFileTracingIncludes key covers ${page}`).toBeDefined();
    // Both, because they are two separate production failures a week apart:
    // `playwright-core` missing `browsers.json`, then `@sparticuz/chromium`
    // missing its brotli-compressed `bin/`.
    const included = (tracingIncludes[key as string] ?? []).join('\n');
    expect(included).toContain('playwright-core');
    expect(included).toContain('@sparticuz/chromium');
  });

  /**
   * Asserts what the config *says*, which on this project is not what runs.
   *
   * A preview deploy on 2026-08-17 answered:
   *
   *   Provided `memory` setting in `vercel.json` is ignored on Active CPU
   *   billing.
   *
   * So every number below is currently declarative. Under Fluid Compute memory
   * comes from the plan, and whether a browser route has enough of it is an
   * empirical question — the first real crawl either launches Chromium or does
   * not. `docs/env.md` carries the full note and the reason the setting is kept
   * rather than deleted.
   *
   * This assertion stays for the same reason the setting does: it is correct
   * for any deployment not on Active CPU billing, and it keeps a *new* browser
   * route from being added with no memory declaration at all — which would be a
   * real gap the day billing changes. What it must not be read as is proof that
   * the function can launch a browser. Only the tracing assertion above proves
   * something the platform currently honours.
   */
  it.each(browserRoutes)('%s declares the memory it would need to launch one', (file) => {
    const path = file.replaceAll('\\', '/');
    const key = Object.keys(vercelConfig.functions).find((pattern) => vercelCovers(pattern, path));

    expect(key, `no vercel.json functions key covers ${path}`).toBeDefined();
    // A floor rather than 3009, so `vercel.json` stays the source of truth for
    // what each route costs: `report.pdf` legitimately runs at 2048, and
    // hardcoding one number here would make this test the place memory is
    // decided.
    expect(vercelConfig.functions[key as string]?.memory ?? 0).toBeGreaterThanOrEqual(2048);
  });
});

describe('routes that spawn a JVM', () => {
  // Non-vacuity, for the reason the browser block gives: a list built by a
  // resolver that quietly stopped resolving is empty, and every case below
  // would pass by covering nothing.
  it('are actually found by the import walk', () => {
    expect(jvmRoutes.length, 'no route reaches java-runtime.ts').toBeGreaterThan(0);
  });

  it.each(jvmRoutes)('%s has the Java runtime packaged beside it', (file) => {
    const page = routePath(file);
    const key = Object.keys(tracingIncludes).find((pattern) => nextCovers(pattern, page));

    expect(key, `no next.config.mjs outputFileTracingIncludes key covers ${page}`).toBeDefined();

    // Three separate things, because missing any one of them is its own
    // production failure with its own confusing error: no runtime to exec, no
    // PDFBox to load, or no compiled stage to run.
    const included = (tracingIncludes[key as string] ?? []).join('\n');
    expect(included, 'the jlink-assembled runtime').toContain('vendor/jre');
    expect(included, 'PDFBox').toContain('pdfbox-app');
    expect(included, 'the compiled stages').toContain('dist/documents/classes');
    // The second instrument travels with the first: every route that reads a
    // document also validates it, and a deployment without the checker would
    // answer "conformance not checked" on every reading — honest, but a
    // regression nobody chose.
    expect(included, 'the conformance checker').toContain('vendor/verapdf');
  });
});

describe('routes that convert with LibreOffice', () => {
  it('are actually found by the import walk', () => {
    expect(convertingRoutes.length, 'no route reaches convert.ts').toBeGreaterThan(0);
  });

  it.each(convertingRoutes)('%s has LibreOffice packaged beside it', (file) => {
    const page = routePath(file);
    const key = Object.keys(tracingIncludes).find((pattern) => nextCovers(pattern, page));

    expect(key, `no next.config.mjs outputFileTracingIncludes key covers ${page}`).toBeDefined();

    const included = (tracingIncludes[key as string] ?? []).join('\n');
    expect(included, 'the bundled LibreOffice').toContain('vendor/libreoffice');
    // A conversion is two `soffice` runs AND two Java stages — `Finish` writes
    // the XMP packet, `Inspect` is what catches a silently untagged export. A
    // key carrying one binary and not the other fails at a different step but
    // fails just as completely.
    expect(included, 'the jlink-assembled runtime').toContain('vendor/jre');
  });

  it('each declares how long it may run, in the route file', () => {
    // A JVM and a converter are the two things on this tree that take real
    // wall-clock; a route that spawns one without saying its ceiling gets the
    // platform default, which has changed twice.
    for (const file of new Set([...jvmRoutes, ...convertingRoutes])) {
      expect(exportedMaxDuration(file), `${file} exports no maxDuration`).not.toBeNull();
    }
  });

  it('never carries LibreOffice on a route that only reads', () => {
    // The inverse witness, and the reason the keys are ordered rather than
    // merged: `inspect` and `inspect-url` spawn a JVM and no converter, so a
    // 440MB payload beside them is 440MB of cold start bought for nothing.
    const readOnly = jvmRoutes.filter((file) => !convertingRoutes.includes(file));
    expect(readOnly.length, 'no read-only JVM route to check').toBeGreaterThan(0);

    for (const file of readOnly) {
      const page = routePath(file);
      const key = Object.keys(tracingIncludes).find((pattern) => nextCovers(pattern, page));
      const included = (tracingIncludes[key as string] ?? []).join('\n');
      expect(included, `${page} should not carry LibreOffice`).not.toContain('vendor/libreoffice');
    }
  });
});
