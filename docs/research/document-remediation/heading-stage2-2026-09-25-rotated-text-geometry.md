# Card boxes are in the text's reading frame, not page space (2026-09-25)

Chasing the 287 off-page card boxes recorded in
[`2026-09-24-marked-image-visibility-registration.md`](../../superpowers/plans/2026-09-24-marked-image-visibility-registration.md).
Off-page was the visible tip. The defect is larger and mostly silent.

## Root cause

`StructText.harvest` builds every `Box` from PDFBox's direction-adjusted glyph
coordinates:

```java
Box g = new Box(page, tp.getXDirAdj(), tp.getYDirAdj() - tp.getHeightDir(),
                tp.getXDirAdj() + tp.getWidthDirAdj(), tp.getYDirAdj());
```

`getXDirAdj()` / `getYDirAdj()` / `getWidthDirAdj()` / `getHeightDir()` are in
the frame the **text reads in** — rotated by `TextPosition.getDir()`. The
`Box` record's own contract says something else:

> Top-down page coordinates, matching what PDFTextStripper reports

For `dir == 0` the two frames coincide, which is why this has never shown.
For `dir` 90 or 270 the axes are swapped, so the box is transposed. `Cards`
then emits it as the card's `x0/y0/x1/y1`, and `Mark.mapPixels` maps it into
the page raster as if it were page space. `Cards.harvest` takes glyph x/y/width
from the same accessors, so first-line detection and `first_line_x1` (which
`--split-run-in-heads` measures against) inherit the same frame.

**Verified, not inferred.** For `c8-0004` mcid 427 (`dir` 90, page 2592x2016):
StructText's box is `[347.4 2506.7 352.6 2516.1]`; the inverse rotation
`page_x = adj_y, page_y = pageHeight - adj_x` gives `[2506.7 1663.4 2516.1
1668.6]`, and marking *that* lands the outline exactly on the vertical text run.
Marking c8-0004:137 (`"41 151"`) the same way encloses the bottom-to-top
lot label precisely.

## Two populations, one mechanism

`getDir()` is the run's own rotation in page space. `PDFMarkedContentExtractor`
never applies the page's `/Rotate` — pinned by a case in
`java-struct-text-geometry.test.ts`, because the obvious wrong fix is to fold it
in — so the page rotation is not part of the cause. What differs is how much of
a document is rotated:

**Whole sheets.** A landscape page is often authored by drawing a portrait
page's content rotated and setting `/Rotate` to stand it up. Then *every* block
transposes: `c8-0034` (516 of 531 blocks at `dir` 270), `c8-0142` (796 of 798
at `dir` 90), `c8-0319`.

**Scattered labels.** Survey plats, plans and maps with bottom-to-top text among
upright text: `c8-0004` (75 blocks upright, 72 at `dir` 90/270), `c8-0265`
(380 upright, 423 at `dir` 90).

The holdout fixture `experiments/document-remediation/holdout2/k07-rotated-headers`
was written to attack exactly this ("Rotated glyphs break the horizontal-line
grouping that reading order, caption association and header detection all rely
on"). This is that attack landing on real documents.

## Blast radius, measured

Per card, by whether any glyph behind its box had `dir != 0`
(probe: `StructText.find` + `PDFMarkedContentExtractor`, same walk as `Cards`):

| Run | Cards | Transposed box | Share |
|---|---|---|---|
| `out/suggest/cohort8-r13` | 10,989 | **2,331** | 21.2% |
| `out/suggest/confirm-r13` | 3,763 | **98** | 2.6% |

Of cohort 8's 2,331: **287 drew no mark at all** (the off-page count already
recorded) and **2,044 drew a mark on the wrong content** — the silent majority.
24 of 104 documents contain rotated text; 3 of 40 in the confirmation batch.

How those 2,331 were decided, from the sidecars: 1,125 by the model, 849 by a
rule, 357 became asks. A rule is not safer here — `margin_band` and
`in_table_box` read the same box.

Worked example: card `c8-0142:2`, text `"Account Number Account Title"` — a
column header on a rotated-content budget sheet. Before, its magenta box is a
tall narrow strip over an unrelated table column; after, it encloses the header
exactly. Both renders are in the session record.

## Per document (cohort 8, rotated cards: silently misplaced / unmarked)

`c8-0034` 380/70 · `c8-0142` 408/0 · `c8-0265` 238/0 · `c8-0319` 135/0 ·
`c8-0220` 122/37 · `c8-0171` 117/23 · `c8-0044` 93/23 · `c8-0132` 69/36 ·
`c8-0170` 57/25 · `c8-0047` 71/0 · `c8-0325` 55/4 · `c8-0262` 40/1 ·
`c8-0293` 40/0 · `c8-0168` 32/9 · `c8-0004` 18/54.

Note `c8-0142`, `c8-0265`, `c8-0319`, `c8-0047`, `c8-0293`: **zero** unmarked
cards, so nothing in the 344-card visibility measure pointed at them at all.

## Residual, not this cause

One cohort-8 block is off-page at `dir` 0: `c8-0004:141`, `"13820 SF"`,
`x1 = 2595.8` against a 2592-wide page — a glyph advance overhanging the media
box by 3.8 pt. It still drew a mark. Not the same defect.

## The fix, and what it moved

`StructText.harvest` now rotates each glyph's box back by `tp.getDir()` into
page space. Upright text has `dir == 0`, where the conversion is the identity,
so every document with no rotated text dumps byte-identically. Registered in
[`2026-09-25-struct-text-page-space-registration.md`](../../superpowers/plans/2026-09-25-struct-text-page-space-registration.md),
which carries the before/after measurement: 3,127 of 17,088 blocks moved,
2,322 of 10,989 cards, 24 of 104 documents; `split_enumerated_heads` 54 → 54,
`split_run_in_heads` at width 0.5 304 → 311.

`Cards.harvest`'s glyph list was deliberately left in the reading frame —
those coordinates are the right ones for grouping glyphs into lines. The cost
is that `first_line_x1` and the box width are now in *different* frames, so
`is_run_in_head`'s ratio is meaningless on a rotated block. The registration
says what to do about it; until then, do not run `--split-run-in-heads`.

`FigureOrder.Box` carries the comment "the frame `StructText.Box` uses" and is
built from the graphics CTM — real page points. That comment is now true for
rotated text too.

## Two more defects on the same path — fixed 2026-09-25

Both were diagnosed here and left for a separate change, registered in
[`2026-09-25-card-box-path-two-defects-registration.md`](../../superpowers/plans/2026-09-25-card-box-path-two-defects-registration.md)
before the code. Measured over the same 104 tagged copies, old and new
compiled side by side.

**`Mark.mapPixels` subtracted the crop origin twice.** PDFBox reports glyph
positions against the **crop** box, and `Preview` renders the crop, so a card
box is already crop-relative; `Mark` took the origin off a second time. The
mapping was copied from `Preview.java:37-47`, which is right to do it for a
`FigureOrder` box — that one is in media space, as its comment says. Confirmed
before the fix on `c8-0077`, whose page 0 crop is `[597.024 0 1224 792]` while
its 43 cards span `x0 = 31.9` to `x1 = 610.4`: inside the crop *width*, not the
media box.

| | |
|---|---:|
| Cards measured | 10,989 |
| Pixel rectangle moves | **505** |
| — of those, off the raster before | **55** |
| — and on it after | **55** |

The 55 are exactly the "outside crop window" family of the visibility
registration. Concentrated in `c8-0185` (293), `c8-0265` (148), `c8-0077` (64).
The `y` term was spurious the same way and read as zero wherever the crop
reaches the media top, which is why only `x` ever showed.

**`StructText.merge` took a box from another page.** It looked the MCID up on
the element's own page and, finding nothing, scanned every page and took the
first hit — and marked content ids restart at 0 on each page. `append`, the
text half of the same class, already refused that, and `Inspect.java:427`
refuses it for figure locations: *absent beats invented*. `merge` now matches
them.

| | Before | After |
|---|---:|---:|
| Blocks with a box | 14,480 | 12,973 |
| Blocks losing a fabricated box | | **1,507** |
| Blocks whose box shrinks to its true extent | | **140** |
| Suggestion pool (cards) | 10,989 | **10,732** |
| `split_enumerated_heads` | 54 | **54** |

The 1,507 match the 1,550 diagnosed above on a slightly different basis — that
count was blocks resolving to another page, this one is blocks that had a box
and now have none. Concentrated identically: `c8-0065` 976 of 1,097, `c8-0265`
163, `c8-0298` 68, `c8-0070` 60, `c8-0319` 35. The 140 are elements with
several MCIDs where only some resolved off-page, so the union shrinks rather
than vanishing.

**A third change the measurement forced.** `run.blocks_to_cards` refused a
block with empty text or no font size, and had never seen one with no box,
because the fallback always invented one. With the fallback gone,
`drop_duplicate_cards` met `x0 = None` and raised. A block with text but no
location cannot be a card — no marked image, no margin band, nothing for a
judge to look at — so it is now refused there as `missing_box`, in the same
shape as the two refusals above it. **257 of 10,989 cards (2.3%) leave the
pool.** That is the honest count, not a loss: each was a card whose image
showed an unrelated page, and abstention was never available for it, because
the model still answers whatever it is shown.

## Closed on this path

`split_heads` now knows. `Cards` emits each block's `text_dir` — the direction
its glyphs agree on, `null` when they differ — and both splits leave a block
whole unless it is upright and has a box
([`2026-09-25-split-heads-abstains-on-rotated-registration.md`](../../superpowers/plans/2026-09-25-split-heads-abstains-on-rotated-registration.md)).
On cohort 8: 3,139 blocks are not upright, `split_enumerated_heads` is
unchanged at 54, and `split_run_in_heads` at width 0.5 drops 297 → 250, the 47
the page-space registration predicted.

`--split-run-in-heads` is consistent again, in one frame on the blocks it
still acts on. It is **not** thereby adopted: it has never passed an adoption
measurement, and the two it has had are void — the first compared two
coordinates in the same wrong frame, the second ran on contaminated cards.
