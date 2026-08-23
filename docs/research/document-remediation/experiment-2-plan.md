# Experiment 2 — closing the semantic gap

**Status:** plan, not started. Experiment 1 concluded PROCEED WITH CONDITIONS at
8% straight-through, as measured by compare.mjs. Nothing here is a production
feature.

## Question

Can straight-through remediation be raised from 8% using **only deterministic
and extractive techniques plus documented OpenDataLoader configuration** — no
vision model, no frontier API?

The deterministic system has to fail before AI earns a place in the pipeline.

## Gate

**≥80% of the deterministically reachable subset, with zero semantic false
positives anywhere.**

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
5. **Missing-title policy.** Not a technique but a decision: three documents fail
   only on `dc:title`. A client-supplied title is category A. Deriving one from
   the largest text on page 1 is inference and needs a decision before it is
   built.

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
| **Synthetic holdout** — 10–20 new | Did it generalise? |
| **Real-world** — later | Does it survive contact with reality? Not in this experiment. |

**The holdout is generated and committed before any remediation code is
written, and is not inspected during tuning.** Per-document failures on it are
not looked at; it runs once, at the end, and only the aggregate is reported.
Without that rule the holdout quietly becomes a second development corpus —
particularly since the same person authors it and writes the fixes.

## Non-goals

No Florence-2, no Moondream, no frontier API. No production code, database,
queue, UI or caching. No real-world documents. No per-document tuning. No
modification of the development corpus.

**Experiment 2 is allowed to fail.** If deterministic and extractive techniques
cannot clear the gate, that is the evidence that a model tier is genuinely
required — which is a far stronger basis for adding one than a research
document predicting it.
