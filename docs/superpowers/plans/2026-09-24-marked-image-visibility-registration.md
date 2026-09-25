# Marked images: minimum outline, and no image when the box is off the raster (registration, 2026-09-24, before any gated look)

**Why this needs registering.** The marked page image *is* a model input. Any
change to how the magenta box is drawn changes what the classifier sees, so no
run made with the change below may be compared against a run made without it.
Cohort 8 (`out/suggest/cohort8-r13`) and the r13 confirmation batch
(`out/suggest/confirm-r13`) were produced by the old drawing and are not
rerun; both are spent for this purpose.

## What was measured

Cards whose model-input image (`image`, the 408-token reduced copy) contains no
magenta pixel at all (`R>200, G<80, B>200`):

| Run | Cards | No magenta | Share |
|---|---|---|---|
| `out/suggest/cohort8-r13` | 10,989 | **344** | 3.13% |
| `out/suggest/confirm-r13` | 3,763 | **12** | 0.32% |

**The cause is not sub-pixel boxes.** The opening hypothesis was that a
glyph-sized box is drawn thinner than a pixel and averaged away by the
408-token reduce. Reproducing each of the 344 through `Mark.mapPixels` and
comparing the full-size marked copy (`image_full`) against the reduced one:

| Shape | cohort8-r13 | confirm-r13 |
|---|---|---|
| Mapped outline entirely off the raster — box coordinates past the page box | 287 | 12 |
| Mapped outline entirely off the raster — box inside the part the **crop box** cuts away | 55 | 0 |
| Drawn on the full raster, only the edge column survived, lost in the reduce | 2 | 0 |
| Sub-pixel stroke lost in the reduce | **0** | **0** |

The two "edge column" cards are the same off-raster family: `c8-0077`'s crop
box starts at x=597 of a 1224-wide page, their boxes start at x=32 and x=222,
and only the right edge of the outline landed at column 0. Drawing a 3 px
stroke around a 3x6 px box and reducing it bicubically keeps 6–16 magenta
pixels over white, black, yellow and navy backgrounds — the reduce was never
the loss.

Off-raster distance is not a near-miss: median 177 px, max 1,200 px, min 2 px.

Concentration (cohort 8): `c8-0034` 70, `c8-0077` 57, `c8-0004` 54, `c8-0220`
37, `c8-0132` 36, `c8-0170` 25, `c8-0044` 23, `c8-0171` 23, `c8-0168` 9, and
1–4 each in `c8-0117`, `c8-0262`, `c8-0315`, `c8-0325`, `c8-0343`. Large-format
sheets and cropped pages, as expected.

**Diagnosed since, and larger than this.** *Why* a block reports coordinates
past the page box (287 of 344) is a separate defect in the card geometry:
`StructText` builds its `Box` from PDFBox's direction-adjusted glyph
coordinates, which are in the text's reading frame, not page space, so every
box behind rotated text is transposed. Off-page is only the detectable part —
**2,331 of cohort 8's 10,989 cards (21.2%)** carry a transposed box, and 2,044
of them drew a magenta outline around unrelated content. See
[`heading-stage2-2026-09-25-rotated-text-geometry.md`](../../research/document-remediation/heading-stage2-2026-09-25-rotated-text-geometry.md).
Recorded, not fixed.

## The change

Two parts, both in `experiments/qwen-role-decisions/Mark.java` and its Python
callers.

**1. A floor on the outline (`MIN_MARK = 12`).** `markRect` returns the mapped
box inflated by 2 px, grown about its centre when that outline would come out
under 12 px on a side. An outline already at or over 12 px is returned
unchanged, so **every normal-size box keeps the geometry the released marked
images were drawn with, pixel for pixel**. This fixes 0 of the 344: it is a
floor with margin over the reduce, not a repair of a measured loss.

**2. No image rather than an unmarked page.** `Mark` now reports `visible` —
whether the outline puts any ink on the raster — and, in its writing form,
exits 3 without writing a PNG when it does not. `key_context.marked_image`
returns `None` for that card, so it reaches the model as a text-only prompt
instead of as a page whose prompt says "the box drawn in magenta" over a page
that has none. `run.ensure_marked_png` and `labels/render.py` raise instead,
because both promise a file.

This is the part that changes model inputs, for the ~3% of cards on
large-format and cropped pages. `image: None` is already a supported path
(`predict.cli_args` omits `--image`).

## What a gated look must do with this

- Any look comparing against cohort 8 or the r13 confirmation batch is
  comparing across a model-input change. Say so, or do not make the
  comparison.
- The first run under this change should report how many cards lost their image
  (`cards` minus `with_image`), per document. A document where most cards go
  text-only is a geometry defect to chase, not a result.
