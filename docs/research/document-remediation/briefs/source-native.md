# Brief C — Does the source→PDF export ever assert?

**Read [README.md](README.md) first. It is binding and it is not advisory.**

**Results file:** `docs/research/document-remediation/source-native-results.md`
**Timebox:** one session.

---

## The one question

> **Does exporting a native word-processor source to PDF ever claim something the
> source did not state?**

Not "is LibreOffice good." Not "should we pivot to source remediation." Not "can
we make a perfect document." **Does the export invent, or does it only copy and
omit.**

## Why this is the question, and why it is narrower than it looks

[position-2026-08-25.md](../position-2026-08-25.md) records the measurement that
makes this the only live path: **`[V]` zero of nine real documents is reachable
under zero human input.** Five are blocked by alt text, closed by
[Brief B](../vlm-scale-results.md). Four are blocked by a document title that
cannot be copied, because those four produce **zero headings**.

[briefs-synthesis.md](../briefs-synthesis.md) records why the source path is
different in kind rather than degree:

| | when it lacks the information | what a reviewer sees |
|---|---|---|
| **source export** | **omits** | an honest gap |
| **inference** — our pipeline, or any VLM | **asserts** | nothing |

**Gate 1 is zero assertions.** A path whose failures are structurally omissions
clears it by construction; a path that infers cannot, at any accuracy.

**So the product hypothesis is not "the output will be good."** Output quality is
the client's source quality, and that is their problem and their lever. The
hypothesis is that **the export is honest** — it copies what is stated and stays
silent about what is not. If that holds, the product is sound and every remaining
question is commercial. If the exporter invents even once, the path has the same
disease as the pipeline and is worth no more.

**That is a much cheaper question than the corpus scores**, and it is why Part 1
below is the decisive half.

### What is already verified, so it is not re-derived

- `[V]` A native ODF source with `text:outline-level="1"` exports `/S/H1`,
  `/S/H2`, `/S/H3`. No `Heading#201`, nothing role-mapped away. Brief A's kill
  condition fired on LibreOffice's **HTML import filter**, not its PDF export.
- `[V]` A native ODF table with `<table:table-header-rows>` exports 3 `/TH` at
  `Scope=Column` — correct — and the row-label cells come out `/TD`.
- `[V]` LibreOffice 26.2.2.2 at `/opt/homebrew/bin/soffice`. Zero install cost.

Both probes are in
[brief-a-synthesis.md](../brief-a-synthesis.md). **Extend them; do not repeat
them.**

---

## Part 1 — The assertion probe. This is the decisive half; run it first.

Hand-author a small set of **flat ODF (`.fodt`)** probes — plain XML, no
dependency, roughly ten lines each. One probe per WCAG-relevant structure. Export
each with `UseTaggedPDF`, read the result with the vendored `Inspect.java`, and
answer one question per probe:

> **Does the PDF claim anything the source did not state?**

Each probe's ground truth is the source you wrote, so scoring is reading two short
things side by side. **That is not a new comparator and you must not build one**
(rule 6).

| probe | the source states | the assertion to look for |
|---|---|---|
| **headings** | outline levels 1–6 | a heading the source did not mark; a level that does not match |
| **no headings** | body text only, no outline levels | **any** `/H*` at all |
| **table, header row** | `table:table-header-rows` | a `/TH` outside the header row; a wrong `Scope` |
| **table, row labels** | first cell of each body row, no header marking | any of them emitted as `/TH` |
| **layout table** | a table used for positioning | `/TH` anywhere, or header relationships |
| **decorative image** | marked decorative in ODF | a `/Figure` rather than an artifact |
| **meaningful image** | authored `svg:desc` / alt text | `/Alt` differing from the authored string |
| **image, no alt** | an image with nothing authored | any `/Alt` at all, including a placeholder |
| **list** | a real ODF list | `/L` where none was authored, or a wrong nesting depth |
| **title + language** | `dc:title` and a document language | a title or `/Lang` that is not the one stated |

**The `no headings`, `image, no alt`, `row labels` and `layout table` probes are
the load-bearing ones.** They test silence. An exporter that omits honestly is the
entire product hypothesis; an exporter that helpfully fills a gap is the pipeline
with different branding.

**One `.docx` control.** Convert exactly one probe — the headings one — to `.docx`
and run it through. Clients send Word files, not ODF, and a different import
filter is the single largest generalisation gap in this brief. One control closes
it or exposes it. **Do not build a `.docx` arm.**

## Part 2 — The corpus number

Comparable to the two arms Brief A already scored on the same 11 documents
(excluding `09-scanned`): **Arm C = 1 assertion, 3 DELIVERABLE. Arm L = 20
assertions, 0 DELIVERABLE.**

**Arm N (naive round-trip).** `corpus/*.html` → `.odt` via LibreOffice → PDF
tagged → `compare.mjs`. What a client gets with no help.

**Arm R (source repaired).** The same `.odt`, with **deterministic source-level
repairs** applied before export, then exported and scored. This is the product
motion: fix the source, export it. Permitted repairs are only those that need no
judgement —

- set the outline level on paragraphs already carrying a heading style
- mark images with empty authored alt as decorative
- set `dc:title` **only by copying a heading the source already states**
- set the document language where the source declares one elsewhere

**Any repair that requires deciding what something means is out of scope and is a
FINDINGS entry, not code.** If you cannot make a repair without judgement, that is
a result — record it.

**Also run `PDFUACompliance`.** `[H]` Brief A found every Arm L document failed
`5-1` and four failed **nothing else**, so this one filter option plausibly
accounts for the whole DELIVERABLE gap on those four. It is named here because it
materially changes Part 2's number and Brief A was right not to test it under its
own scope.

### Instrument

`compare.mjs` and `Inspect.java`, both unchanged, against
`corpus/*.ground-truth.json`. **Assertions are the number.** DELIVERABLE is
secondary and is reported, not optimised.

**Setup trap:** `vendor/` and `out/classes` are build products a fresh worktree
lacks. Symlink them from
`/Users/jphilistin/Documents/Coding/ADA Auditor/.claude/worktrees/elegant-matsumoto-6e3cad`
rather than re-fetching — Brief A did exactly this and it cost 19 MB instead of
2 GB.

**Drive every run from `bash` with per-stage `rc` capture.** A `zsh` loop has
three times now reported `EXIT=0` across a wholly failed run in this project.

---

## Registered prediction

**Commit this to the results file before the first measurement.** Rule 5.

### Part 1

1. `[H]` **Outline levels 1–6 all survive** as `/H1`–`/H6`.
2. `[H]` **The `no headings` probe produces zero `/H*`.** The exporter does not
   infer headings from formatting.
3. `[H]` **Row-label cells are never emitted as `/TH`.** Row headers have no
   representation in ODF, so this is an omission the format makes structural.
4. `[H]` **A decorative-marked image becomes an artifact, not a `/Figure`.**
   **This is the 7-assertion class Brief A left untested and I predict it
   resolves at source.** It is the single most valuable line in this brief.
5. `[H]` **An image with no authored alt produces no `/Alt`** — not a placeholder,
   not an empty string that veraPDF accepts.
6. `[H]` **`dc:title` and `/Lang` copy verbatim.** If so, **2.4.2 is solved for
   the four real documents blocked on it**, by copying rather than inventing.
7. `[H]` **Zero assertions across every probe.** This is the win condition and the
   whole hypothesis.
8. `[H]` **The `.docx` control behaves identically to `.fodt`.** Word's import
   filter is far better maintained than the HTML one that broke Brief A.

### Part 2

9. `[H]` **Arm N still loses the H1**, reproducing Brief A's defect and confirming
   it lives in the HTML import.
10. `[H]` **Arm R assertions land at or below Arm C's 1**, and well below Arm L's
    20 — because the two systematic classes behind 17 of those 20 are a wrong
    table scope and an unartifacted decorative image, and both are source-fixable.
11. `[H]` **`PDFUACompliance` clears `5-1`** and lifts DELIVERABLE on the four
    documents that failed nothing else.

### Win condition, stated so it can be recognised

**Zero assertions in Part 1**, and **Arm R assertions ≤ Arm C's 1** in Part 2.
That would mean the export is honest and the product's quality ceiling is the
client's source, which is a commercial problem rather than a technical one.

### Kill condition

**The exporter asserts something the source did not state, and the assertion
cannot be removed by a repair at source.** Then the source path carries the same
disease as the pipeline and is worth no more than it.

---

## Not doing

- **No real client documents.** We have no sources for the nine, and the producer
  strings prove a source existed at export time, not that one is retrievable now.
  **Whether clients still hold their sources is a commercial question and it is
  not answered by running code.** Say so in FINDINGS and stop.
- **No `.docx` arm.** One control, one probe. Nothing more.
- **No source-remediation tool, library, or CLI.** Part 2's repairs are throwaway
  scripts in the scratch directory. YAGNI → KISS.
- **No pipeline changes.** Nothing under `*.java`, no stage runner, no fixture,
  no corpus edit.
- **No new comparator, scorer, or harness.** `compare.mjs` and `Inspect.java`
  unchanged.
- **No alt-text generation of any kind.** `[V]` Closed by Brief B. If a source has
  no alt, the correct output is no `/Alt`, and that is an omission we want.
- **No visual-fidelity scoring.** Re-flow is expected and is not a WCAG criterion.
- **No other exporters.** Not Pandoc, not Word itself, not Acrobat.
- **No holdout 2.** Sealed.
- **No product recommendation.** Rule 9. Do not declare the source path alive or
  dead, do not revise the roadmap, do not price anything. Report measurements.

## Stopping condition

Part 1 scored probe by probe, Part 2 scored on the 11, and the prediction checked
line by line → **stop**. If Part 1 hits the kill condition, record it and **do not
run Part 2** — a corpus number for a path that asserts is not worth having.

Everything else interesting goes on FINDINGS.
