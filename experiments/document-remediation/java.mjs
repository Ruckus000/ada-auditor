/**
 * The JDK every runner here shells out to — found, not assumed.
 *
 * Same order as `findJavaBinary` in `src/integrations/documents/java-runtime.ts`
 * (minus the bundled JRE, which only a deploy build assembles): `JAVA_HOME` if
 * it actually holds the tool, else the first one on `PATH`. A set-but-wrong
 * `JAVA_HOME` falls through rather than failing, for the same reason given
 * there — it is nearly always a stale export in a shell profile.
 *
 * This replaced a hardcoded `/opt/homebrew/opt/openjdk@17` fallback copied into
 * every runner, which worked on one machine and nowhere else.
 */

import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

/** Absolute path to `tool` (`java`, `javac`), or throws naming what was tried. */
export function javaTool(tool = 'java', env = process.env) {
  const home = env.JAVA_HOME?.trim();
  if (home) {
    const candidate = join(home, 'bin', tool);
    if (existsSync(candidate)) return candidate;
  }
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, tool);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`no \`${tool}\` found: JAVA_HOME is unset or wrong, and none is on PATH. Install a JDK 17+.`);
}

/** The `java` binary. Resolved once at import, like the constant it replaced. */
export const JAVA = javaTool('java');

/**
 * An environment for a child that finds `java` on its own (the veraPDF
 * launcher): the resolved JDK's `bin` first on `PATH`, so the child cannot land
 * on a different one — on macOS, the `/usr/bin/java` stub that only prints an
 * install prompt. A `JAVA_HOME` that did not supply `JAVA` is dropped, since
 * launchers consult it before `PATH`.
 */
export function javaEnv(env = process.env) {
  const { JAVA_HOME, ...rest } = env;
  const fromHome = JAVA_HOME?.trim() && JAVA === join(JAVA_HOME.trim(), 'bin', 'java');
  return { ...(fromHome ? env : rest), PATH: `${dirname(JAVA)}${delimiter}${env.PATH ?? ''}` };
}
