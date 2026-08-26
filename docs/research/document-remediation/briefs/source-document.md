# Brief A — Does structure survive an export, or was it never destroyed?

**Read [README.md](README.md) first. It is binding and it is not advisory.**

**Results file:** `docs/research/document-remediation/source-export-results.md`
**Timebox:** one session.

---

## The one question

> **Does a structure-preserving exporter deliver the semantics our reconstruction
> pipeline cannot recover — on the same documents, against the same ground truth?**

Not "is LibreOffice good." Not "should we pivot to source remediation." **Does
the structure survive the export, measured by the comparator we already have.**

## Why this question and not another

Every technique this project has killed failed the same way, and nobody named the
pattern until now:

- **Heading levels** — killed twice. Typographic scoring promoted a venue address
  and a table column header. A local layout model tripled wrong-level assertions.
- **Alt text** — killed. A VLM described statutory proof-of-posting photographs
  as *"a poster on the wall."*
- **Table headers** — 4 of 195 asserted wrong, and the mechanism was an inverted
  KPI block that geometry cannot distinguish from a header row.
- **Decorative vs meaningful** — never attempted, because intent is not in pixels.

**One cause. The information is not in the PDF.** Heading-ness is nesting. Alt
text is purpose. Header-ness is meaning. None of it is geometry, and all of it
was thrown away by whatever produced the file.

**And we can prove that here, on our own corpus, in one command.** The 12
synthetic documents are authored as HTML — `corpus/*.html` — with `<h1>`,
`<th>`, `<thead>`, `<caption>` and `<img alt>`. Perfect semantics. Then
`generate-corpus.mjs` renders them with Chromium's `page.pdf()`, whose header
comment already records the finding:

> *Chromium's `page.pdf()` emits an UNTAGGED PDF — verified in phase 0 against
> veraPDF, which reported 7.1-11 (no structure hierarchy), 6.2-1 (no MarkInfo).*

**We authored correct structure, deleted it at export, and then spent 3,270 lines
trying to guess it back.** This brief measures whether a different exporter
simply keeps it.

---

## Part 0 — The feasibility gate. Run it first; it can end the experiment.

If real municipal PDFs are scans, no source exists and the direction is dead
regardless of what Part 1 measures.

Read `/Creator` and `/Producer` from the document information dictionary of the
nine real PDFs at:

`/Users/jphilistin/Documents/Coding/ADA Auditor/.claude/worktrees/elegant-matsumoto-6e3cad/experiments/document-remediation/real/`

**Read-only.** These are gitignored municipal records containing private
individuals' names and addresses. Do not copy them into your worktree, do not
commit them, and quote **producer strings only** — never document content.

PDFBox 3.0.8 is already vendored and is the least-effort route. A throwaway
read-only script in your scratch directory is fine; it is not a pipeline change.

**Gate:** if fewer than 3 of 9 indicate a structured producer, record that,
stop, and report. Part 1 does not run.

## Part 1 — The measurement

**Arm C (baseline).** Chromium `page.pdf()` → existing pipeline → `compare.mjs`.
This already exists, but **re-run it restricted to the same document set you
score in Arm L**, so the comparison is like for like. The published figures — 8
assertions, 8 DELIVERABLE — are across **28** documents, not 12. Do not compare
against them.

**Arm L (the test).** The same `corpus/*.html`, exported by LibreOffice 26.2.2.2
(`/opt/homebrew/bin/soffice`, already installed, zero install cost) with tagged
PDF enabled, straight into `compare.mjs`. **No pipeline.** The question is
whether the exporter alone delivers.

Tagged output is not the default. `[R]` LibreOffice exposes `UseTaggedPDF` as a
`writer_pdf_Export` filter option through `--convert-to`. **Verify it is
actually on** — veraPDF reporting 7.1-11 means it is not, and an untagged Arm L
measures nothing. Confirm before scoring, not after.

**Arm LP (secondary, drop it if the timebox is tight).** LibreOffice export →
existing pipeline → `compare.mjs`. Tests whether a good starting point helps or
whether the pipeline's unconditional re-tagging destroys it — a known open
question, since five of nine real documents arrive already tagged.

### Instrument

`compare.mjs`, unchanged, against the ground truth already in
`corpus/*.ground-truth.json`. **Assertions and DELIVERABLE are the numbers.**
Exit code is the gate: 1 while any assertion remains, 2 if a DELIVERABLE carries
a defect. Nothing hand-scored.

**Exclude `09-scanned`** from all arms and say so in the results. It is an
image-only PDF assembled from a PNG; there is no source structure to preserve
and including it would flatter or penalise arbitrarily.

**Setup trap:** `vendor/` and `out/classes` are build products. A fresh worktree
has neither. Run `fetch-tools.sh` and build, or copy them across, before the
first `compare.mjs` call.

**Drive it from `bash` with per-stage `rc` capture.** A `zsh` loop has twice
reported `EXIT=0` across a wholly failed run in this project.

---

## Registered prediction

**Commit this to the results file before the first measurement.** Rule 5.

1. `[H]` **Part 0:** at least **6 of 9** real documents report a structured
   producer — a word processor, a layout application, Distiller, or a report
   generator — rather than a scanner. All nine had extractable text.
2. `[H]` **LibreOffice emits a genuinely tagged PDF:** veraPDF 7.1-11 and 6.2-1
   both clear on Arm L.
3. `[H]` **Heading levels survive intact.** `<h1>` becomes `/H1` at the right
   level. **Zero heading assertions and zero heading omissions across Arm L.**
   This is the capability `Headings.java` structurally cannot have — it demotes
   and never promotes, so a document whose headings were never tagged gets zero
   headings from us, correctly and uselessly.
4. `[H]` **Table headers survive, but incompletely.** `<th>` becomes `/TH`;
   **scope and the merged group header do not.** Documents `03-simple-table` and
   `04-difficult-table` show header-relationship omissions — `03` has a
   `rowspan 2` and a `colspan 4` group header that I expect LibreOffice's HTML
   import to flatten.
5. `[H]` **Alt text survives** wherever `<img alt>` exists, on `05` and `06`,
   with **no model involved** — the exporter copies a string. If true this is the
   only path to alt text that does not assert.
6. `[H]` **Net: assertions fall to at or near zero, and DELIVERABLE rises above
   the Arm C baseline on the same set.** This is the first time in this project I
   have predicted DELIVERABLE to rise, and it is the whole point.
7. `[H]` **The failure will be fidelity, not semantics.** LibreOffice re-flows
   pages, so `02-two-column` and `08-slide-layout` will not look like the
   Chromium output. **Visual fidelity is not a WCAG criterion.** Record it as a
   finding; do not score it as a failure.

### Win condition, stated so it can be recognised

**Arm L assertions ≤ Arm C, and Arm L DELIVERABLE > Arm C, on the same set.**
That means the semantics were present all along and only the exporter was losing
them.

### Kill condition

LibreOffice emits an untagged PDF, **or** heading levels do not survive. Either
kills it. Record and stop.

---

## Not doing

- **No `.docx` work.** HTML sources exist with ground truth attached; `.docx`
  authoring is a second experiment and would consume the timebox before the first
  question is answered. If Arm L wins, `.docx` is the obvious next brief — say so
  in FINDINGS and stop.
- **No pipeline changes.** Nothing under `*.java`, no stage runner, no fixture,
  no corpus edit. Arm L does not touch the pipeline at all.
- **No new comparator, scorer, or harness.** `compare.mjs` unchanged.
- **No visual-fidelity scoring.**
- **No other exporters.** Not Pandoc, not WeasyPrint, not wkhtmltopdf, not
  Acrobat. One alternative exporter answers the question; three answer a
  different one.
- **No holdout 2.** Sealed.
- **No product recommendation.** Rule 9. Do not declare source remediation the
  path forward, or not. Report the numbers.

## Stopping condition

Part 0 gate fails → stop. Or Arm C and Arm L are scored and the prediction is
checked line by line → stop. **Arm LP is optional and is the only thing that may
be added.** Anything else interesting goes on the FINDINGS list.
