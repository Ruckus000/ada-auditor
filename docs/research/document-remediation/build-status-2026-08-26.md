# Build status — the tool, not the experiment

**Date:** 2026-08-26 · The first status written about **shipping code** rather
than measurements. [position-2026-08-25.md](position-2026-08-25.md) remains the
statement of what the pipeline can and cannot reach;
[legal-standard.md](legal-standard.md) remains the definition of the goal. This
says where the *product* is against that goal, and what to build next.

---

## 1. Where we are in the process

| phase | state |
|---|---|
| Spike — measure the ceiling of deterministic remediation | **complete** |
| Productise the boundary — get stages into `src/` under the normal gates | **in progress, 2 of ~9 stages** |
| A caller — intake, job model, route | **not started** |
| The provenance record — machine-asserted vs human-verified | **not started** |

`[V]` Two stages now run from `src/integrations/documents/` through a typed,
schema-validated boundary: **`Inspect`** (reads structure) and **`Finish`**
(writes title/lang/XMP). Both are covered by the fast suite with an injected
executor and by a real-JVM suite in the push gate.

`[V]` **Nothing in production can call either of them.** There is no intake
path, no job model and no route. The capability exists; the product does not.

## 2. Are we building what we set out to build?

Measured against the seven criteria in
[legal-standard.md](legal-standard.md#what-good-remediation-is):

| criterion | | state in `src/` |
|---|---|---|
| document title | 2.4.2 | **graduated** (`Finish`, copies — never invents) |
| declares its language | 3.1.1 | **graduated** (`Finish`, caller-supplied, no default) |
| contrast checked and flagged | 1.4.3 | built, not graduated (`Contrast.java`) |
| structure — headings, lists, true header relationships | 1.3.1 | built, not graduated; **partly unsolved** |
| reading order meaningful | 1.3.2 | `Inspect` reports it; nothing repairs it |
| meaningful images carry alt text | 1.1.1 | **no safe automated option exists** |
| form fields labelled | 4.1.2 | **nothing at all** |
| *a record of what a human verified vs what a machine asserted* | — | **nothing at all** |

**Honest answer: yes, but we have productised the two easiest criteria first,
and the sequencing now needs to change.**

That sequencing was defensible: `Inspect` had to come first because it is the
measuring instrument that makes every later repair checkable, and `Finish` was
the only repair that neither deletes nor invents semantics. Both are done.

**The misalignment is what comes next.** The evidence says real client documents
are rescued by the **source path** — `.docx` in, not PDF in — and none of that
path has graduated.

## 3. The number that should drive the roadmap

`[V]` **PDF-in / PDF-out: 0 of 9 real documents reachable with zero human input.**
`[V]` **Word-in: a real municipal agenda came out veraPDF UA-1 conformant, zero human input.**

The source path sidesteps the two blockers the PDF path cannot solve:

- **Title** blocks 4 of 9 real PDFs *and nothing else*. It cannot be copied from
  a heading, because `[V]` all four produce **zero headings**. From a `.docx`,
  the title is in the file's own metadata.
- **Heading promotion** is unsolved and both candidates are dead
  ([heading-promotion-options.md](heading-promotion-options.md)). From a `.docx`,
  Word heading styles survive the export intact — there is nothing to infer.

Alt text (5 of 9) is unsolved on either path and should stop being treated as
in-scope for automation.

## 4. What we have learned, and how it changes the plan

**1. `[V]` Validating against something we control produces false confidence.
Four times now — including once this week, by me, after writing the warning
down.** The synthetic HTML corpus made `FixScope` look essential: 13 assertions
removed. On real documents it fired **0 times, on all three**. And in this
session my `Finish` invariant test passed green while proving nothing, because
the fixture was an *untagged* PDF — zero structure elements, empty arrays — so
the check was asserting that empty stays empty.

→ **Plan change: every new stage gets a real-input check before it is believed.**
The fixture is now tagged, and a separate test asserts the fixture *has*
structure so it cannot silently regress. That guard-the-guard pattern is now the
standard, not an extra.

**2. `[V]` The ceiling is the author, not the tool.** One real Word file has no
headings whatsoever. Real Excel produces **0 `/TH` across 151 tables and 5,235
cells** — and Acrobat's own PDFMaker produced 0 across 144. We cannot add
semantics nobody authored.

→ **Plan change: stop treating Excel as a near-term target.** It needs a
different answer entirely, not another repair stage.

**3. `[V]` "Already tagged" is not "accessible", and the gap is commercial.**
Professionally-produced tagged PDFs carry 0 `/TH` across 145 tables. Our source
path beats the clients' own toolchains. That is the pitch.

**4. `[V]` Assertions are the risk, not omissions.** 195 table header cells were
asserted into nine real documents and **4 are wrong**, verified by nobody. A
wrong header is not a missing fix; it is a manufactured barrier shipped with a
confident report.

→ **Plan change: the provenance record is not a phase-5 nicety.** It is the last
line of the legal standard, and this platform is already "evidence-first"
everywhere else. `contentChanges` is the first piece of it.

**5. `[V]` Scale makes alt text worse, not better.** The VLM fabricated a
regulatory requirement under a real city department's name — fluent, plausible
and undetectable.

→ **Plan: alt text is a human queue, permanently. Design for that rather than
against it.**

## 5. The plan

**Next — graduate the source path.** It is the only path with a real-document
success, and it dissolves title and heading promotion rather than solving them.

1. `repair-source.py` → **port to Node.** It is 99 lines and now does exactly one
   thing (copy `dc:title` from the document's own first heading, never invent).
   That is regex over flat XML, and porting removes **Python** from the
   production dependency set entirely.
2. A **LibreOffice runtime** in `src/integrations/documents/`, resolved and
   reported exactly like the JVM — `available: false` is a state, not an error.
3. The chain: `.docx` → `.fodt` → title repair → tagged + `PDFUACompliance`
   export → `FixScope` → `Inspect` to verify.
4. `FixScope` graduates with it, with its own statement of what it may change —
   `contentChanges() === []` is the **wrong** bar for a stage that is supposed to
   alter scope.

**Then — a caller.** Intake, a job model for long-running conversions, a route,
and the artifact/finding wiring onto `domain/artifacts.ts` and
`services/findings-view.ts`.

**Then — the provenance record.** Every claim in a delivered document labelled
transcribed / asserted / human-verified.

## 6. The decision this defers, and when it stops being deferrable

`[V]` The JVM is **host-local**. Vercel functions have no Java, so
`/api/ready` reports `documentToolchainAvailable: false` on every deployment,
permanently and by design. Adding LibreOffice makes that strictly worse — it
certainly cannot run in a serverless function.

That is survivable while we are building capability, and it is **blocking the
moment we want a client-facing route.** A container worker is already recorded in
`AGENTS.md` as the answer for long-running work; document conversion is now the
second thing that needs it.

**Recommendation: keep building host-local, and treat the worker as the gate on
"a client can use this" rather than on "the code exists".** Deciding it now,
before the source path is proven in `src/`, would be designing infrastructure
around a pipeline we have not finished assembling.

## 7. What is deliberately not being built

- **Alt text automation.** Closed by measurement, twice.
- **Excel table headers.** No source of truth exists in the input.
- **A second `FixScope`-style repair aimed at one real document.** That is the
  mistake in lesson 1, and it has been made three times.
- **Holdout 2.** Still sealed, both checkpoints unspent.
