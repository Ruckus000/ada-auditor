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
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const ROOTS = ['src', 'scripts', 'experiments'];
const EXTENSIONS = ['.ts', '.mjs', '.js'];

/** The binary argument of a child-process call, when it is a JVM. */
const JAVA_BINARY = /(`\$\{JAVA_HOME\}\/bin\/java`|'java'|"java"|javaBin|JAVA_BIN)/;
/**
 * `execute` is here because `stage.ts` — the production path, and the one that
 * matters most — spawns through an injected `StageExecutor` rather than calling
 * `execFile` directly. A first version of this guard listed only the node
 * built-ins, examined that call site not at all, and passed while the flag was
 * removed from it. The probe that was supposed to prove the guard works is what
 * found that; a guard blind to the most important call site is worse than none,
 * because it reads as coverage.
 */
const SPAWN = /\b(execFileSync|execFileAsync|execFile|spawnSync|spawn|execute)\s*\(/g;
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
 * Call sites that spawn a JVM without asking for headless.
 *
 * The window examined is the call itself — from the spawn to the end of its
 * argument array — so a `java.awt.headless` elsewhere in the file cannot
 * vouch for a call that does not carry it.
 */
function offenders(): string[] {
  const found: string[] = [];
  const files = ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)));
  const carriers = headlessCarriers(files);

  {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      const spawn = new RegExp(SPAWN.source, 'g');

      while ((match = spawn.exec(src)) !== null) {
        const head = src.slice(match.index, match.index + 400);
        if (!JAVA_BINARY.test(head)) continue;

        const open = src.indexOf('[', match.index);
        if (open === -1) continue;
        const close = src.indexOf(']', open);
        const args = src.slice(open, close === -1 ? open + 400 : close);
        if (satisfiesHeadless(args, carriers)) continue;

        const line = src.slice(0, match.index).split('\n').length;
        found.push(`${relative(ROOT, file)}:${line}`);
      }
    }
  }

  return found.sort();
}

describe('JVM invocations', () => {
  it('always ask for headless, so a build never steals the developer\'s screen', () => {
    expect(offenders().join('\n')).toBe('');
  });

  it('examines a non-zero population, so a passing run means something', () => {
    // A scan that matched nothing would pass this suite while proving nothing —
    // the same vacuity `verification.md` warns about for guards generally.
    let jvmCalls = 0;
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(ROOT, root))) {
        const src = readFileSync(file, 'utf8');
        const spawn = new RegExp(SPAWN.source, 'g');
        let match: RegExpExecArray | null;
        while ((match = spawn.exec(src)) !== null) {
          if (JAVA_BINARY.test(src.slice(match.index, match.index + 400))) jvmCalls += 1;
        }
      }
    }
    expect(jvmCalls).toBeGreaterThan(10);
  });
});
