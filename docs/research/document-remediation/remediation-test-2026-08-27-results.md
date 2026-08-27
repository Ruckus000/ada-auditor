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

---

## Follow-up, 2026-08-27 evening: re-scored after the remediation-gaps campaign

The original numbers above are the record of the first run and stay as
written. This section re-scores the same corpora after the seven-phase
campaign that the first run's shortfalls demanded (empty-heading deletion,
UA-1 clauses named via the JSON report, filename-derived titles, caption-
derived alt plus the punch list, instrument alignment, PDF source-pairing).

### Predictions, registered before the re-run

Committed before the runner started, same discipline as the original test.

1. **Generated (now 34 strata — four added by the campaign):** ≥ 30 of 34
   both-instruments green. Named exceptions expected: `a15-empty` delivers
   (the adjudicated frozen-key miss — an empty paragraph is structure) and
   `a33-junk-filename` delivers with the honest 2.4.2 gap, because its
   authored name (`Document1.docx`) is exactly what the junk-refusal exists
   to refuse.
2. **Real (31):** 23–24 both-green — the conversion pipeline is unchanged
   since the last measured 23, so a materially different number means the
   instruments moved, not the documents. The five author-skip documents stay
   UA-1 red on clause 7.4.2 and carry their 2.4.10 heading-skip punch items;
   renumbering an author's levels would be invention.
3. **The promise, checked per document:** every non-green delivery carries at
   least one named gap or punch-list item. Zero silent gaps, zero invented
   claims (`title`/alt provenance labels asserted throughout).
4. **Clause naming:** with both graders now reading veraPDF's JSON report,
   `failedRules` is non-empty for every UA-1 red — the first run's blank
   column cannot recur.
5. **Fidelity (real):** headings 31/31, tables 29/31, lists 27/31,
   figures 30/31 — unchanged from the Phase-5 measurement, same reasoning
   as (2).
6. **Production parity subset (10):** identical summaries local vs deployed,
   including the filename-derived titles this campaign added.

### Scoring against the campaign's own bar

The campaign's definition of done set **≥ 26/31 real both-green**. The
prediction above says 23–24: the numeric bar will likely be missed, because
five documents *cannot* go green without inventing heading levels their
authors skipped — the punch list is the designed outcome for them. The
result below reports both readings: the number as registered, and the
promise (green or itemized work, never silence) checked per document.

_Results follow the run._
