# The 120-document test: what conversion earns, and what repair only appears to

**Date:** 2026-08-27. The test
[the predictions file](remediation-test-predictions-2026-08-27.md) was
registered for: **120 documents** — 61 through Arm A (conversion, the
shipping path: 30 authored `.docx` + 31 real municipal Word documents) and 59
through Arm B (the PDF-repair spike, reopened by decision over the settled
STOP: 28 generated + 31 real PDFs). Two instruments everywhere — the
product's `Inspect` reading and veraPDF UA-1 — with the spike's ground-truth
comparator adding the semantic verdict where truth exists.

Structure-only throughout, as ever. Bytes local, manifests tracked
(`real-sources-word.md`, the original nine in `real-sources.md`; one of the
nine has gone dead since 2026-08-24 and the real PDF count is honestly 31
via 23 fresh harvests).

## The one-table version

| | delivered | both instruments green | semantically true |
|---|---:|---:|---:|
| **Arm A generated** (30) | 28 (2 honest refusals) | 19 | keys: 0 invented claims |
| **Arm A real** (31, incl. 7 legacy `.doc`) | **31** | 13 | truth: 0 invented claims |
| **Arm B generated** (28) | 28 tagged | **23** | **2** — 62 false assertions across 20 docs |
| **Arm B real** (31) | 31 tagged | **2** | unauditable — no ground truth exists |

**Conversion delivers and its claims survive audit. Repair produces
conformance whose claims do not.** That 23-vs-2 split on the same 28
documents is the sharpest sentence this project has produced about the two
paths.

## Arm A against its predictions

| prediction | called | measured |
|---|---|---|
| real delivered ≥ 90% | ✓ | 31/31 — legacy `.doc` included, beating its own ~70% sub-prediction |
| both-green 40–60% | ✓ | 13/31 (42%) |
| gap order 2.4.2 then 1.1.1 | ✓ | 2.4.2 ×9 · 1.1.1 ×3 |
| invented claims 0 | ✓ | 0 across all 61 — after the fix below |
| heading fidelity ≥ 95% | **✗** | 21/24 (87.5%) |
| parity 10/10 | ✓* | 10/10 on every structural field, language and gap; two title-kind diffs are the harness comparing conversion *provenance* to post-hoc *inspection* of a now-titled file |

`[V]` **The generated half's first run caught a shipping product bug**:
language inflation at docx *import* — declared-nothing arriving as `en-US`,
bare `en` widened, `es`→`es-ES`, `ar`→`ar-SA` — upstream of the export-time
invention the pipeline already corrected. Fixed same day
([#140](https://github.com/Ruckus000/ada-auditor/pull/140)): the language is
now read from the `.docx`'s own bytes. Five violations → zero, and the
no-language document now honestly ships no `/Lang`, which veraPDF honestly
flags — the dual bar catching its own fix's consequences.

`[V]` **First measured transcription loss**: three real documents lost 3–4
headings each (tables survived 24/24, figures 23/24). Mechanism unprobed —
the top follow-up. List counts disagree in the *other* direction (source 1 →
delivered 12): counting semantics between `w:numId` groups and the PDF's L
structures, not content loss; second follow-up.

`[V]` **Municipalities declare headings three ways** — `HeadingN` styles,
direct-formatting `w:outlineLvl` with zero styles in the body (four
documents), and custom digit-less styles whose level lives only in the style
definition. The truth extractor grew twice, each growth forced by a real
document through the pre-registered falsifier clause.

## Arm B: the reopened question, answered with sharper teeth

Prediction: real deliverable 0–2 of 30; blockers title+alt ≥ 80%; STOP
confirmed. Measured: **real 2 of 31 (6.5%)** — inside the band. The two are
text-simple documents (no tables, no figures) whose heading assertions no
instrument can audit. Blocking: 2.4.2 on 19 documents; the remainder fail
UA-1 with zero Inspect-visible gaps — conformance clauses beyond the gap
vocabulary.

The generated half is where the reopening paid for itself, by *missing* its
prediction in the informative direction: 23/28 conformance-deliverable
(predicted 15–25%) — and then the spike's own ground-truth comparator, run
over the same 28 files:

```
DELIVERABLE 2/28 · NEEDS_REVIEW 21/28 · INCONCLUSIVE 5/28
false assertions: 62 across 20/28 documents
```

Wrong heading levels asserted confidently, "DRAFT" and chart labels tagged as
headings, placeholder alt ("image 1") presented as descriptions, one table
fragmented into two. **Machine conformance and true claims are different
properties, and only the second is remediation.** The 4-of-195 wrong table
headers `table-header-verification.md` measured was this same phenomenon at
smaller scale.

**Verdict on the reopened question: the STOP stands, strengthened.** Not "0
reachable" but: what conformance instruments call reachable is contaminated
with false assertions in 71% of documents where truth is checkable, and
unauditable where it is not. A future revisit needs a semantic-truth
instrument for real documents before its numbers can mean anything.

## What the test infrastructure itself learned

Recorded because the next corpus effort will hit every one:

- **Uniform verdicts are grader bugs.** Twice: all-30 refused (runner cwd
  starved the JVM resolver of its classpath); all-59 blocked by 3.1.1 (the
  grader fabricated `sourceLanguage: null` into the provenance and then
  graded its own fabrication). A result with no variance is the instrument
  talking to itself.
- An optional regex group inside a lazy match is silently skipped — find the
  block, then look inside it.
- `execFileSync`'s environment is not your shell's: veraPDF intermittently
  found the macOS stub `java` until the JDK was pinned per call.
- Playwright serializes functions *after* esbuild's `keepNames` wraps them
  (`__name is not defined`, from the Arm A collector work) — page code ships
  as strings.

## Follow-ups, in evidence order

1. Heading transcription loss (3 real docs, −3..−4 each): find the mechanism.
2. List-count semantics: define which instrument's count the fidelity oracle
   should trust, then re-grade.
3. The empty-docx adjudication: delivery stands as defensible (an empty
   paragraph is structure); the frozen key's refusal prediction is recorded
   as the author's miss.
4. Arm B's UA-1-only failures (15 documents, zero Inspect gaps): name the
   dominant clauses — the gap vocabulary may deserve one or two additions.
