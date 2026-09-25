# Two more defects on the card-box path (registration, 2026-09-25, before the code)

Both were diagnosed and left unfixed by
[`heading-stage2-2026-09-25-rotated-text-geometry.md`](../research/document-remediation/heading-stage2-2026-09-25-rotated-text-geometry.md),
landed as f632a28. They are independent of rotation and of each other. Card
geometry is a model input and is read by `margin_band` and `in_table_box`, so
this registers before the code, as the page-space change did.

## Defect A: `Mark.mapPixels` subtracts the crop origin twice

`Mark.mapPixels` was copied from `Preview.java:37-47`, whose comment says why
it adjusts: **"FigureOrder uses unrotated top-down media coordinates."** A
`FigureOrder.Box` comes off the graphics CTM, in media space, so Preview is
right to move it into the crop.

`Mark`'s input is not that. It is a card box, built by `StructText.harvest`
from `TextPosition`, and PDFBox reports text positions relative to the **crop**
box. The origin is already gone, so removing it again drives the box off the
raster.

**Measured here, not taken from the note.** `c8-0077` page 0 has
`crop=[597.024, 0, 1224, 792]` on a media box of the same width. Its 43 cards
span `x0 = 31.9` to `x1 = 610.4` — inside `[0, 626.976]`, the crop *width*. Media
coordinates would put them in `[597, 1224]`. They are crop-relative.

**Fix.** Drop both adjustments: `x = x0`, `y = y0`. The `y` term
(`y0 + crop.getUpperRightY() - mediaBox.getHeight()`) is spurious for the same
reason and is zero whenever the crop reaches the top of the media box, which is
why only `x` has shown. Rotation, scaling and the `dw`/`dh` swap are unchanged.

**Scope.** `Mark` only. `Preview` is correct for its own input and is not
touched. Every `Mark` caller (`run.mark_page_png`, `labels/render.py`) passes a
card box, so no caller passes media coordinates.

## Defect B: `StructText.merge` takes a box from another page

`merge` looks the MCID up on the element's own page, and when that page has no
entry for it, **scans every page and takes the first hit**. MCIDs restart at 0
on each page, so the box can come off an unrelated page.

The codebase has already decided this question twice:

- `append`, the text half of the same class, falls back **only** when the
  element has no `/Pg` at all. With a page in hand it returns empty rather than
  scan. The asymmetry is the defect: text is right, boxes are not.
- `Inspect.java:427` refuses the same fallback for figure locations, in terms
  that apply unchanged here: *"MCIDs restart at 0 on each page, so that path can
  return the WRONG page ... Absent beats invented."*

**Fix.** Make `merge` match `append`: scan all pages only when `page == null`.
No new concept, no new flag.

**Expected consequence.** The note measured **1,550 of 17,088 blocks (9.1%)**
taking a box from another page, concentrated in `c8-0065` (978 of 1,097),
`c8-0265` (163 of 832), `c8-0298` (74 of 398), `c8-0070` (61 of 187),
`c8-0319` (36 of 185). Those blocks lose their box. A block with no box is not a
card, so the suggestion pool shrinks. **That is the point**: a card whose image
shows an unrelated page was never a usable input, and an ask is not available
for it either, because the model still answers whatever it is shown.

## What must be measured before any gated look uses this

On cohort 8's 104 tagged copies, old and new compiled side by side, as the
page-space registration did:

1. Blocks with a box, before and after; blocks that lose one, per document.
2. Cards in the suggestion pool, before and after.
3. Cards whose mapped pixel rectangle moves (defect A), and how many were off
   the raster before and are on it after.
4. `split_enumerated_heads` before and after.

Reported, not gated: these are correctness fixes, and there is no version of
"the wrong page was better". A number that surprises is a reason to stop and
look, not a reason to keep the old behaviour.

## Consequences

- Runs made before this are not comparable with runs after it, exactly as for
  the page-space change. `out/suggest/cohort8-r13` and `out/suggest/confirm-r13`
  were already spent for that reason.
- `--split-run-in-heads` stays unusable until `split_heads` knows each block's
  `dir`. Unchanged by this.
- No model is retrained and no look is run here.
