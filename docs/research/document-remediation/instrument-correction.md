# The instrument was blind in one direction, and the numbers move

**Date:** 2026-08-25 · Fixed in `c951e3a`. Raw re-scores in
[evidence/](evidence/) under `rescored-*.json`.

## What was wrong

`compare.mjs` asserted on **too many** `/Figure` elements and never on **too
few**. `06-images-uncaptioned` lost all four of its meaningful images and scored
**DELIVERABLE with zero defects**.

**Root cause, which is not a missing comparison.** Every check in the file was
written in the direction of the failure being chased when it was added. The
figure check was added while the pipeline was *over*-tagging — placeholder alt on
decorative graphics. Nothing has over-tagged since, and when abstention began
*removing* structure, no check faced that way. Tables, headings and lists were
all already symmetric; figures were the sole gap.

The same cause left `mustNotBeHeadings`, `mustNotBeTitle` and `mustNotBeTables`
unread — **fixture fields authored specifically to catch assertions**, never once
consulted.

## The corrected numbers

### Abstention, on the 28 development documents

| | as published | **corrected** |
|---|---:|---:|
| **assertions** | 8 | **13** |
| **DELIVERABLE** | 8 | **6** |

`[V]` Per document:

| document | was | now | why |
|---|---|---|---|
| `06-images-uncaptioned` | 0 assertions | **1** | 3 Figures for 4, **2 images still on the page** |
| `12-kitchen-sink` | 0 assertions | **1** | 3 for 4, 5 images still on the page |
| `07-complex-chart` | **DELIVERABLE** | NEEDS_REVIEW | 0 for 1, no image behind it — omission |
| `h11-chart-labels-as-headings` | **DELIVERABLE** | NEEDS_REVIEW | same |
| `h01-big-text-not-heading` | 1 assertion | **2** | **"SUPERSEDED" tagged as a heading** |
| `h13-first-big-text-not-title` | 1 assertion | **3** | **"DRAFT" and "COMMERCIAL IN CONFIDENCE" tagged as headings** |

**The abstention gain is smaller than banked but real:** 16 → 13 assertions
rather than 16 → 8, and 5 → 6 DELIVERABLE rather than 5 → 8.

**The three watermark assertions are the more interesting half.** The pipeline
has been tagging DRAFT and COMMERCIAL IN CONFIDENCE as document headings the
whole time. The fixtures said not to. Nothing read them.

### Brief C's arms, on the same 11 documents

| | Arm C | Arm N | Arm R | **Arm R+UA** |
|---|:--:|:--:|:--:|:--:|
| assertions, as published | 1 | 20 | 17 | **17** |
| **assertions, corrected** | 1 | **20** | **21** | **21** |
| DELIVERABLE, as published | 3 | 0 | 0 | **2** |
| **DELIVERABLE, corrected** | **2** | 0 | 0 | **0** |

**`[V]` Arm R+UA has no deliverable documents at all**, and four of its
twenty-one assertions were invisible.

## The finding this exposes, which matters more than the arithmetic

**`[V]` Brief C's `alt=""` → decorative repair is harmful.** All four new
assertions come from it:

| document | result |
|---|---|
| `06-images-uncaptioned` | 0 Figures for 4 expected, **8 images still drawn** |
| `05-images-captioned` | 2 for 3, 1 image still drawn |
| `08-slide-layout` | 0 for 1, 1 image still drawn |
| `11-deliberately-inaccessible` | 0 for 1, 2 images still drawn |

The repair takes an image the author left with an empty `alt` and marks it
decorative. **An author who left `alt` empty because the image is decorative and
one who simply did not fill it in are byte-identical in the source** — Brief C
recorded exactly this as FINDINGS 3 and called it "honest, deterministic, and it
deletes meaningful images." It is worse than that: deleting them is an
**assertion**, because the reader is told nothing is there and the validator
passes clean.

**This does not damage the core finding — it sharpens it.** The *exporter* only
omits; that survives every probe. It was **our repair** that asserted. The
lesson is that a source-side repair is not automatically safe just because it is
deterministic, and R2 must be dropped or inverted before the source path is
measured again.

## What this does not change

`[V]` The exporter's honesty across Brief C's ten probes stands — nothing there
turned on figure counts. `[V]` The decorative-image *mechanism* still works: a
source that genuinely marks an image decorative exports it as an artifact
correctly. The defect is in inferring "decorative" from an empty attribute.

`[V]` Brief B's conclusion is untouched — it never used this comparator.
