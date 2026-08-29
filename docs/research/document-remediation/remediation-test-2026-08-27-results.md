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

### Results

Two runs happened, and the space between them is the finding. The first
re-run's promise check — every non-green delivery must carry a named gap or
punch item — surfaced exactly one silent real document: r13, UA-1 red on
7.4.2 with an empty punch list. Its nine headings all sit at H2 or deeper,
which is not a skip *between* consecutive headings and so slipped the
version-2 check. The deep start is the same authorship decision as a
mid-document skip, so it became the same kind of 2.4.10 item,
`INSTRUMENT_VERSION` moved to 3 (a new item on an unchanged document must
read as our vocabulary growing, not the client's document changing), and
`a35-starts-deep` joined the corpus as the shape's permanent witness. The
numbers below are the version-3 run.

| | delivered | both instruments green | matches its frozen key |
|---|---:|---:|---:|
| generated (35 strata) | 33 (+2 designed refusals) | 26/33 | 32/33 — the one deviation is `a15-empty`, the adjudicated delivery |
| real (31) | 31/31 | **23/31** | — (truth-graded) |

Invented claims: **0 across all 64 delivered documents.** Real-corpus
fidelity: headings **31/31**, tables 29/31, lists 27/31, figures 30/31 (the
table/list drifts are all inside the labeled `.doc` engine-derived-oracle
caveat from the alignment phase).

Every real shortfall, itemized — this is the punch list working:

| documents | UA-1 clause | the item a person gets |
|---|---|---|
| r16 · r21 · r24 · r26 | 7.4.2 | "Heading levels skip from HX to HY — decide whether the author meant an HX+1" |
| r13 · r09 | 7.4.2 | "Heading levels start at H2 — decide whether the document should begin at an H1" |
| r01 (×2) · r07 · r09 | 7.3 | "Figure N needs a human-written description — no alt text, and no caption to transcribe one from" |

### The predictions, scored

1. **Falsified.** Generated both-green was 26/33 against a registered ≥ 30.
   A prediction-authoring error, not a regression: five strata (`a06`, `a09`,
   `a20`, `a22`, `a26`) exist to exercise gaps and punch items and cannot be
   green by construction, and the registered number failed to subtract them.
   The named exceptions both held — `a15-empty` was the sole key deviation,
   and `Document1` refused its junk filename.
2. **Held, with the disclosure above.** Real 23/31, inside the 23–24 band.
   The five predicted 7.4.2 documents are exactly the five — but r13's punch
   item only exists because the promise check caught its absence mid-campaign.
   The prediction said the items would be there; on the version-2 instrument,
   one was not.
3. **Held for the real corpus (31/31 green-or-itemized), one generated
   exception, named.** `a20-emoji` delivers with no gap and no item while
   UA-1 fails it on 7.21.7-1 (glyph-to-Unicode mapping) — a converter font
   artifact, not an authorship decision, in vocabulary neither instrument
   surfaces as work. Zero real documents hit it; it is recorded as a known
   gap rather than chased.
4. **Held.** With both graders on veraPDF's JSON report, no UA-1-red document
   anywhere has an empty `failedRules`.
5. **Held exactly** — all four fidelity numbers as registered.
6. **Could not run — and the reason is its own finding.** Production's
   `AUDITOR_RUN_TOKEN` was rotated ~21 hours before this run (Vercel env
   metadata; the value is sensitive-typed and readable by no one), and the
   new value matches no local secret. Every request with the token that
   authenticated all of this session's earlier production work now answers
   the app's own 401 — which means **every machine caller of production is
   locked out**, not just this harness. The parity subset (r01–r10, authored
   filenames, summaries diffed against the local version-3 evidence) is
   scripted and waits only on a working token; the number lands here as a
   dated addendum once access is restored.

### Scoring the campaign's own bar

**The registered number is missed: 23/31 both-green against ≥ 26.** The
eight documents that keep it there split 5 heading-decision + 3
human-description — every one carrying its item, none fixable without
inventing content the author didn't write. The campaign's promise —
*fully conformant on both instruments, or a per-item human punch list;
never a silent gap, never an invented claim* — measures **31/31 real,
64/64 delivered minus the one named generated exception (`a20-emoji`)**,
and 13 → 23 both-green is what the campaign actually moved. The number
registered was the wrong proxy for the promise; the promise itself is the
product, and it now holds on every real document.

---

## Addendum, 2026-08-29: the parity subset ran

Access restored (the operator reset `AUDITOR_RUN_TOKEN` and redeployed), and
the measurement registered above finally ran: the same ten real Word
documents (r01–r10, authored filenames) through the **same shared core**
locally and on the deployed function, current code both sides
(`INSTRUMENT_VERSION` 6, conformance verdicts included), summaries diffed
field by field.

**Result: 8/10 identical. The registered 10/10 was missed, and both misses
are one finding — the exact class the prediction named.**

r01 and r02 differ only in `conformance` (and the punch item derived from
it): production's output fails **UA-1 7.21.7-1** (glyph-to-Unicode mapping)
where local output does not. veraPDF names the font: **`LinuxLibertineG`** —
on the production image, LibreOffice resolves these documents' typeface to
its bundled Linux Libertine G, whose used glyphs lack a `toUnicode` map; on
macOS the same converter resolves to a font that maps cleanly. Same code,
different font catalogs, different bytes. The instrument agrees with itself
on both sides; the *artifacts* differ.

Two things worth saying plainly:

- **The product handled its own difference correctly.** The production
  delivery carries the catch-all punch item naming 7.21.7-1 — the clause
  arrived as work, not as silence, which is what the second instrument
  shipped to guarantee.
- **Conversion output on production can be less conformant than the same
  conversion locally**, because the deployed font environment is poorer. That
  is now a measured fact with a named font, not a suspicion — and the honest
  scope of any local both-green count is "on this font environment". A
  follow-up worth having: pin the converter's effective font set so the two
  environments stop being different instruments.

