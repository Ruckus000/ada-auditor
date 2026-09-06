import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rule this file enforces: a build script's child process cannot fail
 * silently, and the handful of calls exempted from that must still exist.
 *
 * `[V]` Vercel run 34002062130 died on `assembling the minimal runtime` and
 * nothing else. `jlink --strip-debug` could not exec `objcopy`, printed
 * `Cannot run program "objcopy"` to **stdout**, and `promisify(execFile)`
 * builds its rejection out of the command line alone. `prepare-libreoffice.ts`
 * had already been fixed for the same class and read only `stderr`, which
 * would have discarded a jlink failure just as completely.
 * `scripts/run-command.ts` is now the one place that formats a child failure.
 *
 * ## What this keeps that ESLint cannot
 *
 * `eslint.config.mjs` bans `promisify(execFile)` outside `run-command.ts` and
 * two exempted files, and bans `String(error).split(` across `scripts/`. A
 * syntax selector can say "this line is forbidden here". It cannot say **"this
 * line must still be here"** — and an exemption list whose entries have
 * quietly stopped matching anything is worse than none, because the next call
 * added to that file inherits an exemption nobody meant to grant.
 *
 * So the allowlist below is matched in BOTH directions. A new `execFileAsync`
 * call in `scripts/` is unallowlisted and fails; a probe that is deleted or
 * rewritten leaves an entry matching nothing and also fails. Entries are keyed
 * by the binary and its arguments — a stable slice of the call, not a line
 * number, and not the options object, so retuning a timeout is not a failure
 * while changing what runs is.
 *
 * ## What neither guard can see
 *
 * **Whether a probe's downstream gate still exists.** `ldd` is safe to ignore
 * failures from ONLY because `collectSystemLibraries` refuses on
 * `scanned === 0` and throws on `missing.size > 0` afterwards; delete those two
 * checks and the probe becomes a silent swallow with this test still green.
 * The same holds for the `dnf` probes (the same collector gate arbitrates) and
 * for the qpdf/veraPDF readings in the blind test (whose `checked: false` is
 * read by the scorer). A guard over call sites cannot reach the control flow
 * that follows them; that is what those files' own comments are for.
 */

const ROOT = 'scripts';

/** The one file allowed to build a raw promisified `execFile`. */
const FORMATTER = join('scripts', 'run-command.ts');

/**
 * Calls that stay on raw `execFile` because their FAILURE IS AN EXPECTED
 * ANSWER, not an error — each gated by something downstream that reads the
 * result. Routing one of these through `run()` would turn a normal outcome
 * into a thrown build failure.
 */
const ALLOWED_PROBES: Array<{ file: string; call: string; why: string }> = [
  {
    file: join('scripts', 'prepare-libreoffice.ts'),
    call: "execFileAsync(manager, ['--version']",
    why: 'asks whether this image has dnf/microdnf at all; absence is answered by trying the next',
  },
  {
    file: join('scripts', 'prepare-libreoffice.ts'),
    call: "execFileAsync(manager, ['install', '-y', pkg]",
    why: 'installed one at a time so a package that stopped existing skips; the ldd gate arbitrates',
  },
  {
    file: join('scripts', 'prepare-libreoffice.ts'),
    call: "execFileAsync('ldd', [candidate]",
    why: 'a static binary or a non-ELF has nothing to read; scanned===0 and missing.size>0 are the gate',
  },
  {
    file: join('scripts', 'doc-blind-test', 'run.ts'),
    call: "execFileAsync('qpdf', ['--json=2', '--json-key=qpdf', path]",
    why: 'returns undefined when qpdf is absent, so the scorer reports nothing rather than a clean sweep',
  },
  {
    file: join('scripts', 'doc-blind-test', 'run.ts'),
    // Re-keyed when the headless flag was added to this call. The reverse
    // assertion below is what forced it: the old key matched nothing, and an
    // exemption that matches nothing is one still vouching for a call that has
    // since been rewritten.
    call: "execFileAsync( 'java',",
    why: 'veraPDF exits 1 on a non-compliant file with its report on stdout; absence is `checked: false`',
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** Whitespace-insensitive, so a prettier reflow is not a false failure. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ');
}

type CallSite = { file: string; line: number; call: string };

function callSites(file: string, text: string): CallSite[] {
  const found: CallSite[] = [];
  const needle = 'execFileAsync(';
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    found.push({
      file,
      line: text.slice(0, at).split('\n').length,
      // Enough of the call to carry the binary and its arguments, which is
      // what identifies a probe. 200 characters comfortably clears the longest
      // allowlist key.
      call: normalise(text.slice(at, at + 200)),
    });
  }
  return found;
}

describe('child-process failures in build scripts', () => {
  const files = sourceFiles(ROOT);
  const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));

  it('scans a non-empty tree', () => {
    // A scan that examined nothing must not pass. Both denominators are
    // printed by the assertions that follow if they fail.
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain(FORMATTER);
  });

  it('builds a raw promisified execFile only where the allowlist says', () => {
    const permitted = new Set([FORMATTER, ...ALLOWED_PROBES.map((probe) => probe.file)]);

    const offenders = [...sources]
      .filter(([file]) => !permitted.has(file))
      .filter(([, text]) => /promisify\(\s*execFile\s*\)/.test(text))
      .map(([file]) => file);

    expect(
      offenders.join('\n'),
      'Use `run()` from scripts/run-command.ts — a hand-rolled promisify(execFile) ' +
        'rejection carries neither stdout nor stderr.',
    ).toBe('');
  });

  it('has no execFileAsync call outside the allowlist', () => {
    const sites = [...sources]
      // The formatter is what every other call delegates to; its own call is
      // the delegation, not a swallow.
      .filter(([file]) => file !== FORMATTER)
      .flatMap(([file, text]) => callSites(file, text));

    // A run that found no call sites would pass this vacuously, and would mean
    // the extraction broke rather than that the tree is clean.
    expect(sites.length).toBeGreaterThan(0);

    const unallowlisted = sites
      .filter(
        (site) =>
          !ALLOWED_PROBES.some(
            (probe) => probe.file === site.file && site.call.startsWith(normalise(probe.call)),
          ),
      )
      .map((site) => `${site.file}:${site.line}  ${site.call.slice(0, 90)}`);

    expect(
      unallowlisted.join('\n'),
      'Route this through `run()` from scripts/run-command.ts, or add it to ALLOWED_PROBES ' +
        'with the downstream gate that makes ignoring its failure safe.',
    ).toBe('');
  });

  it('has an allowlist with no entry that matches nothing', () => {
    // The direction ESLint cannot express. A probe that is deleted or
    // rewritten must fail HERE, rather than leaving behind an exemption that
    // silently covers whatever is added to that file next.
    const sites = [...sources].flatMap(([file, text]) => callSites(file, text));

    const stale = ALLOWED_PROBES.filter(
      (probe) =>
        !sites.some(
          (site) => site.file === probe.file && site.call.startsWith(normalise(probe.call)),
        ),
    ).map((probe) => `${probe.file}  ${probe.call}`);

    expect(
      stale.join('\n'),
      'This allowlist entry matches no call. If the probe was removed, remove the entry; ' +
        'if it was rewritten, re-key the entry and re-check that its downstream gate still exists.',
    ).toBe('');
  });
});
