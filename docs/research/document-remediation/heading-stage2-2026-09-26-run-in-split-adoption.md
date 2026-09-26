# The run-in split: NOT ADOPTED, and it cannot address the class it was proposed for (2026-09-26)

Counts only. The guard registered in
`2026-09-25-split-heads-abstains-on-rotated-registration.md` made
`--split-run-in-heads` consistent again and unblocked this decision. Baseline:
the fixed-geometry re-measurement
(`heading-stage2-2026-09-26-cohort8-remeasure-results.md`), r13 at t_r13.

**No model run was made.** Two cheap exact measurements answer the question more
directly than an end-to-end run would, and both are stated below so the
reasoning can be checked. What was *not* measured is the flag's net effect on
covered errors; see "What this does not measure".

## 1. The split fires on 1 of the 58 run-in misses

The class the flag was proposed for is the 58 run-in-shaped FN (text over 60
characters) of the re-measurement's 97 FN. Running `is_run_in_head` at the
frozen width 0.5 over those exact blocks, in the product's order:

| | |
|---|---:|
| Run-in-shaped FN | 58 |
| **The split fires on** | **1** |

Why it does not fire on the other 57:

| Reason | Cards |
|---|---:|
| First physical line is over `MAX_HEAD_WORDS` (6) words | 36 |
| Block is not upright (the new guard) | 9 |
| First line ends in `.` `;` `:` | 5 |
| Only one physical line | 4 |
| Tagged `TD` | 2 |
| First line reaches past half the block width | 1 |

## 2. Why: the class is a same-line merge, not a short first line

`is_run_in_head` looks for a block whose **first physical line is the heading**
and stops short of the block width. The misses are not that shape. Their
heading is a *prefix inside* the first line, with the body running on after it:

- `Location Accuracy: Horizontal and vertical accuracy standards of spatial data`
- `Coordinate System and Unit of Measurement: Spatial data provided will be Montana`
- `SECTION 2. AMENDMENT. The City Council of the City of Lago Vista,`

The first line is full width and long, so every width and word-count gate
refuses it correctly. This is the shape
`heading-stage2-2026-09-22-same-line-probe.md` recorded as unreachable
(0 of 9 by style) and the run-in plan called "the same-line merge the split
cannot fix". It is now confirmed on a trustworthy measurement.

## 3. The whole upside is 2 cards, against 116 correct ones at risk

Every block the split fires on across the 104 documents, against the
re-measurement's labels and predictions:

| Where the 210 splits land | Cards |
|---|---:|
| On a card r13 currently gets **wrong** | **2** (1 FN, 1 FP) |
| On a card r13 currently gets right as `H` | 23 |
| On a card r13 currently gets right as non-`H` | 93 |
| On an ask, or a card with no label | 92 |

The best case is 2 of 133 errors. The 116 covered cards r13 currently gets right
are all re-cut into a head and a body, each scored afresh. Both earlier
measurements — 2026-09-22 on validation and the r14 step-2 run — found the split
moving cards into asks rather than into right answers, and both are void for
other reasons, but the direction agrees.

**Verdict: NOT ADOPTED.** `--split-run-in-heads` stays off.

## What this does not measure

The flag's net effect on covered errors end to end. That needs r13 re-run on the
**37** documents the split touches, plus blind judging of the new head and body
cards — roughly 2 h of model time and about 400 cards of judging. It was not
spent, because a flag that reaches 1 of 58 target cards and puts 116 correct
ones at risk does not become adoptable at any net number, and the class it was
meant to fix is provably out of its reach.

## What would address the class

A detector for a heading and its body on **one line**, separated by style
(weight, case, a colon) rather than by where the line ends. The 2026-09-22 style
probe reached 0 of 9 such cards, so this is not a small rule — it is a new
mechanism, and it needs its own registration and its own evidence that the
signal exists before any code.
