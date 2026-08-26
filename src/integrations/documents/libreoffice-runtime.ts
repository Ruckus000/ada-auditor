import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

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
 * desktop application being driven headlessly — and lighter in another: it is a
 * single binary with nothing to fetch or compile, so there is only one thing to
 * find.
 */

/** Where macOS puts it when installed as an application rather than a formula. */
const MACOS_BUNDLE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';

export type LibreOfficeRuntime =
  | { available: true; sofficeBin: string }
  | { available: false; reason: string };

export function resolveLibreOffice(
  options: { env?: Env } = {},
): LibreOfficeRuntime {
  const env = options.env ?? process.env;

  // An explicit path wins, for the same reason `JAVA_HOME` does: a machine with
  // more than one install needs a way to say which.
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
      'LibreOffice not found: no SOFFICE_PATH, no `soffice` on PATH, and no /Applications/LibreOffice.app. Install it to convert Word sources.',
  };
}

/** Whether source-document conversion can run here. Read by `/api/ready`. */
export function isDocumentConverterAvailable(options: { env?: Env } = {}): boolean {
  return resolveLibreOffice(options).available;
}
