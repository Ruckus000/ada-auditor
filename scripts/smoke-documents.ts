import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { isWordDocument } from '../src/domain/document-remediation';
import { docxDeclaredLanguage } from '../src/domain/docx-language';
import { logInfo } from '../src/services/logger';
import {
  DOCX_MEDIA_TYPE,
  FIXTURE_FILENAME,
  FIXTURE_HEADINGS,
  FIXTURE_LANGUAGE,
  buildFixtureDocx,
} from './docx-fixture';
import { loadEnvLocal } from './load-env';

/**
 * One real document conversion, against a deployed URL.
 *
 * ## What this proves that `/api/ready` cannot
 *
 * The deploy workflow's smoke step is `curl "$DEPLOY_URL/api/ready"` and a
 * check for HTTP 200. That proves the app boots. It proves nothing about the
 * three things `vendor/` exists to ship — the bundled JRE, veraPDF, and
 * LibreOffice — because `/api/ready` takes no `Request`, spawns no process,
 * and, on Vercel, is a DIFFERENT FUNCTION from the one that would convert.
 * Every route there is packaged independently: `/api/ready` answering 200 says
 * that `/api/ready`'s own instance is healthy, and `vendor/libreoffice` is not
 * in its bundle either way.
 *
 * None of that toolchain has ever been exercised in production. This script is
 * the first thing that asks a deployment to actually do the work and then
 * checks the answer rather than the status line.
 *
 * ## The trap this script is shaped around
 *
 * `/api/documents/remediate` has two lanes behind one door, and the door
 * chooses on BYTES. `isWordDocument` (`src/domain/document-remediation.ts`)
 * wants `PK\x03\x04` and then both `[Content_Types].xml` and `word/` inside
 * the first 8192 bytes; filename and MIME type are ignored. Anything it
 * refuses is offered to `isPdf`, and a PDF goes to `repairPdfBytes` — a
 * PDFBox-only lane that never calls `resolveLibreOffice()`. It returns the
 * same `200 application/pdf`, with the same `x-remediation-summary` header,
 * from a host with no LibreOffice at all.
 *
 * **A 200 on a PDF proves nothing.** So the fixture's container shape is
 * checked against the product's own reader BEFORE the socket opens, and the
 * assertions below are on the conversion's fingerprints — a `sourceLanguage`
 * only the Word lane reads out of `word/styles.xml`, a heading count only an
 * outline import can produce — not on the status code.
 *
 * ## Why the fixture is synthesised
 *
 * `scripts/docx-fixture.ts` assembles it in-process from `node:zlib` and byte
 * writes. Not committed, because a binary blob in the tree is a thing no test
 * can check and no reviewer can read; not shelled out to `zip`, because that
 * puts a system package between the smoke test and the thing it is meant to
 * prove, and because the fast suite deliberately spawns nothing. The same
 * builder is unit-tested in `tests/scripts/docx-fixture.test.ts`.
 *
 * ## Why this is not in CI
 *
 * It converts on a real deployment, which costs a LibreOffice launch and a JVM
 * on somebody's function, and it needs that deployment's own
 * `AUDITOR_RUN_TOKEN`. Wiring it into the deploy workflow is a decision about
 * budget and secrets, not about this script — and a check that runs before
 * anyone has decided how it should fail is a check people learn to ignore.
 * Run it by hand after a deploy:
 *
 *   vercel env pull
 *   npm run smoke:documents -- --base https://<deployment> --out /tmp/out.pdf
 */

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function present(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function fail(message: string): never {
  console.error(`DOCSMOKE FAIL: ${message}`);
  process.exit(1);
}

/** The summary header, as much of it as this script reads. */
type SummaryFields = {
  title?: unknown;
  sourceLanguage?: unknown;
  tagged?: unknown;
  pages?: unknown;
  headings?: unknown;
  tables?: unknown;
  lists?: unknown;
  figures?: unknown;
  gaps?: unknown;
  conformance?: { checker?: unknown; compliant?: unknown; failingClauses?: unknown };
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

async function main(): Promise<void> {
  loadEnvLocal();

  const base = (flag('base', 'http://localhost:3000') ?? '').replace(/\/$/, '');
  const filePath = flag('file');
  const outPath = flag('out');
  const jsonPath = flag('json');
  const allowNoChecker = present('allow-no-checker');

  // ---------------------------------------------------------------- the token
  //
  // From the environment only. Never from argv — a command line is visible in
  // `ps` and lands in shell history — never logged, and never written to the
  // `--json` artifact.
  const token = process.env.AUDITOR_RUN_TOKEN;
  if (!token) {
    fail(
      'AUDITOR_RUN_TOKEN is not set. Run `vercel env pull` so .env.local carries the '
      + 'token of the deployment you are probing.',
    );
  }
  if (token.length < 16) {
    fail(
      `AUDITOR_RUN_TOKEN is ${token.length} characters. MIN_TOKEN_LENGTH is 16, and `
      + '`isRunAuthorized` returns FALSE below it without looking at the request at all '
      + '— so the deployment would answer 401 and never say why. Pull the real token.',
    );
  }

  // ----------------------------------------------------------------- the base
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    fail(`--base is not a URL: ${base}`);
  }

  // `--allow-no-checker` is a local rehearsal switch and nothing else. A
  // deployment answering `checker: 'none'` is a deployment missing
  // `vendor/verapdf/cli.jar`, which is exactly what this script exists to
  // find; letting the flag suppress that against a real host would turn the
  // veraPDF proof off in the one place it matters.
  if (allowNoChecker && !LOCAL_HOSTS.has(baseUrl.hostname)) {
    fail(
      `--allow-no-checker refuses to run against ${baseUrl.hostname}. It exists for local `
      + 'rehearsal only (localhost or 127.0.0.1), because on a deployment `checker: "none"` '
      + 'IS the finding.',
    );
  }

  const rawMinHeadings = flag('min-headings', String(FIXTURE_HEADINGS)) ?? '';
  const minHeadings = Number(rawMinHeadings);
  if (!Number.isInteger(minHeadings) || minHeadings < 1) {
    fail(`--min-headings must be a positive integer; got ${JSON.stringify(rawMinHeadings)}`);
  }

  // --------------------------------------------------------------- the bytes
  const bytes =
    filePath === undefined
      ? buildFixtureDocx()
      : new Uint8Array(await readFile(filePath).catch((error: unknown) =>
          fail(`--file could not be read: ${error instanceof Error ? error.message : 'unknown error'}`),
        ));

  const uploadName = filePath === undefined ? FIXTURE_FILENAME : basename(filePath);

  const container = isWordDocument(bytes);
  if (!container.ok || container.kind !== 'docx') {
    fail(
      `these bytes are not a .docx by the door's own reading: ${
        container.ok ? `container is ${container.kind}, not docx` : container.reason
      }. That matters more than it sounds: what `
      + '`isWordDocument` refuses is offered to `isPdf` next, and a PDF is routed to '
      + '`repairPdfBytes` — a PDFBox-only lane that never touches LibreOffice and still '
      + 'answers 200 application/pdf with a summary header. A run on those bytes would '
      + 'pass and prove nothing.',
    );
  }

  const declared = docxDeclaredLanguage(bytes);
  if (!declared.readable) {
    fail(
      'these bytes have no readable `word/document.xml`, so the ZIP central directory is '
      + 'malformed even though the door accepted the first 8192 bytes. LibreOffice would '
      + 'refuse the conversion, or — worse — the run would fall through to a lane that '
      + 'never calls it and answer 200 anyway.',
    );
  }
  if (filePath === undefined && declared.language !== FIXTURE_LANGUAGE) {
    fail(
      `the synthesised fixture declares ${JSON.stringify(declared.language)} rather than `
      + `${FIXTURE_LANGUAGE}. The builder is broken; the response's sourceLanguage check `
      + 'downstream would be measuring nothing.',
    );
  }

  // ------------------------------------------------------------- preflight
  //
  // On the SAME URL as the POST, deliberately. On Vercel every route is its own
  // function, so `/api/ready` answers for its own instance and cannot speak for
  // this one; a GET on this route file is served by the function that would do
  // the converting.
  const preflight = await fetch(`${base}/api/documents/remediate`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  }).catch((error: unknown) =>
    fail(`preflight GET could not reach ${base}: ${error instanceof Error ? error.message : 'unknown error'}`),
  );

  if (preflight.status === 404) {
    fail(
      `${base}/api/documents/remediate answered 404 — the conversion route is not deployed `
      + 'at this URL. Check the deployment is the one you think it is.',
    );
  }
  if (preflight.status === 401) {
    const contentType = preflight.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      fail(
        'preflight got a 401 with an HTML body: that is Vercel Deployment Protection in '
        + 'front of the app, not the app refusing the token. Use the production alias, or '
        + 'send x-vercel-protection-bypass with VERCEL_AUTOMATION_BYPASS_SECRET.',
      );
    }
    fail(
      'preflight got a 401 from the app itself: AUDITOR_RUN_TOKEN does not match this '
      + "deployment's configured token. `vercel env pull` for the right environment.",
    );
  }
  if (preflight.status !== 200) {
    fail(`preflight GET answered ${preflight.status}; expected 200.`);
  }

  const capability = (await preflight.json().catch(() => ({}))) as {
    available?: unknown;
    reason?: unknown;
  };
  if (capability.available !== true) {
    fail(
      `this deployment reports it cannot convert: ${
        typeof capability.reason === 'string' && capability.reason.length > 0
          ? capability.reason
          : '(no reason given)'
      }. The reason distinguishes the three cases — nothing bundled, LibreOffice present `
      + 'without a Writer module, or no JDK — and they have different fixes.',
    );
  }

  console.log(
    'preflight: available=true. Necessary, NOT sufficient — `writerModule()` reports '
    + '`unknown` (and the runtime reports available) for any install layout it cannot '
    + 'parse, so only the conversion below actually proves LibreOffice runs.',
  );

  // ------------------------------------------------------------------ the POST
  //
  // No retry, on purpose. Every failure this script can hit is a standing fact
  // about the deployment — no LibreOffice, no JDK, no veraPDF, a wrong token, a
  // route that is not there — and none of them changes if it is asked twice. A
  // retry loop would only make a genuine 429 (the per-hour document budget)
  // spend the rest of the allowance to reach the same answer more slowly.
  const form = new FormData();
  // The name is a handle for a human reading a log, and nothing more. The door
  // ignores it entirely, and the pipeline never lets it reach the filesystem —
  // temp files are named by request id. It is the LAST rung of the title chain
  // (metadata, then the document's own first heading, then this), and either of
  // the earlier two failing shows up as a `title` provenance other than
  // `already-titled`, which the check below refuses.
  form.set('file', new File([new Uint8Array(bytes)], uploadName, { type: DOCX_MEDIA_TYPE }));

  const startedAt = Date.now();
  // No hand-set `content-type`: `FormData` needs its own generated multipart
  // boundary, and setting the header discards it and makes the body unparseable.
  const response = await fetch(`${base}/api/documents/remediate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(300_000),
  }).catch((error: unknown) =>
    fail(`POST failed: ${error instanceof Error ? error.message : 'unknown error'}`),
  );
  const wallClockMs = Date.now() - startedAt;

  if (response.status !== 200) {
    const text = await response.text().catch(() => '');
    let refusal: { error?: unknown; detail?: unknown; message?: unknown } = {};
    try {
      refusal = JSON.parse(text) as typeof refusal;
    } catch {
      refusal = { error: 'unparseable', detail: text.slice(0, 300) };
    }
    const detail = typeof refusal.detail === 'string' ? refusal.detail : '(no detail)';

    if (response.status === 503 && refusal.error === 'converter_unavailable') {
      fail(
        `503 converter_unavailable: this function has a JVM but no usable LibreOffice — ${detail}. `
        + 'The preflight said otherwise, which means `writerModule()` answered `unknown` for an '
        + 'install layout it could not read. This is the failure the script exists to surface.',
      );
    }
    if (response.status === 503) {
      fail(`503 ${String(refusal.error)}: the toolchain is not available on this host — ${detail}.`);
    }
    if (response.status === 422 && refusal.error === 'remediation_failed') {
      fail(
        `422 remediation_failed (${detail}). LibreOffice was reached and the run did not finish. `
        + 'Read the detail: `converter-failed/<step>` is a stage that ran and refused, '
        + '`no-output/<step>` is a stage that produced no file, `not-tagged` means the '
        + 'converted PDF carried no structure tree at all.',
      );
    }
    if (response.status === 422) {
      fail(`422 ${String(refusal.error)} (${detail}).`);
    }
    if (response.status === 415) {
      fail(
        `415 unsupported_document (${detail}) — the door refused the container even though `
        + '`isWordDocument` accepted it locally. The bytes on the wire are not the bytes checked '
        + 'here; suspect the multipart encoding.',
      );
    }
    if (response.status === 413) {
      fail(`413 document_too_large (${detail}) — over AUDITOR_MAX_DOCUMENT_BYTES on this host.`);
    }
    if (response.status === 429) {
      fail(
        `429 ${String(refusal.error)} (${detail}): the document budget for this window is spent. `
        + `${typeof refusal.message === 'string' ? refusal.message : ''} Nothing was converted; `
        + 'wait for the reset rather than retrying.',
      );
    }
    fail(`POST answered ${response.status}: ${String(refusal.error)} (${detail}).`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('application/pdf')) {
    fail(`200 but content-type is ${JSON.stringify(contentType)}; expected application/pdf.`);
  }

  const rawSummary = response.headers.get('x-remediation-summary');
  if (rawSummary === null) {
    fail('200 application/pdf with no x-remediation-summary header — nothing to check the run against.');
  }

  // Parsed DIRECTLY. The header is `asciiJson` output: already valid JSON, with
  // non-ASCII characters `\u`-escaped because header values are ByteStrings.
  // Un-escaping it first would corrupt a title carrying an em-dash.
  let summary: SummaryFields;
  try {
    summary = JSON.parse(rawSummary) as SummaryFields;
  } catch {
    fail(`x-remediation-summary is not JSON: ${rawSummary.slice(0, 300)}`);
  }

  if (summary.tagged !== true) {
    fail(
      `the delivered PDF reports tagged: ${JSON.stringify(summary.tagged)}. A conversion that `
      + 'produces no structure tree has produced a picture of a document.',
    );
  }

  const headings = typeof summary.headings === 'number' ? summary.headings : -1;
  if (headings < minHeadings) {
    fail(
      `headings: ${headings}, below --min-headings ${minHeadings}. The source declares an `
      + 'outline; a converted file without one means the import flattened it.',
    );
  }

  if (filePath === undefined) {
    if (summary.title !== 'already-titled') {
      fail(
        `title provenance is ${JSON.stringify(summary.title)}, expected "already-titled". The `
        + "fixture carries a real <dc:title>, so anything else means the source's own metadata "
        + 'did not survive the import.',
      );
    }
    if (summary.sourceLanguage !== FIXTURE_LANGUAGE) {
      fail(
        `sourceLanguage is ${JSON.stringify(summary.sourceLanguage)}, expected `
        + `${JSON.stringify(FIXTURE_LANGUAGE)}. This value is read out of the source's own `
        + '`word/styles.xml` by the Word lane and by nothing else, so it is the single '
        + 'clearest fingerprint that the conversion ran rather than a PDF repair.',
      );
    }
  }

  // The veraPDF liveness proof, and deliberately NOT `compliant === true`.
  //
  // `checker: 'none'` is exactly what a deployment missing `vendor/verapdf/cli.jar`
  // returns, and it is rendered everywhere as "not checked" rather than clean —
  // which is correct, and is also why nothing downstream would ever go red over
  // it. Requiring compliance instead would make this assertion about the
  // document; requiring the CHECKER makes it about the deployment, which is what
  // is being smoke-tested.
  const checker = summary.conformance?.checker;
  if (checker !== 'verapdf-ua1') {
    const message =
      `conformance.checker is ${JSON.stringify(checker ?? null)}, expected "verapdf-ua1". `
      + 'The reference checker did not run on this host — `vendor/verapdf/cli.jar` is missing '
      + 'from this function\'s bundle, or the JVM could not start it. Every surface will read '
      + 'this as "conformance not checked".';
    if (!allowNoChecker) fail(message);
    console.log(`DOCSMOKE WAIVED: ${message}`);
    console.log('DOCSMOKE WAIVED: --allow-no-checker was passed. This run does NOT prove veraPDF works.');
  }

  const pdf = Buffer.from(await response.arrayBuffer());
  const head = pdf.subarray(0, 8).toString('latin1');
  if (!head.startsWith('%PDF-')) {
    fail(`the delivered body does not begin %PDF- (starts ${JSON.stringify(head)}).`);
  }
  const tail = pdf.subarray(Math.max(0, pdf.length - 1024)).toString('latin1');
  if (!tail.includes('%%EOF')) {
    fail('the delivered body has no %%EOF in its last 1KB — the PDF is truncated.');
  }

  const conformance = summary.conformance;
  const failingClauses = conformance?.failingClauses;
  const result = {
    base,
    source: filePath ?? 'synthesised fixture',
    uploadName,
    requestId: response.headers.get('x-request-id'),
    wallClockMs,
    bytesSent: bytes.byteLength,
    bytesReceived: pdf.length,
    title: summary.title ?? null,
    sourceLanguage: summary.sourceLanguage ?? null,
    tagged: summary.tagged ?? null,
    pages: summary.pages ?? null,
    headings: summary.headings ?? null,
    tables: summary.tables ?? null,
    lists: summary.lists ?? null,
    figures: summary.figures ?? null,
    gaps: Array.isArray(summary.gaps) ? summary.gaps : [],
    conformanceChecker: conformance?.checker ?? null,
    conformanceCompliant: conformance?.compliant ?? null,
    failingClauses: Array.isArray(failingClauses) ? (failingClauses as unknown[]) : [],
    minHeadings,
    // True only when a `checker: 'none'` was let through by the local-rehearsal
    // flag. It rides in both the log line and the artifact so a passing run can
    // never be quoted as a veraPDF proof it is not.
    checkerWaived: checker !== 'verapdf-ua1',
  };

  logInfo('smoke_documents_result', result);

  if (outPath !== undefined) {
    await writeFile(outPath, pdf);
    console.log(`  wrote ${pdf.length} bytes to ${outPath}`);
  }

  // Byte-identical to the object logged above, so an uploaded artifact and the
  // line a human reads cannot disagree about what was measured.
  if (jsonPath !== undefined) {
    await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
}

main().catch((error: unknown) => {
  console.error(`DOCSMOKE FAIL: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
