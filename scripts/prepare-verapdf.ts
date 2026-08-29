/**
 * Fetches veraPDF — the product's second document instrument.
 *
 * `npm run vercel-build` calls this after `prepare-jvm.ts`; `npm run build`
 * does not, for the reason that script gives: a local build must not start
 * pulling a toolchain down. The ordering is load-bearing — the installer
 * below is executed by the jlink runtime `prepare-jvm.ts` just assembled.
 *
 * ## Why the product ships the reference checker
 *
 * Every silent-gap incident in the PDF work had one root cause: the product
 * shipped one instrument, so a conformance clause only veraPDF could see
 * arrived as silence. Growing our own checker clause by clause left two
 * definitions of conformance free to drift. This makes the authority itself
 * part of the product: ~15MB of jar against a function already carrying a
 * 440MB LibreOffice.
 *
 * ## Pinned and verified
 *
 * A versioned release URL and a checksum, for the reason `prepare-jvm.ts`
 * gives — this executes in production, so it is a supply-chain artifact we
 * have to be able to reason about. The generic `releases/verapdf-installer.zip`
 * URL the research spike uses tracks "latest" and is exactly what this script
 * must not depend on.
 *
 * ## Licensing
 *
 * veraPDF is GPLv3+/MPLv2+ dual-licensed. It runs as a separate process over
 * argv and stdout — nothing links against it — and serving a SaaS is not
 * distribution, so neither license obliges anything of the product's code.
 *
 * ## Why an installer runs at build time
 *
 * The release artifact is an IzPack installer; the CLI jar inside it is an
 * IzPack pack stream, not a plain zip entry, so it can only come out by
 * running the installer. `[V]` Headless install on the jlink runtime works
 * (`-Djava.awt.headless=true`; `java.desktop` is already in MODULES), and of
 * the installed tree only `bin/cli-<version>.jar` is kept — the GUI jar,
 * config and uninstaller are pruned.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { zipEntry } from '../src/domain/docx-language';
import { BUNDLED_JRE_DIR } from '../src/integrations/documents/java-runtime';
import { BUNDLED_VERAPDF_JAR } from '../src/integrations/documents/verapdf';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const VERAPDF = {
  version: '1.30.2',
  url: 'https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.2-installer.zip',
  sha256: '6cc6341cb1af644044054b81f00a6590a7918abb18f762243de115258bcad838',
  /** The one entry of the release zip: the IzPack installer jar. */
  installerEntry: 'verapdf-greenfield-1.30.2/verapdf-izpack-installer-1.30.2.jar',
};

/**
 * GUI pack only: it is the pack that carries the jars, and everything else —
 * batch files, validation model sources, docs, sample plugins — is weight the
 * function would carry for nothing.
 */
function autoInstallXml(installPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir">
    <installpath>${installPath}</installpath>
  </com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
    <pack index="0" name="veraPDF GUI" selected="true"/>
    <pack index="1" name="veraPDF Batch files" selected="false"/>
    <pack index="2" name="veraPDF Validation model" selected="false"/>
    <pack index="3" name="veraPDF Documentation" selected="false"/>
    <pack index="4" name="veraPDF Sample Plugins" selected="false"/>
  </com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
`;
}

async function main(): Promise<void> {
  const jarPath = join(ROOT, BUNDLED_VERAPDF_JAR);
  if (existsSync(jarPath)) {
    console.log('veraPDF already present');
    return;
  }

  const javaBin = join(ROOT, BUNDLED_JRE_DIR, 'bin', 'java');
  if (!existsSync(javaBin)) {
    // Refuse rather than fall back to a host java: the artifact must be
    // proven against the runtime that will execute it in production.
    throw new Error(`no bundled runtime at ${BUNDLED_JRE_DIR} — run prepare-jvm.ts first`);
  }

  const work = await mkdtemp(join(tmpdir(), 'ada-verapdf-'));
  try {
    console.log(`fetching veraPDF ${VERAPDF.version}`);
    const response = await fetch(VERAPDF.url);
    if (!response.ok) {
      throw new Error(`veraPDF download failed: ${response.status} ${response.statusText}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== VERAPDF.sha256) {
      throw new Error(`veraPDF checksum mismatch: expected ${VERAPDF.sha256}, got ${actual}`);
    }

    const installer = zipEntry(bytes, VERAPDF.installerEntry);
    if (installer === null) {
      throw new Error(`release zip has no entry ${VERAPDF.installerEntry} — layout changed`);
    }
    const installerJar = join(work, 'installer.jar');
    await writeFile(installerJar, installer);

    console.log('running the headless install');
    const installDir = join(work, 'installed');
    const autoXml = join(work, 'auto-install.xml');
    await writeFile(autoXml, autoInstallXml(installDir));
    await execFileAsync(
      javaBin,
      ['-Djava.awt.headless=true', '-jar', installerJar, autoXml],
      { maxBuffer: 16 * 1024 * 1024 },
    );

    const cliJar = join(installDir, 'bin', `cli-${VERAPDF.version}.jar`);
    if (!existsSync(cliJar)) {
      throw new Error(`install produced no ${cliJar} — pack layout changed`);
    }

    await mkdir(dirname(jarPath), { recursive: true });
    await rename(cliJar, jarPath);

    // Prove the artifact runs on the runtime that ships, before the build
    // moves on. A missing module fails here, in a log somebody reads.
    const { stdout } = await execFileAsync(javaBin, ['-jar', jarPath, '--version'], {
      maxBuffer: 1024 * 1024,
    });
    const version = stdout.trim().split('\n')[0] ?? '';
    if (!version.includes(VERAPDF.version)) {
      throw new Error(`the installed checker reports "${version}", not ${VERAPDF.version}`);
    }

    const size = (await readFile(jarPath)).length;
    console.log(`veraPDF ready at ${BUNDLED_VERAPDF_JAR} — ${version}, ${Math.round(size / 1024 / 1024)}MB`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
