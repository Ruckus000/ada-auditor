import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Finds the JVM and classpath the document stages need, or says why it cannot.
 *
 * ## Absence is a state, not an error
 *
 * Vercel functions have no Java runtime and are not going to grow one in this
 * slice, so "no JVM here" is the *expected* answer in production, not a fault.
 * That is why this returns a discriminated result instead of throwing — the
 * same split `ArtifactRead` makes in `src/domain/artifacts.ts`, where evidence
 * deleted on schedule answers `pruned` rather than "not found", because telling
 * an operator the wrong one sends them hunting a bug that is not there.
 *
 * A caller that treats `available: false` as a crash has misread the contract.
 * The document pipeline runs where a toolchain exists — a developer machine, CI,
 * an operator's box — and is cleanly absent everywhere else, exactly as the AI
 * advisory is absent without a way to reach the AI Gateway.
 *
 * ## Why nothing is cached
 *
 * Resolution is a handful of `existsSync` calls. Caching would save nothing
 * measurable and would pin the first answer for the life of the process, so a
 * toolchain built *after* the server started would stay invisible until a
 * restart — which is precisely what a developer does while wiring this up.
 */

/** Pinned to match `experiments/document-remediation/fetch-tools.sh`. */
export const PDFBOX_VERSION = '3.0.8';

/**
 * The Java sources `npm run build:documents` compiles.
 *
 * Exported beside the output path because three places need to name it — the
 * build script, the test that keeps the spike compiling against these sources,
 * and the staleness check that refuses to run the document suite against
 * classes older than them. Three copies of a path is how one of them ends up
 * pointing somewhere else after a move.
 */
export const DOCUMENT_JAVA_DIR = join('src', 'integrations', 'documents', 'java');

/** Where `npm run build:documents` writes, under the already-ignored `dist/`. */
export const DOCUMENT_CLASSES_DIR = join('dist', 'documents', 'classes');

/** Where `fetch-tools.sh` puts the pinned jar. */
export const PDFBOX_JAR = join('vendor', `pdfbox-app-${PDFBOX_VERSION}.jar`);

/**
 * The JPEG 2000 ImageIO decoder, and the `jai-imageio-core` it is built on.
 *
 * `pdfbox-app` is a fat jar and already carries a JBIG2 decoder
 * (`org.apache.pdfbox.jbig2`, registered as an ImageIO SPI), but nothing for
 * `JPXDecode`. Without these two jars PDFBox logs a warning (`[V]` for a JPX
 * whose dictionary omits the optional `/ColorSpace`: "could not determine
 * color space") and paints NOTHING where the image was, at exit 0 — so a
 * JPX page previews as a white sheet and `Contrast` samples a white
 * background that is not there. `[V]` 2026-09-30: yellow text over a black
 * JPX image measured 1.07:1 against white — a failure invented by a missing
 * codec — and passes with the decoder present (19.56:1 by the formula).
 *
 * Versions are the ones PDFBox 3.0.8's own `pdfbox-parent` pins
 * (`jai.version` 1.4.0). One table carries each jar's path, source and
 * SHA-256 (taken 2026-09-30, cross-checked against Central's `.sha1`), so the
 * resolver and `build-documents.ts` — which fetches, verifies, and records the
 * licences — cannot pair a file name with the wrong bytes.
 *
 * Core first only for reading order; ImageIO finds both through their SPI
 * files, so classpath position does not matter.
 */
export const JPX_DECODER = [
  {
    path: join('vendor', 'imageio', 'jai-imageio-core-1.4.0.jar'),
    url: 'https://repo1.maven.org/maven2/com/github/jai-imageio/jai-imageio-core/1.4.0/jai-imageio-core-1.4.0.jar',
    sha256: '8ad3c68e9efffb10ac87ff8bc589adf64b04a729c5194c079efd0643607fd72a',
  },
  {
    path: join('vendor', 'imageio', 'jai-imageio-jpeg2000-1.4.0.jar'),
    url: 'https://repo1.maven.org/maven2/com/github/jai-imageio/jai-imageio-jpeg2000/1.4.0/jai-imageio-jpeg2000-1.4.0.jar',
    sha256: '07fb6e3a3040122b846c5e52520033175c3251e2ec8830df82f87cb21f388bb1',
  },
] as const;

/**
 * Why a stage that RENDERS pages cannot run here, or `null` when it can.
 *
 * Only `Preview` and `Contrast` rasterise; `Inspect`, `Finish`, the archive
 * and veraPDF never decode an image, so a missing decoder must not take them
 * down with it. `spawnStage` refuses a rendering stage on this answer rather
 * than let it report on a blank page.
 */
export function missingJpxDecoder(root: string = process.cwd()): string | null {
  const missing = JPX_DECODER.find((jar) => !existsSync(join(root, jar.path)));
  return missing
    ? `the JPEG 2000 decoder is missing at ${missing.path}, so JPX pages would render blank. Run \`npm run build:documents\`.`
    : null;
}

/**
 * The Liberation font family, fetched pinned-and-checksummed by
 * `build-documents.ts` — metric-compatible replacements for the Windows faces
 * real PDFs name without embedding (Arial, Times New Roman, Courier New).
 * `Finish --embed-fonts` reads programs from here; absent, it embeds nothing
 * and every punch item stays, which is the safe direction.
 */
export const DOCUMENT_FONTS_DIR = join('vendor', 'fonts', 'liberation');

/**
 * A minimal Java runtime shipped beside the function, built by
 * `scripts/prepare-jvm.ts` during a Vercel build.
 *
 * `[V]` 40MB, assembled by `jlink` from exactly the modules `jdeps` reports our
 * stages touch, and byte-identical in output to a full JDK. That is what makes
 * the reading half of this pipeline deployable when the converting half — 794MB
 * of LibreOffice — is not.
 */
export const BUNDLED_JRE_DIR = join('vendor', 'jre');

/**
 * The slice of the environment this module reads.
 *
 * Deliberately looser than `NodeJS.ProcessEnv`, which Next's types make
 * `NODE_ENV`-bearing and therefore impossible to construct in a test that cares
 * about two keys. Same shape and same reason as `Env` in
 * `services/deployment-config.ts`.
 */
export type Env = Record<string, string | undefined>;

export type JavaRuntime =
  /**
   * `renderGap`, when present, says why stages that render pages must not run
   * on this runtime (see `missingJpxDecoder`). Absent means nothing is missing,
   * which is also what a runtime a test constructs means.
   */
  | { available: true; javaBin: string; classpath: string; renderGap?: string }
  | { available: false; reason: string };

/**
 * The `java` binary, preferring `JAVA_HOME` and falling back to `PATH`.
 *
 * `JAVA_HOME` first because that is what the spike's runners use and what a
 * machine with several JDKs installed uses to pick one. `PATH` after, so a
 * plain Homebrew or system install works with no configuration at all.
 */
function findJavaBinary(env: Env, root: string): string | null {
  // The bundled runtime wins, because if it is present somebody put it there
  // on purpose: a build assembled it for this deployment, and it is the one
  // whose module set has been verified against these stages.
  const bundled = join(root, BUNDLED_JRE_DIR, 'bin', 'java');
  if (existsSync(bundled)) {
    return bundled;
  }

  const home = env.JAVA_HOME?.trim();
  if (home) {
    const candidate = join(home, 'bin', 'java');
    if (existsSync(candidate)) {
      return candidate;
    }
    // A set-but-wrong JAVA_HOME falls through to PATH rather than failing. It
    // is nearly always a stale export in a shell profile, and refusing to look
    // further would turn a working machine into a broken one.
  }

  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'java');
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Resolves the whole toolchain.
 *
 * Each missing piece gets its own message, because the fixes are different and
 * unrelated: install a JDK, run the fetch script, run the build. One generic
 * "document toolchain unavailable" would make a person guess which.
 *
 * `root` defaults to `process.cwd()`, matching how the browser integration
 * resolves fixture and artifact directories.
 */
export function resolveJavaRuntime(
  options: { root?: string; env?: Env } = {},
): JavaRuntime {
  const root = options.root ?? process.cwd();
  const env = options.env ?? process.env;

  const javaBin = findJavaBinary(env, root);
  if (!javaBin) {
    return {
      available: false,
      reason:
        `no Java runtime found: nothing bundled at ${BUNDLED_JRE_DIR}, JAVA_HOME is unset or wrong, and no \`java\` is on PATH. Install a JDK 17+ to run document stages.`,
    };
  }

  const jar = join(root, PDFBOX_JAR);
  if (!existsSync(jar)) {
    return {
      available: false,
      reason: `PDFBox ${PDFBOX_VERSION} is missing at ${PDFBOX_JAR}. Run experiments/document-remediation/fetch-tools.sh to download it.`,
    };
  }

  const classes = join(root, DOCUMENT_CLASSES_DIR);
  if (!existsSync(classes)) {
    return {
      available: false,
      reason: `document stages are not compiled at ${DOCUMENT_CLASSES_DIR}. Run \`npm run build:documents\`.`,
    };
  }

  // Classpath order matters only for duplicate class names, which there are
  // none of; jar first matches the spike's runners so the two cannot diverge.
  //
  // The decoder goes on whole or not at all. `[V]` The JPEG 2000 jar without
  // core makes ImageIO's SPI scan throw ServiceConfigurationError, which kills
  // the stage before it reads a page — worse than the blank render it fixes.
  //
  // `turbopackIgnore` because a `join` over a table entry is a path the tracer
  // cannot resolve, and its answer is to trace the whole project (AGENTS.md,
  // "Function traces are bounded"). The jars reach each function through
  // `outputFileTracingIncludes` instead, as PDFBox does.
  const renderGap = missingJpxDecoder(root);
  const decoders = renderGap ? [] : JPX_DECODER.map((jar) => join(/*turbopackIgnore: true*/ root, jar.path));
  return {
    available: true,
    javaBin,
    classpath: [jar, classes, ...decoders].join(delimiter),
    ...(renderGap ? { renderGap } : {}),
  };
}

/** Whether document stages can run here. Read by `/api/ready` and settings. */
export function isDocumentToolchainAvailable(
  options: { root?: string; env?: Env } = {},
): boolean {
  return resolveJavaRuntime(options).available;
}
