# `StructText.Box` converted to page space (registration, 2026-09-25, before any gated look)

**What changed.** `StructText.harvest` now rotates each glyph's box out of the
frame PDFBox reports it in — the frame the text *reads* in, rotated by
`TextPosition.getDir()` — into page space, which is what the record's contract
has always claimed and what every consumer assumes. Diagnosis and evidence:
[`heading-stage2-2026-09-25-rotated-text-geometry.md`](../../research/document-remediation/heading-stage2-2026-09-25-rotated-text-geometry.md).

**Why this needs registering.** Card geometry feeds the marked page image, which
is a model input, and it feeds the rules (`margin_band`, `in_table_box`) and the
splits. Runs made before and after this change are not comparable.
`out/suggest/cohort8-r13` and `out/suggest/confirm-r13` were produced before it
and are spent for that purpose. Neither was rerun.

**Scope, deliberately narrow.** Only the `Box`. `Cards.harvest`'s glyph list
still uses the reading-frame accessors, because reading-frame coordinates are
the right ones for grouping glyphs into lines and for `first_line_x1`. The
consequence is measured below, not assumed.

## What moved, on cohort 8's 104 tagged copies

Old and new `StructText` compiled side by side; `Cards` run twice per document;
boxes compared exactly.

| | |
|---|---:|
| Blocks | 17,088 |
| Blocks whose box moved | **3,127** (18.3%) |
| Documents with a moved block | **24** of 104 |
| Cards (the suggestion pool) | 10,989 |
| Cards whose box moved | **2,322** (21.1%) |

Every document with no rotated text is byte-identical, old to new: upright text
has `dir == 0`, where the conversion is the identity.

Concentrated on rotated-content sheets: `c8-0142` 796 of 798 blocks, `c8-0034`
516 of 531, `c8-0265` 423 of 832, `c8-0319` 182 of 185, `c8-0220` 172 of 197,
`c8-0171` 163 of 286, `c8-0044` 129 of 256, `c8-0132` 107 of 524, `c8-0170`
92 of 132, `c8-0047` 78 of 78, `c8-0004` 72 of 300, `c8-0325` 60 of 147.

## Split-head counts, before and after

Both splits over the same 104 documents, run-in at the frozen validation width
**0.5** (`heading-stage2-run-in-split-validation-2026-09-22-results.md`):

| Split | Before | After |
|---|---:|---:|
| `split_enumerated_heads` | **54** | **54** |
| `split_run_in_heads` (0.5) | **304** | **311** |

**The r13 configuration is unaffected.** Cohort 8 ran
`--all-blocks --split-enumerated-heads`, with no run-in split, and the
enumerated count does not move — it cuts on `y0 + 1.3 em` and reads no `x`.

The run-in count moves by +7 net, on 12 documents, in both directions:
`c8-0034` 2→7, `c8-0293` 0→4, `c8-0220` 1→3, `c8-0004` 2→3, `c8-0047` 1→2,
`c8-0265` 4→5, `c8-0319` 1→2, `c8-0325` 3→4; and down `c8-0044` 22→17,
`c8-0132` 13→12, `c8-0250` 3→1, `c8-0171` 2→1.

## The run-in split is now inconsistent on rotated blocks — do not use it yet

`is_run_in_head` compares `first_line_x1 - x0` against `width_frac * (x1 - x0)`.
`first_line_x1` comes from `Cards.harvest`'s glyph list, which is still in the
reading frame; `x0`/`x1` now come from the box, which is in page space. On a
rotated block the two are **different frames**, so the ratio is meaningless —
and worse than before, when both were in the same (wrong) frame.

**47** of the 311 run-in splits land on a block whose box moved, against 40 of
304 before. The head/body cut has the same problem: it cuts `y1 = y0 + 1.3 em`,
which is the cross-line axis for an upright run and the *reading* axis for a
rotated one, so it now slices a few characters off a vertical run instead of its
first line.

Neither is a reason to keep the old frame — the old numbers were wrong about
where the text is. It is a reason to **fix `split_heads` before any look uses
`--split-run-in-heads`**: `Cards` should emit each block's `dir`, and both the
width test and the line cut should use it (or abstain on `dir != 0`).

## What a gated look must do with this

- Do not compare a run made under this change against cohort 8 or the r13
  confirmation batch. Say so, or do not make the comparison.
- `--split-enumerated-heads` alone is safe to run: 54 → 54, and the moved
  blocks it touches are none.
- `--split-run-in-heads` is not, until `split_heads` knows about `dir`.
- The first run under this change should report cards with no image
  (`cards` minus `with_image`) per document, as
  [`2026-09-24-marked-image-visibility-registration.md`](2026-09-24-marked-image-visibility-registration.md)
  asks. Two further defects in that path are diagnosed and **not** fixed here —
  `Mark.mapPixels` subtracting the crop origin a second time, and
  `StructText`'s cross-page MCID fallback. Both are in the research note.
