# Figure geometry and identity — results

**Date:** 2026-09-02. Predictions: `figure-geometry-predictions.md`,
registered before this run. Instrument: `Inspect` at the tree that adds
`FigureOrder.locate` (box, image digest, filter per figure).

## Correction to the predictions, logged rather than edited

The predictions named `experiments/document-remediation/real-pdf` as "the
52 real PDFs". That directory holds the 20-document phase-0 sample; the 52
real PDFs of the blind corpus live under `blind-corpus/real/`, regenerated
for this run by `harvest.mjs` from the two name maps (78 of 84 documents came
back; 6 sources have gone offline since the corpus was built, none of them
PDFs in the 52). The numbers below are over the 52; the 20-document sample
is reported beside them for completeness. The thresholds stand as
registered.

## Numbers

Over the 52 real PDFs (`^[rn]\d+\.pdf$`), every one read, none failed, 27.8 s
wall for the whole set.

| measure | count | share | prediction | outcome |
|---|---:|---:|---|---|
| open figures (no alt, placeholder or decorative-only) | 380 | — | — | — |
| located — a `box` | 168 | **44.2 %** | ≥ 55 %, falsified < 50 % | **falsified** |
| identified — an `imageDigest` | 168 | **44.2 %** | ≥ 55 %, ≥ located | **falsified**; the ≥ located half held |
| collapsed — repeats of an earlier image in the same document | 33 | **8.7 %** | ≥ 20 %, falsified < 10 % | **falsified** |
| documents where grouping halves the open figures | 2 (n19, n22) | — | ≥ 3 | **falsified** |
| readings that fail | 0 | — | 0 | held |
| cost against the previous stages | not measured | — | < 2× | **unmeasured** — no pre-change timing was taken on this corpus; 27.8 s for 52 documents is recorded as the new baseline |

The 20-document phase-0 sample: 8 open figures, 6 located (75 %), 0 repeats.

## Why the pass stops at 44 %

Not the page rule. The pass refuses to search every page for a marked-content
id whose element declares no `/Pg`, and on the five worst documents **zero**
open figures lack a page. The limiter is what a figure IS:

| document | open figures | image XObjects in the file | located |
|---|---:|---:|---:|
| r05 | 101 | 62 | 16 |
| r04 | 52 | 18 | 16 |
| n30 | 18 | 3 | 0 |
| r06 | 7 | 5 | 0 |
| n24 | 3 | 0 | 0 |

A document with 101 figures and 62 images has at least 39 figures that draw
no image at all — rules, charts and boxes drawn as paths, or a `Figure` a
tagger wrapped around text. An image-only pass cannot identify those and,
by design, reports null rather than a guess. The probe (`Figures.java` in
the spike) reached 43.8 % on the same population for the same reason;
descending nested kids, which this pass adds, bought almost nothing.

Where images ARE the figures the pass works as intended: r09 locates 38 of
38 and collapses 16 of them into 22 groups; r19 10 of 10; r15 12 of 14. The
digest is exact — one XObject drawn on every page hashes once — so where
page furniture exists, one description lands on every repeat.

## What this changes

- **Grouping stays.** It is correct where it applies, costs one pass, and
  on r09 turns 38 descriptions into 22. It is not the lever the prediction
  hoped for: across the corpus it removes 33 of 380 acts, not 76+.
- **The crops trigger is stricter than the plan assumed.** A rendering step
  built on this pass would show a crop for 44 % of open figures. Reaching
  the rest needs path geometry — the union of every path point drawn under
  the figure's marked content — which is the next measurable step if a
  pilot shows the page jump is the bottleneck. It is not built here, because
  nothing consumes it yet.
- **The workbench's context line** (heading, neighbouring text, caption
  from reading order) is available for every figure regardless, and is the
  part of "show the human the figure" that reaches 100 %.

## Predictions scorecard

Held: 2 (identified ≥ located; zero failures). Falsified: 3 (located,
collapsed, halved documents). Unmeasured: 1 (cost). The falsifications are
kept on the record as the reason the crops deferral now names path geometry
as its precondition.
