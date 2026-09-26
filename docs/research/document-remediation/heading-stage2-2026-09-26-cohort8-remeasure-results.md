# Cohort 8 re-measured on fixed geometry: the error rate did not move (2026-09-26)

Counts only. **Registration:**
`docs/superpowers/plans/2026-09-25-cohort8-remeasure-registration.md` (111bbb2,
with one amendment disclosed there). **Not a look and not a pass claim:** cohort 8
is spent and partly folded into r14's training. r13 and t_r13 = 0.98081102556551
are unchanged; only the instrument changed.

## The answer

| | Look, 2026-09-24 | Re-run, fixed | |
|---|---:|---:|---|
| Covered | 8,953 | 8,762 | |
| **Errors** | **133** | **133** | unchanged |
| FP / FN | 38 / 95 | 36 / 97 | |
| Accuracy | 0.9851 | 0.9848 | |
| Accuracy LB (exact 95 %) | 0.9824 | 0.9820 | |
| FP UB | 0.0061 | 0.0059 | |
| Clean documents | 64/103 | 65/103 | |
| Error rate | 1.49 % | **1.52 %** | |

**Four defects, 21 % of cards mis-boxed, and the error count is identical.**
That is the finding. The instrument was genuinely broken and had to be fixed;
it was not what r13's error rate was made of.

## The two named classes survive

| Class | Look | Re-run |
|---|---:|---:|
| FN on run-in headings (text over 60 chars) | 55 of 95 | **58 of 97** |
| FP on cards the seats label `TH` | 23 of 38 | **22 of 36** |

Both are real, and both are slightly larger than the corrupt measurement said.
The error documents are the same ones: `c8-0022` 19, `c8-0187` 12, `c8-0114` 11,
`c8-0117` 9, `c8-0220` 8, `c8-0317` 8, `c8-0206` 7.

## Why the defects cost so little here

- **The errors were never in the broken documents.** 25 of 133 errors sat in a
  defect-affected document at the look, and 25 of 133 do now. The documents that
  carry the errors — `c8-0022`, `c8-0187`, `c8-0114`, `c8-0117`, `c8-0206`,
  `c8-0317` — are in neither the rotated set nor the cross-page MCID set. They
  were always measured on correct geometry.
- **On the cards that were fixed, r13 does slightly better**: 12.3 errors per
  1,000 covered on the 2,439 re-judged cards against 16.3 on the 6,323 whose
  label was reused. The fixes helped exactly the cards they touched. There were
  not enough of them to move the total.

This does not make the fixes optional. Before them, no number from this corpus
could be trusted in either direction, and the fixes turned up two crashes
(`missing_box`, `KeyError: 'x0'`) and an invisible-mark defect in the judges'
own sheets. It means the **model** problem was always the real one.

## Run and labels

- **Model:** 104 of 104 documents, 0 failures, 6.27 h of compute. 10,732 cards,
  8,762 covered, 1,970 asks, 3,083 rule-decided, 54 enumerated splits.
- **Cards with no image: 0**, against 344 at the look.
- **Labels** (`out/labels/cohort8-fixed-labels.jsonl`): 6,323 reused where the
  card's box, mapped rectangle and text are all unchanged; 2,439 re-judged.
  383 H.
  - Seats covered 2,439 boxes each, 0 missing or duplicated.
  - **Heading-bit agreement 0.9967**, against 0.9917 at the look: judges agree
    more when the box is around the text they are asked about.
  - 8 disagreements, against 74. Six are one repeated title in `c8-0319` (three
    resolved H, two Artifact) and two are garbled scan text in `c8-0220`.
- **Errors by provenance:** 103 on reused labels, 30 on re-judged ones.

## What follows

- **The instrument is sound and the model is the problem.** Three training
  rounds have not moved the run-in class, and it is now confirmed at 58 of 97
  FN on a trustworthy measurement.
- **Cohort 9 stays held**, unspent and untouched.
- r14 is not revived by this: its training fold and its validation comparison
  both drew on the corrupt cards, and it failed its guard on keys validation.
