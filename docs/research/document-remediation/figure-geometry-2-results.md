# Figure geometry, second pass: paths — results

**Date:** 2026-09-03. Predictions: `figure-geometry-2-predictions.md`,
registered before this run. Instrument: `Inspect` at the tree where
`FigureOrder.ImageFinder` records painted paths as well as images, measured
by `experiments/document-remediation/measure-figure-geometry.mts` over the
52 real PDFs of `blind-corpus/real/`.

## Numbers

Every one of the 52 read, none failed.

| measure | before | after | prediction | outcome |
|---|---:|---:|---|---|
| open figures (no alt, placeholder or decorative-only) | 380 | 380 | — | — |
| located — a `box` | 168 (44.2 %) | **379 (99.7 %)** | ≥ 75 %, falsified < 60 % | **held** |
| identified — an `imageDigest` | 168 (44.2 %) | 168 (44.2 %) | unchanged | held |
| collapsed — repeats of an earlier image in the same document | 33 (8.7 %) | 33 (8.7 %) | unchanged | held |
| documents halved by grouping | 2 (n19, n22) | 2 (n19, n22) | unchanged | held |
| boxes located before, unchanged to the float | — | 148 of 168 | image-only boxes unchanged; image-plus-path boxes may widen | held — see below |
| readings that fail | 0 | 0 | 0 | held |
| wall, whole corpus | 26.6 s | 26.1 s | ≤ 2× (≤ 53 s) | held — within noise of the before-timing |
| `INSTRUMENT_VERSION` | 12 | 12 | 12 | held |

The five documents the first pass named as its limiter, again:

| document | open | images in the file | located before | located after |
|---|---:|---:|---:|---:|
| r05 | 101 | 62 | 16 | 101 |
| r04 | 52 | 18 | 16 | 52 |
| n30 | 18 | 3 | 0 | 18 |
| r06 | 7 | 5 | 0 | 6 |
| n24 | 3 | 0 | 0 | 3 |

The one figure still unlocated is r06's: a `Figure` element on page 1 whose
marked content carries reading-order text and paints neither an image nor a
path. The pass reports null for it, which is the honest answer — a crop of
nothing is not a crop.

## The 20 boxes that changed

All 20 were figures that draw an image AND paths under the same marked
content; every one kept its digest, and every new box contains the old one
(checked to a thousandth of a point). None moved. Three shapes:

- **A border stroke around the image** — r19's ten figures, r21, r04 and
  r05: the box grew by a quarter- to two-point frame on each side.
- **A caption rule or a bar beside the image** — n21 (two figures, 7 pt
  taller), r09 (15 pt wider), r15 (a few points taller).
- **A page-sized path under a small image** — n22's two figures went from
  10 × 10 pt to 532 × 719 pt and 527 × 341 pt: the tagger put a full-page
  (or half-page) filled path inside the figure's marked content, and the
  union is faithfully the whole page. A crop built on this box would show
  the page, not the logo. Recorded, not corrected: the box is what the
  document draws under that element, and a rule that discards "too large"
  paths would be a guess about intent. The crop step, when it comes, can
  prefer the image's own box where one exists — both are available from the
  same pass, and that is a decision for the consumer, not the reading.

Stroke widths are not part of the geometry: a hairline rule drawn `m l S`
has a zero-height box. That is its geometry; a crop needs a margin anyway.

## Correction, logged rather than edited

**Kind: instrument defect, found by the measurement and fixed before these
numbers.** The first run of the path pass reached 352 (92.6 %), and r11 went
from 14 to 15 located out of 36 while a count of its content streams showed
22 figure spans painting paths under the right marked-content id on the
right page. Every one of those 22 opens with `/PlacedPDF /MC0 BDC` — a nested
sequence naming a property list in the page's `/Resources /Properties`, with
no MCID of its own — and the marked-content stack pushed `−1` for any
sequence whose operand was not an inline dictionary, so the paths inside were
attributed to nothing. Two things were wrong at once: a nested sequence with
no id of its own belongs to the element whose sequence encloses it, and an id
may arrive by name (`/Span /P1 BDC` with `/P1 << /MCID 4 >>`) as well as
inline. Both are fixed in `FigureOrder.ImageFinder.processOperator`, both are
pinned in `java-inspect.test.ts` (`pathFiguresPdf`), and the image half of
the pass benefits equally: an image drawn inside a `/PlacedPDF` sequence was
invisible before this and is not now. The identified count did not change on
this corpus, so no image on these 52 documents was hidden that way; the fix
is on the record because the next corpus may differ.

The predictions doc is unchanged: the 75 % bar was cleared by the first run
and by this one, and the defect changes the mechanism's reach, not its
promises.

## What this changes

- **The crop precondition is met.** The first pass deferred crops on path
  geometry; this pass locates 379 of 380 open figures, so a rendering step
  has a box for every figure it would be asked to show but one. What remains
  in front of crops is the pilot's number — whether the page jump is the
  bottleneck at all — which is the trigger the plan already names.
- **Grouping is unchanged**, as predicted: a path has a place and no
  identity, and the digest-keyed groups, the answer-mismatch preimage and
  `figureGroups` are untouched.
- **The fidelity gate still holds.** `box` sits inside `figures`, a content
  field, so `contentChanges` compares it; both sides of a run are read by the
  same `Inspect`, and `java-finish.test.ts` now asserts the fixture's three
  path figures carry boxes and that `Finish` leaves every one where it was.
  Readings stored before either pass have no `box` key and are never diffed
  against a fresh reading — the gate compares two readings from one run.

## Predictions scorecard

Held: 7 (located, identified, collapsed, existing boxes, cost, zero
failures, instrument version). Falsified: 0. Unmeasured: 0. One instrument
defect found and fixed during the run, logged above.
