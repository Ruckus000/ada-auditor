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

## Two more defects on the same path, diagnosed and not fixed

**`Mark.mapPixels` subtracts the crop origin twice.** PDFBox reports glyph
positions relative to the **crop** box (its `pageSize`), and `Preview` renders
the crop, so a box is already crop-relative. `Mark` then subtracts
`crop.getLowerLeftX()` again. On `c8-0077`, whose crop box starts at x=597 of a
1224-wide page, card `c8-0077:13` (`"Council hears recap of master plan
projects"`) maps to x=-1129 and nothing is drawn; adding the crop origin back
puts the outline exactly on the headline. This is the 55-card "outside crop
window" family of the visibility registration. The `y` term
(`y0 + crop.getUpperRightY() - mediaBox.getHeight()`) is spurious for the same
reason and happens to be zero whenever the crop reaches the top of the media
box, which is why only `x` has shown.

**`StructText` resolves an MCID on the wrong page.** `merge` and `append` fall
back to scanning every page's MCID map when the element's page has no entry for
that id, and marked-content ids restart at 0 on each page — the hazard
`Inspect.java:427` already refuses to take for figure locations. Measured over
the same 104 documents: **1,550 of 17,088 blocks (9.1%)** end up with a box from
a page other than their own `/Pg`. Concentrated: `c8-0065` 978 of 1,097,
`c8-0265` 163 of 832, `c8-0298` 74 of 398, `c8-0070` 61 of 187, `c8-0319` 36 of
185. `c8-0034:34` is one: a `Figure` with `ActualText` `"image 5"` on page 2,
whose box came off page 0's MCID 20 — its outline sits on `"7.000"` in an
unrelated paragraph. This is independent of rotation and is **not** fixed by the
conversion above.
