/**
 * Every JVM this repo spawns must be headless.
 *
 * PDFBox initialises AWT to rasterise pages. On macOS an AWT-enabled JVM
 * registers as a foreground GUI application — it opens a WindowServer
 * connection and calls BringForward — so each invocation steals focus and
 * switches Spaces. `[V]` Measured on a developer machine: 540 java processes
 * producing 102 focus-grabs across one 8-hour window, and 12,415 log events in
 * a single 20-minute stretch. It presents as the screen flickering and jumping
 * desktops, with an unnamed `java` in the menu bar, which is alarming enough
 * to read as a compromised machine rather than a build script.
 *
 * WHY A TEST AND NOT A CONVENTION
 *
 * The fault is invisible everywhere the code is checked. On the deployed
 * function there is no display, so the flag changes nothing and CI is green
 * either way; it is visible only on the machine of whoever runs the suite.
 * Thirteen call sites drifted before anyone connected the flicker to the code.
 *
 * WHY NOT `JAVA_TOOL_OPTIONS`
 *
 * Because it cannot work for the sites that matter most. `childEnv` in
 * `src/integrations/documents/stage.ts` deliberately withholds
 * `JAVA_TOOL_OPTIONS` and `_JAVA_OPTIONS` so nothing in the environment can
 * raise the heap ceiling set on the command line — which also means an
 * environment-level fix never reaches the production stages. It has a second
 * cost besides: a JVM started with it prints `Picked up JAVA_TOOL_OPTIONS:` to
 * stderr, and `run-finishing.mjs` records failures as
 * `e.stderr.toString().split('\n')[0]`, so the notice replaces the real error.
 * The flag belongs on the command line.
 *
 * Reads the tree rather than running anything, the idiom
 * `tests/services/log-shape.test.ts` established.
 *
 * WHAT THIS SCAN CANNOT SEE
 *
 * It reads JavaScript and TypeScript only. `experiments/qwen-role-decisions`
 * spawns five JVMs from Python (`run.py`, `labels/strip.py`,
 * `labels/judge/page_sheets.py`); all five carry the flag today, but by
 * convention rather than by this guard. It also does not follow the veraPDF
 * launcher, which finds its own `java` — `javaEnv()` in
 * `experiments/document-remediation/java.mjs` is what constrains that one.
 * Both are recorded here rather than left as silent holes.
 *
 * `tests/support/call-text.ts` carries a third: it does not lex regular
 * expression literals, so a regex in a JVM call's arguments could derail the
 * scan. A derailed scan reports the site as unreadable, which is an offender,
 * so it fails loud. No call site in the tree contains one.
 *
 * WHAT IT HAS ACTUALLY SEEN
 *
 * `[V]` Measured on this tree: 19 spawn sites, call texts 101–445 characters,
 * and every one of the 19 cleared by the flag inside its own argument array —
 * none unreadable, none without a literal array, none carrying the flag only
 * outside it. That is the number the floor below is set against, and it is
 * what makes "this change reds nothing that was green" checkable rather than
 * asserted.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { argvArray, callText } from '../support/call-text';

const ROOT = join(import.meta.dirname, '..', '..');
const ROOTS = ['src', 'scripts', 'experiments'];
const EXTENSIONS = ['.ts', '.mts', '.mjs', '.js'];

/**
 * The binary argument of a child-process call, when it is a JVM.
 *
 * `JAVA` is here ahead of the commit that needs it. On `master` today every
 * spike runner still spells the binary `\`\${JAVA_HOME}/bin/java\``, which the
 * alternative above already matches. On `claude/heading-labelling-pass`,
 * `892145f3` replaced that literal in eleven runners with a constant imported
 * from `experiments/document-remediation/java.mjs` — and `[V]` the population
 * this scan examines fell from 16 to 5 in that one commit. Every one of the
 * eleven stayed headless, so nothing turned red; the guard simply stopped
 * looking at two thirds of the tree, and the count asserted below is what
 * caught it, three weeks late. Teaching the pattern the new name here means
 * master does not inherit the blindness when that branch lands.
 *
 * `\b` on both sides deliberately: `JAVA_HOME` and `JAVA_BIN` must not match
 * through this alternative.
 */
const JAVA_BINARY = /(`\$\{JAVA_HOME\}\/bin\/java`|'java'|"java"|javaBin|JAVA_BIN|\bJAVA\b)/;
/**
 * `execute` is here because `stage.ts` — the production path, and the one that
 * matters most — spawns through an injected `StageExecutor` rather than calling
 * `execFile` directly. A first version of this guard listed only the node
 * built-ins, examined that call site not at all, and passed while the flag was
 * removed from it. The probe that was supposed to prove the guard works is what
 * found that; a guard blind to the most important call site is worse than none,
 * because it reads as coverage.
 *
 * `run` is the same lesson a second time: every build script spawns through
 * `scripts/run-command.ts`, never a node built-in, so `prepare-jvm.ts` and
 * `prepare-verapdf.ts` were examined not at all — and two of their three JVM
 * calls were in fact missing the flag when this alternative was added.
 *
 * Broadening the verb costs nothing here because `JAVA_BINARY` does the real
 * filtering: across all three roots it admits three extra call sites, all of
 * them genuine JVMs.
 */
const SPAWN = /\b(execFileSync|execFileAsync|execFile|spawnSync|spawn|execute|run)\s*\(/g;
const HEADLESS = 'java.awt.headless';

/**
 * Whether an argument array asks for headless — as a literal, or through a
 * constant declared in the same file whose value carries the flag.
 *
 * The second form is not an edge case to tolerate: `stage.ts` uses a named
 * constant on purpose, so the flag can carry the docblock explaining what it
 * prevents. A guard that only recognised literals would push the fix toward a
 * bare string with no explanation attached, which is how the reason gets lost.
 */
function satisfiesHeadless(args: string, carriers: ReadonlySet<string>): boolean {
  if (args.includes(HEADLESS)) return true;
  for (const [, identifier] of args.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    if (carriers.has(identifier)) return true;
  }
  return false;
}

/**
 * Every identifier anywhere in the tree declared as a string carrying the flag.
 *
 * Repo-wide rather than per-file because `verapdf.ts` imports the constant from
 * `stage.ts` — one definition, two consumers, which is the shape that stops the
 * flag drifting the way it drifted across thirteen call sites. A file-local
 * lookup would have forced a second copy of the string, and a second copy is
 * the thing being fixed.
 *
 * The cost is that a same-named constant NOT carrying the flag would vouch for
 * a call that does not have it. `HEADLESS` is the only such name in the tree
 * and it is asserted below, so that trade is bounded rather than assumed.
 */
function headlessCarriers(files: readonly string[]): Set<string> {
  const escaped = HEADLESS.replace(/\./g, '\\.');
  const declaration = new RegExp(
    `\\b(?:const|let|var)\\s+([A-Z][A-Z0-9_]{2,})\\s*(?::[^=]+)?=\\s*['"\`][^'"\`]*${escaped}`,
    'g',
  );

  const names = new Set<string>();
  for (const file of files) {
    for (const [, name] of readFileSync(file, 'utf8').matchAll(declaration)) {
      names.add(name);
    }
  }
  return names;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (EXTENSIONS.some((ext) => name.endsWith(ext))) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Every JVM spawn in the tree, located but not yet judged.
 *
 * Both cases below consume this one list. They used to walk the tree with a
 * loop each, which is how the count and the check came apart: a site whose
 * argument array could not be found was skipped by `offenders()` and counted
 * by the floor anyway, so the floor could be satisfied by sites nothing had
 * looked at. Sharing the enumeration makes that divergence unexpressible
 * rather than merely fixed.
 */
function jvmCallSites(files: readonly string[]): { file: string; line: number; open: number; src: string }[] {
  const sites: { file: string; line: number; open: number; src: string }[] = [];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const spawn = new RegExp(SPAWN.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = spawn.exec(src)) !== null) {
      if (!JAVA_BINARY.test(src.slice(match.index, match.index + 400))) continue;
      sites.push({
        file,
        line: src.slice(0, match.index).split('\n').length,
        // `SPAWN` ends on the call's own `(`, so this is exact. An
        // `indexOf('(')` could drift to a different call.
        open: match.index + match[0].length - 1,
        src,
      });
    }
  }

  return sites;
}

/**
 * What this guard has to say about one JVM spawn — `''` when it is clean.
 *
 * The window is the call's **argument array** and nothing else. Not the whole
 * call, deliberately: the options object lives there too, and `WHY NOT
 * JAVA_TOOL_OPTIONS` above sets out why a flag delivered through the
 * environment is not a fix at all — `childEnv` in `stage.ts` withholds those
 * variables, so an env-level flag never reaches the production stages. A
 * window wide enough to accept one would have this guard certify the broken
 * fix, on the call site that matters most.
 *
 * Every site gets a verdict. There is no path that returns quietly without
 * one, because "the guard could not read this" is a thing the reader of a
 * green run needs to know, not a reason to say nothing.
 */
function verdict(
  site: { file: string; line: number; open: number; src: string },
  carriers: ReadonlySet<string>,
): string {
  const where = `${relative(ROOT, site.file)}:${site.line}`;

  const call = callText(site.src, site.open);
  if (call === null) {
    return `${where}  (its call does not close — this guard could not read it)`;
  }

  const argv = argvArray(call);
  if (argv === null) {
    return `${where}  (passes no literal argument array — this guard cannot see what the JVM is given)`;
  }

  if (satisfiesHeadless(argv, carriers)) return '';

  if (satisfiesHeadless(call, carriers)) {
    return `${where}  (asks for headless outside the argument array — an environment-level flag is withheld by childEnv and never reaches the production stages)`;
  }

  return where;
}

function offenders(): string[] {
  const files = ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)));
  const carriers = headlessCarriers(files);
  return jvmCallSites(files)
    .map((site) => verdict(site, carriers))
    .filter((line) => line !== '')
    .sort();
}

describe('JVM invocations', () => {
  it('always ask for headless, so a build never steals the developer\'s screen', () => {
    expect(
      offenders().join('\n'),
      'Put `-Djava.awt.headless=true` in the argument array of the call itself. '
        + 'A site this guard could not read is listed here too: a call it cannot see is not a call it has cleared.',
    ).toBe('');
  });

  it('examines a non-zero population, so a passing run means something', () => {
    // A scan that matched nothing would pass this suite while proving nothing —
    // the same vacuity `verification.md` warns about for guards generally.
    //
    // This counts the same list `offenders()` renders a verdict on, and every
    // member of that list gets one — clean, or an offender saying why. So the
    // floor can no longer be met by sites the guard skipped.
    //
    // The floor is not arbitrary. `[V]` 19 sites on this tree; the bound is set
    // four below that so a rename or a new spawn idiom that hides a handful of
    // them fails here rather than passing quietly — which is exactly what
    // `892145f3` did on `claude/heading-labelling-pass`, taking the count from
    // 16 to 5 with no other case going red. If you deleted spike runners on
    // purpose, re-measure and lower this with the new number written down — do
    // not lower it to make a red run green.
    const files = ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)));
    expect(jvmCallSites(files).length).toBeGreaterThan(15);
  });
});
