# Experiment 2 — closing the semantic gap

**Status:** plan, not started. Experiment 1 concluded PROCEED WITH CONDITIONS at
8% straight-through, as measured by compare.mjs. Nothing here is a production
feature.

## Question

Can straight-through remediation be raised from 8% using **only deterministic
and extractive techniques plus documented OpenDataLoader configuration** — no
vision model, no frontier API?

The deterministic system has to fail before AI earns a place in the pipeline.

## Gates — two, and the first is the important one

**1. Zero false assertions on the holdout. Hard failure.**

A *false assertion* is the pipeline stating something that contradicts ground
truth: placeholder alt text presented as a description, a decorative graphic
described as content, an invented heading, a caption bound to the wrong figure,
TH on a cell that is not a header, OCR text laid over a page that already had a
correct text layer.

It is distinct from an *omission* — no alt, no heading, no TH. Omissions are
honest and a human sees the gap. Assertions mislead, and they look like success:
"image 1" fills the Alt slot, satisfies veraPDF, and leaves a reviewer no signal.

`compare.mjs` separates the two and exits non-zero on any assertion. **A lower
delivery rate with zero false assertions beats a higher one with any.**

**2. ≥80% of the deterministically reachable subset.**

Expressed against the reachable subset rather than the whole corpus, because
the corpus has a ceiling. Four of the twelve development documents — 06, 08, 10,
11 — cannot pass by deterministic means by construction: uncaptioned meaningful
figures, no title to copy, per-passage language. That is **33% undeliverable by
design**, so the ceiling is 8/12 and a corpus-wide 60–70% gate would sit on it.
A gate you can only meet by loosening `DELIVERABLE` is worse than no gate.

**A semantic false positive is any document marked `DELIVERABLE` that carries a
known ground-truth defect.** One of these fails the experiment regardless of
rate. A lower delivery rate with zero bogus passes beats a higher one with
`"image 1"` certified as accessible.

## Prerequisite — the part that is not on the technique list

**An automated ground-truth comparator.**

In Experiment 1 the `DELIVERABLE` / `NEEDS_REVIEW` split came from a hand-written
map in `report.mjs`, populated by me inspecting output. That was defensible for
twelve documents inspected once. It cannot support a gate: "zero semantic false
positives" measured by the person trying to pass the gate is not a measurement,
it is an opinion with a table around it.

So before any remediation work, build a checker that reads
`<name>.ground-truth.json` and the remediated PDF and reports, per document:

- every figure's `Alt` value, and whether it matches the caption ground truth
  rather than a placeholder
- tables detected, and whether `/TH` exists where header relationships are
  specified
- heading levels against the authored hierarchy — the thing Experiment 1
  explicitly could not verify
- text presence where the ground truth says there is text
- decorative graphics: marked as artifact, not described

`DELIVERABLE` becomes a computed verdict from validator plus comparator. Nobody
types it.

## Techniques, each a bounded sub-experiment

1. **Caption → alt-text association.** The highest-value case: document 05
   already contains the correct human-written descriptions and the pipeline
   wrote `image 1` over them. Recovering information already in the document,
   not understanding anything.
   **Needs a confidence boundary.** Proximity plus a `Figure N:` pattern is
   mostly deterministic but has real failure modes. When no caption associates
   confidently, the figure falls to `NEEDS_REVIEW` — never a best guess.
   Extraction earns its place by being checkable against a source; a guessing
   extractor forfeits that.
2. **Table header semantics.** No `/TH` was produced anywhere, including on the
   fully ruled table in 03. Note this is inference, not preservation: the input
   is untagged, so there were never header cells to lose. Test documented
   configuration first.
3. **Borderless table detection** via `tableMethod: cluster`.
4. **OCR** via the self-hosted hybrid server (`opendataloader-pdf[hybrid]`).
   Costs and infrastructure to be recorded — it is a second service.
5. **Heading inference.** Promoted to a first-class technique on evidence rather
   than intuition: headings independently block documents that have no figures
   and no tables at all. It is also the largest single source of false
   assertions after placeholder alt text — 6 on the development corpus, and on
   the holdout it is the dominant failure.
   Both directions must be handled. h01 has four large non-headings; h02 has
   five headings at body size and weight. A size threshold that fixes one breaks
   the other.

6. **Missing-title policy.** A client-supplied title is category A. Deriving one
   from page content is inference, and the holdout pins the boundary: **h12 has
   an unambiguous visible title that extraction should recover; h13's largest
   text is a DRAFT watermark and its second largest a classification marking.**
   A largest-text-wins rule passes h12 and titles h13 "DRAFT", which is a false
   assertion. Either solve the pair or decline both and report NEEDS_REVIEW.

## Tuning rule — changed from Experiment 1

Experiment 1 forbade touching configuration, and that was right for measuring a
baseline. It would be an excuse for laziness here.

**Documented configuration options are now in scope, chosen globally.** Pick
configuration using the development corpus, **freeze it**, then evaluate. Never
tune per document. A setting that helps 04 and hurts 03 is a finding to record,
not a per-document switch to add.

## Corpus discipline

Three corpora, and the ordering is what makes the middle one mean anything.

| Corpus | Role |
|---|---|
| **Development** — the existing 12 | Discover problems, choose configuration. **Not modified to accommodate fixes.** |
| **Synthetic holdout** — 16, frozen and committed | Did it generalise? |
| **Real-world** — later | Does it survive contact with reality? Not in this experiment. |

**The holdout is generated and committed before any remediation code is
written, and is not inspected during tuning.** Per-document failures on it are
not looked at; it runs at predefined checkpoints only — the baseline below, and
one final evaluation — and only the aggregate is reported. Without that rule the
holdout quietly becomes a second development corpus, particularly since the same
party authors it and writes the fixes.

Documents and ground truth are not altered after seeing results unless a fixture
is demonstrably wrong, and any such correction is documented explicitly.

### Baselines, both recorded before any remediation

| | Development (12) | Holdout (16) |
|---|---|---|
| DELIVERABLE | 1 — 8% | **2 — 13%** |
| NEEDS_REVIEW | 8 | 12 |
| INCONCLUSIVE | 3 | 2 |
| **False assertions** | **26 across 9/12** | **25 across 11/16** |
| Omissions | 14 | 12 |

The holdout is doing its job. Two findings from the baseline worth carrying
forward:

- **Reading order is a strength, not a gap.** h09 (three columns plus a spanning
  banner) and h10 (three sidebars beside a main column) are the only two
  DELIVERABLE documents, both clean. XY-Cut++ handles layouts harder than
  anything in the development corpus.
- **Heading detection fails in both directions on adjacent documents.** h01
  yields `["H1","H1","H1","H1","H2","H3"]` against a ground truth of
  `["H1","H2","H2"]`; h02 yields `[]` against five real headings. Any single
  threshold satisfies at most one of them.

Corpus design detail in
[`experiments/document-remediation/holdout/README.md`](../../../experiments/document-remediation/holdout/README.md),
which is canonical.

## Non-goals

No Florence-2, no Moondream, no frontier API. No production code, database,
queue, UI or caching. No real-world documents. No per-document tuning. No
modification of the development corpus.

**Experiment 2 is allowed to fail.** If deterministic and extractive techniques
cannot clear the gate, that is the evidence that a model tier is genuinely
required — which is a far stronger basis for adding one than a research
document predicting it.
