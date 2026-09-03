# Figure geometry, second pass: paths — predictions, registered before measurement

**Date:** 2026-09-03. **Change:** `FigureOrder.ImageFinder` learns paths.
Today every path method on the engine is an empty stub and
`getCurrentPoint()` returns the origin; the pass records images only, and a
figure drawn as paths — a rule, a chart, a box — locates nothing. After the
change, a path painted inside a figure's marked content contributes its
bounding box to the figure's `box`, and nothing else moves: no digest for a
path (a different identity relation, cut by the plan), no change to `Inspect`'s
output shape, `INSTRUMENT_VERSION` stays 12 because no criterion enters or
leaves the gap vocabulary.

**What it exists for.** The first pass (`figure-geometry-results.md`) located
44 % of open figures and named path geometry as the precondition for the
deferred crop step. The limiter was what a figure IS: r05 has 101 open
figures and 62 images, so at least 39 of them draw no image at all. This
pass is the measurable next step that document named.

## Instrument

`experiments/document-remediation/measure-figure-geometry.mts` — committed
this time; the first pass's script never was. It runs `inspectDocument` over
`blind-corpus/real/*.pdf` (`^[rn]\d+\.pdf$`, 52 files), counts open figures
by the product's own `figurePrior`, and reports located (`box`), identified
(`imageDigest`), collapsed (repeats of a digest within one document),
documents halved by grouping, and wall time. With a baseline JSON it also
checks every previously located box to the float.

## Before-timing, on the tree before the change

Same script, same corpus, run once on the unchanged tree so the cost bar has
a number under it this time:

| measure | count | share |
|---|---:|---:|
| open figures | 380 | — |
| located | 168 | 44.2 % |
| identified | 168 | 44.2 % |
| collapsed | 33 | 8.7 % |
| halved by grouping | 2 (n19, n22) | — |
| readings failed | 0 | — |
| wall | **26.6 s** | — |

This reproduces the first pass's 380 / 168 / 44.2 % exactly, which is the
evidence the committed script measures the same thing the uncommitted one
did.

## Mechanism, and the two mistakes the tests exist to catch

PDFBox 3.0.8 hands `moveTo`/`lineTo`/`curveTo`/`appendRectangle` coordinates
**already transformed by the CTM** (`PDFStreamEngine.transformedPoint`). The
accumulator is min/max over the incoming floats plus the same
`pageHeight − yMax` flip the image path uses; applying the CTM again would
place a `2 0 0 2 0 0 cm` figure at four times its size. A pending bbox is
committed to the enclosing marked-content id only on the paint operators
(`strokePath`, `fillPath`, `fillAndStrokePath`, `shadingFill`); `endPath` —
the `n` after `W` — discards it, or every clipping rectangle inside a figure
becomes the figure's box; `clip` stays a no-op. The current point must be
real, or `h`, `v` and `y` leak `(0, 0)` into every box. Curves are bounded by
their control points, a superset of the curve — safe for a crop, and said so
in the code.

## Registered predictions (over `blind-corpus/real`, the 52 real PDFs)

1. **Located** — open figures with a `box`: **≥ 75 %** (before: 44.2 %).
   Falsified below 60 %, in which case the unlocated remainder is not paths
   but something else — a `Figure` wrapped around text, or marked content
   the element does not reference — and the crop precondition moves again.
2. **Identified** — open figures with an `imageDigest`: **unchanged at
   168 (44.2 %)**. A path carries no digest; a figure with both an image and
   paths keeps the image's. Any change here is a defect.
3. **Collapsed** — **unchanged at 33 (8.7 %)**, and the halved documents stay
   n19 and n22, for the same reason.
4. **Every box the first pass located is unchanged to the float** — 168 of
   them. A path inside a figure that already drew an image may only widen the
   union, so this is stated precisely: an image-only figure's box does not
   move; an image-plus-path figure's box may grow and is reported as such.
5. **Cost** — whole-corpus wall time **≤ 2×** the 26.6 s before-timing
   (≤ 53 s). The engine already walks every operator; the change adds a few
   float comparisons per path point.
6. **Zero readings fail**, as before: the pass stays wrapped, and a content
   stream it cannot parse degrades to nulls.
7. **`INSTRUMENT_VERSION` stays 12.** No gap enters or leaves; the reading
   gains geometry, not verdicts.

Results follow in `figure-geometry-2-results.md`, with any correction to the
keys or these predictions logged by kind.
