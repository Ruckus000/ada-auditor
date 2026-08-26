/**
 * Fetches PDFBox and compiles the graduated document stages.
 *
 * `npm run build:documents`.
 *
 * Until now the only compile instruction in this repository was a `javac` line
 * inside a research document, which meant the Java could not be built by anyone
 * who had not read that file. This is the build step.
 *
 * ## Why a `vendor/` of its own
 *
 * `experiments/document-remediation/` already downloads this jar, and this
 * script deliberately does not reach for that copy: production reading out of
 * the spike would point the dependency the wrong way round — the spike is
 * ungated by design, typechecked and linted by nothing, and nothing shipped
 * should resolve a path into it.
 *
 * So the jar is downloaded twice on a machine that runs both. That is twelve
 * megabytes of gitignored download, not twelve megabytes of duplicated source,
 * and the alternative was editing eight classpath strings in an ungated
 * directory that no gate would catch me breaking.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  DOCUMENT_CLASSES_DIR,
  PDFBOX_JAR,
  PDFBOX_VERSION,
} from '../src/integrations/documents/java-runtime';

const execFileAsync = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JAVA_SRC = join(ROOT, 'src', 'integrations', 'documents', 'java');

const PDFBOX_URL = `https://repo1.maven.org/maven2/org/apache/pdfbox/pdfbox-app/${PDFBOX_VERSION}/pdfbox-app-${PDFBOX_VERSION}.jar`;

/**
 * The version is pinned rather than tracking latest, for the reason
 * `fetch-tools.sh` gives: every number this pipeline has produced was measured
 * against one build, and "whatever shipped today" cannot be compared with
 * itself next week.
 */
async function ensurePdfbox(): Promise<string> {
  const jar = join(ROOT, PDFBOX_JAR);
  if (existsSync(jar)) {
    return jar;
  }

  console.log(`fetching PDFBox ${PDFBOX_VERSION}`);
  await mkdir(dirname(jar), { recursive: true });

  const response = await fetch(PDFBOX_URL);
  if (!response.ok) {
    throw new Error(`PDFBox download failed: ${response.status} ${response.statusText}`);
  }

  await writeFile(jar, Buffer.from(await response.arrayBuffer()));
  return jar;
}

/** `javac` from `JAVA_HOME` if set, else whatever is on `PATH`. */
function javacBinary(): string {
  const home = process.env.JAVA_HOME?.trim();
  if (home) {
    const candidate = join(home, 'bin', 'javac');
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return 'javac';
}

async function main(): Promise<void> {
  const jar = await ensurePdfbox();

  const sources = (await readdir(JAVA_SRC))
    .filter((name) => name.endsWith('.java'))
    .map((name) => join(JAVA_SRC, name));

  if (sources.length === 0) {
    throw new Error(`no .java sources in ${JAVA_SRC}`);
  }

  const outDir = join(ROOT, DOCUMENT_CLASSES_DIR);
  await mkdir(outDir, { recursive: true });

  // `-encoding UTF-8` is not optional, and a deploy proved it. `javac` falls
  // back to the platform default encoding, which is UTF-8 on macOS and
  // **US-ASCII** on the Vercel build container — so every em-dash in a comment
  // became `error: unmappable character`, 42 of them, and the build died
  // somewhere no local run could reproduce. Source encoding should never be a
  // property of the machine that happens to be compiling.
  //
  // `-Xlint:all` on purpose. These sources were written in a spike where
  // nothing checked them; compiling them into production without turning the
  // compiler's own opinion on would carry that forward.
  const args = ['-cp', jar, '-d', outDir, '-encoding', 'UTF-8', '-Xlint:all', ...sources];

  try {
    const { stderr } = await execFileAsync(javacBinary(), args);
    if (stderr.trim()) {
      console.log(stderr.trim());
    }
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    console.error(e.stderr?.trim() || e.message || String(error));
    throw new Error('javac failed');
  }

  const built = (await readdir(outDir)).filter((n) => n.endsWith('.class'));
  console.log(
    `built ${built.length} class file(s) from ${sources.length} source(s) -> ${DOCUMENT_CLASSES_DIR}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
