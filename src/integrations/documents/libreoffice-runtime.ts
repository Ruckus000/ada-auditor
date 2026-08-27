import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import type { Env } from './java-runtime';

/**
 * Finds LibreOffice, or says why it cannot.
 *
 * Built to the same contract as [`java-runtime.ts`](./java-runtime.ts), and for
 * the same reason: a serverless function has no LibreOffice and is not going to
 * grow one, so `available: false` is the expected production answer rather than
 * a fault. Callers get a discriminated result; nothing throws on absence.
 *
 * LibreOffice is heavier than the JVM in one way that matters here — it is a
 * desktop application being driven headlessly.
 *
 * ## The launcher is not the capability
 *
 * This used to stop at "is there a binary called `soffice`", and the comment
 * here said LibreOffice was "a single binary with nothing to fetch or compile,
 * so there is only one thing to find". That was wrong, and a container found
 * it: `libreoffice-core` installs `soffice`, `soffice --version` prints a
 * version, and **no document of any kind will load** — because Writer lives in
 * a separate package, and without it there is no module that can open a text
 * document. `[V]` Observed on Ubuntu 24.04 with `libreoffice-core` 24.2.7 and
 * no `libreoffice-writer`: every conversion, `.fodt` and `.txt` alike, to
 * `.docx` and to `.pdf`, answered `Error: source file could not be loaded` and
 * exited **0**, producing the `{kind: 'no-output', step: 'source-to-fodt'}`
 * that `convert.ts` reports. Installing `libreoffice-writer` fixed every one.
 *
 * That is the same shape `java-runtime.ts` already guards against, which is
 * why it checks the jar and the compiled classes and not only the `java`
 * binary: a launcher that starts is not a toolchain that works. Three callers
 * read this answer as a capability claim — `/api/ready`, the settings screen,
 * and `POST /api/documents/remediate`, which otherwise accepts a client's
 * upload and fails after buffering it rather than refusing at the door.
 *
 * ## Positive evidence in both directions
 *
 * The check reports `absent` only when it can see a real LibreOffice program
 * directory that has no Writer module in it. A layout it does not recognise —
 * a snap, a flatpak, an unfamiliar prefix — answers `unknown` and the runtime
 * is reported available, because turning a working host into a broken one is
 * the worse error and `convert.ts` verifies its own output regardless. Absence
 * of evidence is not evidence of absence.
 */

/** Where macOS puts it when installed as an application rather than a formula. */
const MACOS_BUNDLE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';

/**
 * Writer's own modules: `libswlo.so`, `libswuilo.so`, `libswdlo.so`.
 *
 * `[V]` `dpkg -L libreoffice-writer` on Ubuntu 24.04 ships exactly these into
 * `program/`, and `libreoffice-core` ships none of them — which is what makes
 * their absence a fact about the install rather than a guess.
 */
const WRITER_MODULE = /^(?:lib)?sw[a-z]*lo\.(?:so|dylib|dll)$/;

/**
 * Any LibreOffice module, which is how a directory proves it is the real
 * program directory rather than somewhere a file called `soffice` happens to
 * sit. `libmergedlo.so` is core's, and is present on a Writer-less install —
 * so this matches while `WRITER_MODULE` does not, which is the whole
 * distinction.
 */
const ANY_MODULE = /^(?:lib)?[a-z0-9_]+lo\.(?:so|dylib|dll)$/;

/**
 * Where a LibreOffice install keeps its modules, relative to the launcher.
 *
 * Linux and Windows put them beside it in `program/`; a macOS application
 * bundle puts the launcher in `Contents/MacOS` and the modules one level up in
 * `Contents/Frameworks`. The launcher is resolved through its symlinks first —
 * `/usr/bin/soffice` is a link into `/usr/lib/libreoffice/program`, and the
 * modules are next to the target, not next to the link.
 */
function moduleDirs(sofficeBin: string): string[] {
  let resolved: string;
  try {
    resolved = realpathSync(sofficeBin);
  } catch {
    // Raced with an uninstall, or a permission we do not have. Either way this
    // is not the place to throw — `unknown` is the honest answer.
    return [];
  }

  const beside = dirname(resolved);
  return [beside, join(dirname(beside), 'Frameworks')];
}

/**
 * Whether this install can open a text document at all.
 *
 * One `readdirSync` of a directory the operating system has almost certainly
 * cached, on the same terms as the `existsSync` calls around it: nothing is
 * memoised, so a package installed while the server is running is visible on
 * the next call rather than after a restart — the reasoning `java-runtime.ts`
 * spells out under "why nothing is cached".
 */
function writerModule(sofficeBin: string): 'present' | 'absent' | 'unknown' {
  let sawProgramDir = false;

  for (const dir of moduleDirs(sofficeBin)) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    if (entries.some((entry) => WRITER_MODULE.test(entry))) {
      return 'present';
    }
    if (entries.some((entry) => ANY_MODULE.test(entry))) {
      sawProgramDir = true;
    }
  }

  return sawProgramDir ? 'absent' : 'unknown';
}

/**
 * The launcher, once found, checked for the module that does the work.
 *
 * Split from the search so the search stays a search: every `return` below
 * that names a binary goes through here, and a fourth way of finding
 * LibreOffice added later cannot forget to.
 */
function withWriter(sofficeBin: string): LibreOfficeRuntime {
  if (writerModule(sofficeBin) === 'absent') {
    return {
      available: false,
      reason:
        `LibreOffice at ${sofficeBin} has no Writer module, so it cannot open a document ` +
        'of any kind — a core-only install. Install the Writer package (`libreoffice-writer` ' +
        'on Debian and Ubuntu) to convert Word sources.',
    };
  }

  return { available: true, sofficeBin };
}

export type LibreOfficeRuntime =
  | { available: true; sofficeBin: string }
  | { available: false; reason: string };

/**
 * What both entry points take, named once so the two cannot drift.
 *
 * `macosBundle` is injectable for the same reason `resolveJavaRuntime` takes a
 * `root`: a resolver that falls back to a fixed machine-wide path answers for
 * the machine rather than for the install under test, and a test cannot say
 * "there is no LibreOffice here" while `/Applications` disagrees. Production
 * never passes it.
 */
type ResolveOptions = { env?: Env; macosBundle?: string };

export function resolveLibreOffice(
  options: ResolveOptions = {},
): LibreOfficeRuntime {
  const env = options.env ?? process.env;
  const macosBundle = options.macosBundle ?? MACOS_BUNDLE;

  // An explicit path wins, for the same reason `JAVA_HOME` does: a machine with
  // more than one install needs a way to say which.
  const configured = env.SOFFICE_PATH?.trim();
  if (configured) {
    if (existsSync(configured)) {
      // A configured path that cannot convert is reported as such rather than
      // fallen through: the operator named this install, and quietly using a
      // different one is how a machine comes to convert with a LibreOffice
      // nobody chose. Absent is the stale-export case below; core-only is a
      // deliberate answer to a deliberate question.
      return withWriter(configured);
    }
    // Set but wrong falls through rather than failing, matching
    // `findJavaBinary`: it is nearly always a stale export, and refusing to
    // look further would turn a working machine into a broken one.
  }

  // The first *working* install on PATH wins, not the first install. A
  // core-only one is remembered so its reason can be reported if nothing
  // better turns up — a machine with a broken `/usr/bin/soffice` and a good
  // one further along PATH should use the good one.
  let coreOnly: LibreOfficeRuntime | null = null;

  const remember = (found: LibreOfficeRuntime): LibreOfficeRuntime | null => {
    if (found.available) return found;
    coreOnly ??= found;
    return null;
  };

  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'soffice');
    if (existsSync(candidate)) {
      const found = remember(withWriter(candidate));
      if (found) return found;
    }
  }

  if (existsSync(macosBundle)) {
    const found = remember(withWriter(macosBundle));
    if (found) return found;
  }

  if (coreOnly) {
    return coreOnly;
  }

  return {
    available: false,
    reason:
      'LibreOffice not found: no SOFFICE_PATH, no `soffice` on PATH, and no /Applications/LibreOffice.app. Install it to convert Word sources.',
  };
}

/** Whether source-document conversion can run here. Read by `/api/ready`. */
export function isDocumentConverterAvailable(options: ResolveOptions = {}): boolean {
  return resolveLibreOffice(options).available;
}
