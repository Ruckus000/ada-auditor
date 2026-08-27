import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import type { Env } from './java-runtime';

/**
 * Finds LibreOffice, or says why it cannot.
 *
 * Built to the same contract as [`java-runtime.ts`](./java-runtime.ts), and for
 * the same reason: a caller gets a discriminated result and nothing throws on
 * absence, because a host without LibreOffice is a state rather than a fault.
 *
 * LibreOffice is heavier than the JVM in one way that matters here — it is a
 * desktop application being driven headlessly — and lighter in another: it is a
 * single tree with nothing to fetch or compile beside it, so there is only one
 * thing to find.
 *
 * ## The deployed runtime is no longer absent
 *
 * This file used to say a serverless function "has no LibreOffice and is not
 * going to grow one". That was true of a 250MB function; Vercel's large
 * functions raise the ceiling to 5GB, and `scripts/prepare-libreoffice.ts`
 * assembles a 440MB headless install during a Vercel build. `available: false`
 * is still the honest answer anywhere nothing was bundled and no host install
 * exists — a developer machine without it, `/api/ready`, every route that does
 * not carry the payload — but it is no longer the *expected* production answer
 * for the routes that convert.
 */

/** Where macOS puts it when installed as an application rather than a formula. */
const MACOS_BUNDLE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';

/**
 * A headless LibreOffice shipped beside the function, built by
 * `scripts/prepare-libreoffice.ts` during a Vercel build.
 *
 * Sits beside `BUNDLED_JRE_DIR` under the already-ignored `vendor/`, because
 * one conversion needs both: two `soffice` runs and two JVM stages.
 */
export const BUNDLED_SOFFICE_DIR = join('vendor', 'libreoffice');

/**
 * Inside the bundled install: the shared libraries collected from the build
 * image because the function runtime may not carry them.
 *
 * Dot-prefixed so it cannot collide with anything LibreOffice's own tree
 * names, and exported so the build script and the resolver cannot disagree
 * about where it is.
 */
export const SYSTEM_LIBRARY_DIR = '.syslibs';

export type LibreOfficeRuntime =
  | {
      available: true;
      sofficeBin: string;
      /**
       * Set only for the bundled install, and only as an addition to whatever
       * the environment already has. A host LibreOffice was installed by a
       * package manager that already resolved its libraries; telling the
       * dynamic loader otherwise could only break it.
       */
      libraryPath?: string;
    }
  | { available: false; reason: string };

export function resolveLibreOffice(
  options: { env?: Env; root?: string } = {},
): LibreOfficeRuntime {
  const root = options.root ?? process.cwd();
  const env = options.env ?? process.env;

  // The bundled install wins, because if it is present somebody put it there
  // on purpose: a build assembled it for this deployment, and it is the one
  // whose package selection has been verified against these stages.
  const bundled = join(root, BUNDLED_SOFFICE_DIR, 'program', 'soffice');
  if (existsSync(bundled)) {
    return {
      available: true,
      sofficeBin: bundled,
      libraryPath: join(root, BUNDLED_SOFFICE_DIR, SYSTEM_LIBRARY_DIR),
    };
  }

  // An explicit path next, for the same reason `JAVA_HOME` comes before
  // `PATH`: a machine with more than one install needs a way to say which.
  const configured = env.SOFFICE_PATH?.trim();
  if (configured) {
    if (existsSync(configured)) {
      return { available: true, sofficeBin: configured };
    }
    // Set but wrong falls through rather than failing, matching
    // `findJavaBinary`: it is nearly always a stale export, and refusing to
    // look further would turn a working machine into a broken one.
  }

  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'soffice');
    if (existsSync(candidate)) {
      return { available: true, sofficeBin: candidate };
    }
  }

  if (existsSync(MACOS_BUNDLE)) {
    return { available: true, sofficeBin: MACOS_BUNDLE };
  }

  return {
    available: false,
    reason:
      `LibreOffice not found: nothing bundled at ${BUNDLED_SOFFICE_DIR}, no SOFFICE_PATH, no \`soffice\` on PATH, and no /Applications/LibreOffice.app. Install it to convert Word sources.`,
  };
}

/** Whether source-document conversion can run here. Read by `/api/ready`. */
export function isDocumentConverterAvailable(
  options: { env?: Env; root?: string } = {},
): boolean {
  return resolveLibreOffice(options).available;
}
