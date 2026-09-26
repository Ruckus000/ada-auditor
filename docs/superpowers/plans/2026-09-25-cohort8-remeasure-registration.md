# Cohort 8 re-measured on fixed geometry (registration, 2026-09-25, before the run)

**Not a look, and not a pass claim.** Cohort 8 was looked at on 2026-09-24
(`heading-stage2-2026-09-24-cohort8-look-results.md`), and its labels are now
training and validation data for r14 (`out/keys-r14-c8`). It is spent. This
re-run buys one thing: **what r13's error rate actually is**, measured on
inputs that are not corrupt.

## Why it is worth the GPU

The look was scored on cards where the instrument was wrong four ways, all
since fixed:

| Defect | Cards affected | Fixed in |
|---|---:|---|
| Box in the reading frame, not page space | 2,331 (21.2%) | f632a28 |
| `Mark` subtracting the crop origin twice | 505 | 1f33dd66 |
| Box taken off another page | 1,507 blocks | 1f33dd66 |
| Mark too small to survive the reduce | 344 | 330ed00 |

The verdict itself is not in doubt — 133 errors against 71 allowed, with only
25 of them in affected documents. What is unknown is the **size** of r13's real
error rate and whether its two named error classes are real. Every decision
after this rides on that number, and it has been wrong twice.

## The run

`labels.suggest --adapter out/overnight/12-train-r13/adapter-r13 --threshold
0.98081102556551 --all-blocks --split-enumerated-heads`, one run per document,
over the same **104** documents in the same registered order
(`out/suggest/cohort8-r13/population.json`). Output: `out/suggest/cohort8-fixed`.

- **The model and threshold are untouched.** r13 never trained on cohort 8, so
  it is as unseen for r13 now as it was then. Only the instrument changed.
- `--split-run-in-heads` stays off, as in the look.
- The code is the branch head at this commit.
- Cards with no image are reported per document, as the visibility registration
  asks.

## Labels: reuse what is still the same question

A card keeps its look label when **its own** box, mapped rectangle and text are
all unchanged. Everything else is judged blind again, under protocol v2.1, by
the same seats — `claude-opus-5-5` medium and `claude-fable-5-1` medium — with
three `claude-opus-5-5`-high runs deciding any disagreement.

Re-judged: a card whose box moved, whose mapped pixel rectangle moved, whose
text changed, or that did not exist before.

**Disclosed:** page sheets carry up to 12 boxes, so a sheet is rebuilt whenever
any card on it moves. A card keeping its label may therefore sit on a rebuilt
sheet, with another card's box drawn elsewhere. The card's own box and text are
identical; only its neighbours' marks differ.

## Reported

1. Covered, errors, FP/FN, accuracy with its exact interval, FP upper bound,
   clean documents — beside the look's numbers, with both marked as measuring
   different things.
2. Cards that left the pool, cards with no image, and asks.
3. **The two named classes**, recounted: run-in heading FN (55 at the look) and
   table-header FP (23). Whether each survives is the question r14 was trained
   to answer and could not.
4. Errors by decider and by resolution, as before.

## What this cannot be used for

- **Not a gate result.** The documents are spent, the labels partly reused, and
  the fixes were made after reading the look's errors.
- It does not revive r14, whose training fold and validation comparison both
  drew on the corrupt cards.
- Cohort 9 stays held and untouched.

## Amendment during implementation (2026-09-26, before any judge ran)

**The judges' sheets carried the defect the model's images had fixed.**
`page_sheets.draw_sheet` kept its own copy of the outline geometry — the mapped
box inflated by 2 px — and knew nothing about the `MIN_MARK` growth added in
330ed00. A glyph-sized box therefore reached a judge as an outline a few pixels
across, the same invisibility the visibility registration fixed for the model.
The registered pixel check found it: `c8-0004:100` read 5.0 px against a 3 px
limit, because the check compared a grown outline against an ungrown
expectation.

`draw_sheet` now draws the rectangle **Mark reports drawing**
(`markX/markY/markW/markH`), so there is one definition of the outline and the
sheets match the model's images. For any box at or above `MIN_MARK` the
rectangle is identical to what it drew before, so every sheet already released
is unaffected. The check compares against the same rectangle.

**Tolerance.** The check allowed 3 px, measured on a sheet that is usually not
scaled. `c8-0005`'s one page is upscaled 1.062x to reach `SHEET_WIDTH`, and Mark
rounds each edge independently at the target size, so the same rounding arrives
scaled: 3.05 px. That single card has failed the check since the cohort-8 look,
where it was disclosed and worked around by eye. The tolerance is now 3 px **in
the reference image's frame** (`3 x max(1, scale)`), which leaves it exactly as
tight as it has always been on an unscaled sheet and stops a permanently red
guard from being ignored. The check reports its tolerance and scale per card.

With both changes the check passes on all five sampled documents. The 2,439
sheets for this re-measurement were rebuilt afterwards, so no judge saw the old
geometry.
