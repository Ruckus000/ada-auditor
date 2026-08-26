# Document stages

The runtime home for the document stages: Java (PDFBox) for reading and
repairing PDFs, LibreOffice for converting Word sources.

| Stage | Does | Writes a file |
|---|---|---|
| `Inspect` | reports the structure tree | no |
| `Finish` | sets `MarkInfo`, `/Lang`, `DisplayDocTitle`, XMP | **yes** |
| `convertSourceToPdf` | `.docx` → tagged PDF, via flat ODF | **yes** |

## What is allowed to graduate

The rule, because deciding this one stage at a time with fresh reasoning each
time is how a pile of spike code becomes a product by accident.

**Every stage that has produced a wrong claim infers what the author meant.
Every stage that works on real documents carries through what the author already
stated.** That is not a coincidence — it is the shape of the whole result:
PDF-in reaches 0 of 9 real municipal documents because it is mostly inference;
Word-in produced a UA-1 conformant file because it is mostly transcription.

| category | what it does to delivered bytes | graduates? |
|---|---|---|
| **1. Transcribe or report** | carries through, or reveals, what the document already states | **yes** |
| **2. Infer toward omission** | removes a claim the document does not justify — costs a reader navigation, and a reviewer can see the gap | **yes, with the cost stated** |
| **3. Infer toward assertion** | adds a claim — a wrong statement in delivered bytes that nobody can see | **not without real-document evidence it fires *and* is right** |

`legal-standard.md` says why: "a wrong header is not a missing fix, it is a
manufactured barrier shipped with a confident report."

Still in `experiments/`, and why: `Tables` promotes cells to headers by
appearance (**4 of 195 wrong, verified by nobody**) and `FixScope` infers scope
from row composition (**0 firings on all three real documents** — every one of
its 13 firings came from a corpus we built). Both are category 3. `Headings`
(demote-only) and `Lists` are category 2 and need their cost written down first.
`Captions` is category 1 — *"only moves [a description] the author already
wrote"* — and is the strongest candidate to graduate next.

What this buys, commercially: not "98% of machine-checkable failures removed",
which was never 98% of the work. Instead — **every claim in a document we
deliver was already in the document we received.**

## The caller

`POST /api/documents/remediate` — multipart `file=<agenda.docx>` in, tagged PDF
out, with `X-Remediation-Summary` carrying counts, outcomes and the **gaps** a
human still has to close (each naming its WCAG criterion).

```bash
curl -sS -H "Authorization: Bearer $AUDITOR_RUN_TOKEN" \
     -F file=@agenda.docx -D headers.txt \
     http://localhost:3000/api/documents/remediate -o remediated.pdf
```

Synchronous, because a conversion is ~15s against a 300s ceiling. **No
persistence** — the bytes go back in the response and the record goes to the
log. That contract will change when retrieval is needed; it is a decision for
then rather than a surprise.

`503` when the host has no toolchain, never `500`. On a serverless deployment
that is the permanent, correct answer.

### Two rules the route exists to enforce

**Input validation is ours.** `[V]` LibreOffice sniffs content, so a text file
named `.docx` converts successfully — a successful conversion is not evidence
the input was Word. `isWordDocument` in `domain/document-remediation.ts` checks
the ZIP magic *and* the OOXML part names, which are readable in the raw bytes
because ZIP stores filenames uncompressed. It proves the container shape, not
that the document is well-formed.

**Never log document content.** `DocumentStructure` carries the document's own
words — headings, reading order, every table cell — and these are municipal
records naming real people. The log line carries counts and outcome kinds only;
`logSafe` strips even the title. A response may echo the title, because the
caller uploaded the file; a log line persists and travels.

## Why this exists

The document pipeline was built in `experiments/document-remediation/`, which is
outside the production `tsconfig` `include` and inside `eslint.config.mjs`
`ignores` — typechecked and linted by nothing, by design, because a spike is
allowed that trade. Nothing in `src/` could consume it, and nothing should have.

This is the seam: a typed, gated boundary where a JVM subprocess's stdout is
validated into plain data.

## Layering

```
domain/document-structure.ts    the contract (zod), no subprocess, no framework
integrations/documents/         resolves a JVM, spawns it, validates output
```

Nothing above this directory knows a JVM exists. That is the same seam
`services/deterministic-audit.ts` holds against axe-core — plain data crosses,
the engine does not — and it is what keeps the layers testable apart.
**`services/` must not import this**; the settings page resolves availability and
passes it into `readDeploymentConfig`.

## Absence is a state, not an error

`resolveJavaRuntime()` returns a discriminated result, never a throw. Vercel
functions have no Java, so `available: false` is the **expected** answer in
production, not a fault — the same distinction `ArtifactRead` makes between
`pruned` and missing.

`/api/ready` reports `documentToolchainAvailable` in `checks` and deliberately
adds **no warning**: on every deployed environment this is permanently false, and
a warnings array with a permanent entry is one people stop reading.

## Setup

```bash
npm run build:documents
```

The source path additionally needs LibreOffice on the host (`SOFFICE_PATH`, on
`PATH`, or the macOS application bundle). Verified against 26.2.2.2.

Fetches PDFBox 3.0.8 into `vendor/` (gitignored) and compiles
`src/integrations/documents/java/*.java` into `dist/documents/classes`
(gitignored). Needs a JDK 17+, via `JAVA_HOME` or on `PATH`.

The repo tracks **zero binaries** and this must not change that.

## Tests

| Suite | Covers |
|---|---|
| `npm test` | the schema, and every stage failure mode via an injected executor — **no JVM** |
| `npm run test:documents` | `Inspect` against a real JVM and a real PDF |

The real-JVM tests skip themselves, naming the missing piece, when no toolchain
is present. Their PDF fixture is generated at test time by `renderPdf()` rather
than committed.

## Three measured things about LibreOffice

**Filter options replace the defaults, so one wrong key silently disables
tagging.** `[V]` `pdf:writer_pdf_Export` with a misspelled option name produced
a PDF with **zero** structure elements and no PDF/UA identifier — at exit 0,
indistinguishable from success. That is why `convert.ts` reads its own output
back through `Inspect` and asserts it is tagged.

**It invents a language.** `[V]` `/Lang` comes out `en-US` on a PDF exported
from a source with every `fo:language` declaration stripped, and a declared `en`
is widened to `en-US`. Both are statements the document never made, so the
language is read from the *source* and reapplied with `Finish` — including
reapplying nothing, which removes the claim.

**It sniffs content rather than trusting the extension.** `[V]` A text file
named `.docx` converts successfully. **A successful conversion is not evidence
that the input was a Word document**; anything accepting uploads must validate
the input itself.

## Output convention

`Inspect` prints one JSON document as the whole of stdout. Some other spike
stages print progress lines and put JSON on the **last** line; `runStage` does
not support that yet, deliberately — no such stage has graduated, and a parser
guessing between the two would eventually guess wrong on a document whose text
ends in a brace.

## Verifying a stage that writes

A repair stage's failure mode is a delivered file carrying a claim that is wrong
and invisible: four meaningful images artifacted out of the structure tree look
identical, in the PDF, to four images that were never there. A zero exit code
says the JVM did not crash — nothing more.

So `runWritingStage` returns `StageOutcome`, and **verifying the output is the
caller's job**:

```
inspectDocument(before) → repair → inspectDocument(after)
  → contentChanges(before, after)   // must be []
```

`contentChanges` lives in `domain/document-structure.ts` and needs no ground
truth, which matters because a client's document has none. `Finish` claims in
its own header that it alters no structure element; `java-finish.test.ts` is
what holds it to that.

## `/Lang` has no default, ever

`finishDocument` requires a BCP-47 tag and shape-checks it. Defaulting to `en`
would give every Welsh or bilingual document a false statement about itself —
an *assertion*, in this project's terms, and worse than the omission it
replaced. A caller with no answer must not call the stage.

## Graduating another stage

1. Move the `.java` into `java/` (do not copy — `StructText.java` is shared, and
   two copies drift). `java-spike-still-compiles.test.ts` guards that edge.
2. Add its output schema to `domain/`.
3. Wrap it like `inspect.ts` (reads) or `finish.ts` (writes).
4. If it prints progress lines, give `runStage` an explicit mode.
5. **If it writes, prove what it does not change** before trusting it.

The remaining repair stages are harder than `Finish`, and in a specific way:
each either deletes semantics (`Headings` demotes, `Lists` removes) or invents
them (`Tables` promotes cells to headers). For those, `contentChanges` returning
`[]` is the wrong bar — they are *supposed* to change content — so each needs its
own statement of what it may and may not touch.
