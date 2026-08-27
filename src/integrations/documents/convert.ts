import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { logWarn } from '../../services/logger';
import { titleFromFilename, type ConversionProvenance } from '../../domain/document-remediation';
import { finishDocument } from './finish';
import { inspectDocument } from './inspect';
import { deriveAltFromCaptions, readLanguage, removeEmptyHeadings, repairTitle } from './flat-odf';
import { docxDeclaredLanguage } from '../../domain/docx-language';
import { resolveLibreOffice, type LibreOfficeRuntime } from './libreoffice-runtime';
import type { Env, JavaRuntime } from './java-runtime';
import { childEnv, type StageExecutor } from './stage';

/**
 * A Word source to a tagged PDF, carrying through what the author wrote.
 *
 * This is the path that works. PDF-in reaches 0 of 9 real municipal documents;
 * this one produced a veraPDF UA-1 conformant file from a real municipal `.docx`
 * with no human input. The reason is not that it tries harder — it is that it
 * *transcribes* rather than infers. Word heading styles survive the export, so
 * there is nothing to promote; the title is in the file's own metadata, so
 * there is nothing to guess.
 *
 * ## The chain
 *
 * ```
 * .docx  ──soffice──▶  .fodt  ──repair──▶  .fodt  ──soffice──▶  .pdf  ──Finish──▶  .pdf
 *                        │                                                  │
 *                   read language,                                   correct the
 *                   transcribe title                              exporter's language
 * ```
 *
 * Flat ODF is in the middle because it is the one point where the source can be
 * corrected *before* it becomes a PDF, and correcting a source is categorically
 * safer than mutating a delivered file.
 *
 * ## Three things measured here that will bite anyone who changes this
 *
 * **1. `soffice` exits 0 when it produces nothing.** This project has been
 * caught by that four times. Every call below checks the output file exists,
 * and a missing file is a failure regardless of exit code.
 *
 * **2. Filter options REPLACE the defaults, so one wrong key silently disables
 * tagging.** `[V]` Measured: `pdf:writer_pdf_Export` with a misspelled option
 * name produced a PDF with **zero** structure elements and no PDF/UA identifier,
 * at exit 0, indistinguishable from success without inspecting it. The correct
 * options produce a tagged, UA-declaring file. That is why the output is passed
 * through `Inspect` and asserted to be tagged rather than assumed.
 *
 * **3. LibreOffice invents a language.** `[V]` It writes `/Lang` as `en-US` onto
 * a PDF exported from a source with every `fo:language` declaration stripped
 * out, and widens a declared `en` to `en-US`. Both are statements the document
 * never made. So the language is read from the *source* and reapplied with
 * `Finish` — including reapplying *nothing*, which removes the claim entirely.
 */

const execFileAsync = promisify(execFile);

/**
 * Per external call, and the arithmetic matters.
 *
 * One conversion makes **four** of them: two `soffice` runs and two JVM stages
 * (`Finish`, then `Inspect` to verify). At the old 120s this bounded a single
 * call and nothing bounded the whole, so a slow document could exceed the 300s
 * function ceiling and be killed with nothing to show — the worst outcome
 * available, since the work is done and thrown away.
 *
 * 60s × 4 = 240s worst case, leaving a minute for reading the upload, writing
 * temp files and returning the bytes. Measured reality is ~15s total; this is a
 * ceiling, not a budget to spend.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * The export that produces a tagged, PDF/UA-declaring file.
 *
 * Verified by measurement, not by documentation — the exact string survived
 * nowhere in the research record, only the filter name. Changing any key here
 * without re-checking `Inspect` output risks a silent untagged export.
 */
const PDF_EXPORT_FILTER =
  'pdf:writer_pdf_Export:' +
  JSON.stringify({
    UseTaggedPDF: { type: 'boolean', value: 'true' },
    PDFUACompliance: { type: 'boolean', value: 'true' },
  });

export type ConversionFailure =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'converter-failed'; step: string; detail: string }
  /** `soffice` exited 0 and wrote nothing. The failure mode that keeps recurring. */
  | { kind: 'no-output'; step: string }
  /** Exported, but untagged — the silent downgrade a wrong filter key produces. */
  | { kind: 'not-tagged'; detail: string };

export type { ConversionProvenance };

export type ConversionResult =
  | { ok: true; pdfPath: string; provenance: ConversionProvenance }
  | { ok: false; failure: ConversionFailure };

export type ConvertOptions = {
  env?: Env;
  /** Ceiling for EACH external call, of which one conversion makes four. */
  timeoutMs?: number;
  /** Injected by tests so the fast suite starts no external process. */
  executor?: StageExecutor;
  runtime?: LibreOfficeRuntime;
  /** Passed through to the Java stages. */
  javaRuntime?: JavaRuntime;
  root?: string;
  /**
   * The document's client-facing name — an upload's filename or a URL's last
   * segment. NOT the path on disk, which in production is a requestId that
   * would defeat filename-derived titles by construction. Absent means no
   * derivation is attempted.
   */
  sourceName?: string;
};

/**
 * One `soffice` run, with the two guards this tool requires.
 *
 * `-env:UserInstallation` gives every run its own profile directory. The
 * default profile is shared and singly-locked, so two concurrent conversions
 * otherwise collide — one of them silently doing nothing, which combines with
 * the exit-0 behaviour into a failure that looks like success.
 */
async function runSoffice(
  soffice: string,
  args: string[],
  profileDir: string,
  step: string,
  expectedOutput: string,
  options: ConvertOptions,
  runtime: LibreOfficeRuntime & { available: true },
  home: string,
  fontconfigFile: string | undefined,
): Promise<{ ok: true } | { ok: false; failure: ConversionFailure }> {
  // The cast is the `Env`/`ProcessEnv` seam described on `defaultExecutor` in
  // `stage.ts`; same direction, same reason.
  const execute =
    options.executor ??
    ((bin, a, o) => execFileAsync(bin, a, { ...o, env: o.env as NodeJS.ProcessEnv | undefined }));
  const base = options.env ?? process.env;

  try {
    await execute(
      soffice,
      ['--headless', `-env:UserInstallation=${pathToFileURL(profileDir).href}`, ...args],
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        // `libraryPath` is set only for the bundled install — see
        // `LibreOfficeRuntime` — so it is also the signal for "this is the
        // deployed function, not somebody's laptop". Both additions below are
        // deployment fixes and neither is an improvement on a host: HOME is
        // already writable there, and its fontconfig cache is worth keeping
        // *shared* rather than rebuilt per conversion.
        env:
          runtime.libraryPath === undefined
            ? childEnv(base)
            : {
                ...childEnv(base),
                // `/var/task` is read-only, and LibreOffice writes a
                // fontconfig cache regardless of where its profile lives.
                // Pointed at the per-run temp directory, which is removed with
                // everything else on the way out.
                HOME: home,
                // Appended, never prepended: a runtime that carries its own
                // copy of a library should use it, and ours only fill gaps.
                LD_LIBRARY_PATH: [base.LD_LIBRARY_PATH, runtime.libraryPath]
                  .filter(Boolean)
                  .join(delimiter),
                ...(fontconfigFile === undefined ? {} : { FONTCONFIG_FILE: fontconfigFile }),
              },
      },
    );
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    const detail = (e.stderr ?? e.message ?? String(error)).split('\n')[0] ?? '';
    logWarn('document_convert_failed', { step, detail });
    return { ok: false, failure: { kind: 'converter-failed', step, detail } };
  }

  // The guard that matters. A zero exit says nothing about whether a file was
  // written, and this tool routinely produces one without the other.
  if (!existsSync(expectedOutput)) {
    logWarn('document_convert_no_output', { step });
    return { ok: false, failure: { kind: 'no-output', step } };
  }

  return { ok: true };
}

/**
 * Converts a Word source into a tagged PDF at `outputPath`.
 *
 * Everything intermediate lives in a temporary directory that is removed on the
 * way out, including the isolated LibreOffice profile.
 */
export async function convertSourceToPdf(
  sourcePath: string,
  outputPath: string,
  options: ConvertOptions = {},
): Promise<ConversionResult> {
  const runtime =
    options.runtime ?? resolveLibreOffice({ env: options.env, root: options.root });
  if (!runtime.available) {
    return { ok: false, failure: { kind: 'unavailable', reason: runtime.reason } };
  }

  const work = await mkdtemp(join(tmpdir(), 'ada-convert-'));
  const profile = join(work, 'profile');
  const stem = basename(sourcePath, extname(sourcePath));

  // Fontconfig, for the bundled install only. `[V]` The deployed runtime has
  // no /etc/fonts at all, and the PDF export step — not the first conversion,
  // which needs no font metrics — died on "Cannot load default config file".
  // So the config is ours, written per run: the bundle's own fonts (the
  // Liberation set shipped for metric compatibility), a cache in the same
  // temp directory everything else uses, and FONTCONFIG_FILE pointing at it.
  // Written at conversion time rather than build time because the config
  // needs absolute paths and the build machine's differ from the runtime's.
  let fontconfigFile: string | undefined;
  if (runtime.libraryPath !== undefined) {
    const fontsDir = join(dirname(dirname(runtime.sofficeBin)), 'share', 'fonts');
    const cacheDir = join(work, 'fc-cache');
    await mkdir(cacheDir, { recursive: true });
    fontconfigFile = join(work, 'fonts.conf');
    await writeFile(
      fontconfigFile,
      [
        '<?xml version="1.0"?>',
        '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
        '<fontconfig>',
        `  <dir>${fontsDir}</dir>`,
        `  <cachedir>${cacheDir}</cachedir>`,
        '</fontconfig>',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  try {
    // 1. Source to flat ODF, so the document can be corrected before export.
    const fodt = join(work, `${stem}.fodt`);
    const toFodt = await runSoffice(
      runtime.sofficeBin,
      ['--convert-to', 'fodt', '--outdir', work, sourcePath],
      profile,
      'source-to-fodt',
      fodt,
      options,
      runtime,
      work,
      fontconfigFile,
    );
    if (!toFodt.ok) return toFodt;

    // 2. Read what the source states, and transcribe a title if it has one to
    //    give. Both are reads of the author's own words.
    //
    //    The language comes from the .docx's OWN bytes wherever they are
    //    readable, because `[V]` the import that produced this fodt inflates:
    //    Arm A of the remediation test measured declared-nothing arriving as
    //    en-US, bare en widened to en-US, es to es-ES, ar to ar-SA — upstream
    //    of the export-time invention `Finish` already corrects. A readable
    //    docx that declares nothing declared nothing; only an unreadable
    //    container (legacy .doc) falls back to the fodt reading, which for
    //    that format is the only reading there is — inflation caveat and all.
    const original = await readFile(fodt, 'utf8');
    const declared = docxDeclaredLanguage(await readFile(sourcePath));
    const sourceLanguage = declared.readable ? declared.language : readLanguage(original);
    // Empty headings go first, so a blank heading-styled line can never be
    // the "first heading" a title gets transcribed from.
    const cleaned = removeEmptyHeadings(original);
    // Captions next: an author's own description of an image, moved to where
    // assistive technology can reach it. Uncaptioned images stay bare and
    // surface on the punch list.
    const captioned = deriveAltFromCaptions(cleaned.xml);
    const repaired = repairTitle(
      captioned.xml,
      options.sourceName === undefined ? null : titleFromFilename(options.sourceName),
    );

    // Written back over the same file: the flat ODF exists only inside this
    // temporary directory, so there is no earlier version worth keeping.
    await writeFile(fodt, repaired.xml, 'utf8');

    // 3. Export tagged. The filter options are load-bearing and unverifiable
    //    from the exit code alone; step 5 is what actually checks them.
    const exported = join(work, `${stem}.pdf`);
    const toPdf = await runSoffice(
      runtime.sofficeBin,
      ['--convert-to', PDF_EXPORT_FILTER, '--outdir', work, fodt],
      profile,
      'fodt-to-pdf',
      exported,
      options,
      runtime,
      work,
      fontconfigFile,
    );
    if (!toPdf.ok) return toPdf;

    // 4. Correct the exporter's language claim — including removing it when the
    //    source declared none. `Finish` also writes the XMP packet and the
    //    viewer preference PDF/UA needs.
    const finished = await finishDocument(
      { inputPath: exported, outputPath, language: sourceLanguage },
      {
        runtime: options.javaRuntime,
        root: options.root,
        env: options.env,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
    );
    if (!finished.ok) {
      return {
        ok: false,
        failure: {
          kind: 'converter-failed',
          step: 'finish',
          detail: JSON.stringify(finished.failure),
        },
      };
    }

    // 5. Read the result back. This is the only thing standing between a
    //    mistyped filter option and an untagged PDF delivered as a remediated
    //    one, and it costs one more JVM start.
    const read = await inspectDocument(outputPath, {
      runtime: options.javaRuntime,
      root: options.root,
      env: options.env,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    if (!read.ok) {
      return {
        ok: false,
        failure: {
          kind: 'converter-failed',
          step: 'verify',
          detail: JSON.stringify(read.failure),
        },
      };
    }

    if (read.value.structureElements === 0) {
      return {
        ok: false,
        failure: {
          kind: 'not-tagged',
          detail:
            'the export produced no structure tree. A wrong filter option key silently disables tagging at exit 0 — check PDF_EXPORT_FILTER.',
        },
      };
    }

    return {
      ok: true,
      pdfPath: outputPath,
      provenance: {
        title: repaired.outcome,
        sourceLanguage,
        structure: read.value,
      },
    };
  } finally {
    // Includes the isolated LibreOffice profile, which is several megabytes per
    // run and would otherwise accumulate in the temp directory unnoticed.
    await rm(work, { recursive: true, force: true });
  }
}
