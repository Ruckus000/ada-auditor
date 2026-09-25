# r14: results (2026-09-25)

Counts only. **Registration:** `docs/superpowers/plans/2026-09-25-r14-registration.md`
(6d98c98, committed before any build). The test split was not evaluated.

## Step 1: cohort 8 folded (ed6a8e2)

**Module.** `labels.cohort_overlay` works on the r13 keys overlay. The host
split uses salt `cohort8-r14` at a train share of 0.70. Output:
`out/keys-r14-c8`.

| Arm | Hosts | Documents | Rows | H |
|---|---|---|---|---|
| Train | 58 | 79 | 6,422 | 323 |
| Validation | 20 | 24 | 2,531 | 69 |

**SFT set** (`out/r14/sft`, r13's exact emit flags):
- 7,965 rows against r13's 5,572: H 3,739, P 3,338, TH 545, Lbl 183, Artifact 66,
  Caption 54, TOCI 40.
- Held back: 2,020 rule-decided rows and 3,445 `Other` rows.
- sha256 `07ee09bd…`.

## Step 2: run-in split, NOT ADOPTED

**Setup.** r13 at t_r13 on the 24 cohort-8 validation documents, rerun with
`--split-run-in-heads 0.5`.
- The split made 70 new cards. 122 covered cards were new or changed and were
  judged as in the look; the seats agreed on all 122, so no tie-break ran.
- Unchanged cards keep their look labels.

| | Cards | Covered | Errors | FP | FN | TP | Asks |
|---|---|---|---|---|---|---|---|
| No split (the look) | 2,883 | 2,531 | 21 | 6 | 15 | 54 | 352 |
| Split, width 0.5 | 2,953 | 2,580 | **24** | **9** | 15 | 55 | 373 |

**Decision.** The registered rule adopts the split only if covered errors fall
and FP does not rise. Errors rose by 3 and FP by 3, so the split is not adopted.
The cohort-9 product path keeps it off.
- This agrees with the 2026-09-22 validation result: the split mostly moves
  cards into asks and does not recover run-in headings as answers.
- Labels for the 122 cards: `out/labels/cohort8-runin-judges/labels.jsonl`.

## Step 3: r14, GUARD NOT MET

- **Training.** Commit ed6a8e2, the exact r13 recipe, 11,144 iterations (about
  1.4 epochs of 7,965 rows). It finished 2026-09-25 at 14:04 and took 16.1 h.
  Output: `out/r14/train/adapter-r14`, SFT sha256 `07ee09bd…`.
- **Validation.** Keys validation (keys-all-9 cards, split validation, key
  ladder, 1,525 rows, 0 parse failures), with the registered r11
  operating-point rule and r13 as the reference (`out/r14/op`).

| | Threshold | Covered | TP | FP | FN | Accuracy LB | FP UB |
|---|---|---|---|---|---|---|---|
| r13 (reference) | 0.98081 | 1,086 | 323 | 3 | 9 | 0.98078 | 0.0116 |
| r14 | 0.97050 | 1,052 | 230 | **0** | 12 | **0.98016** | 0.0045 |

**Guard: NOT MET.** The accuracy LB is 0.0006 below r13's; the FP leg passes.
- The guard is not re-registered.
- Under the registered candidate rule, r14 is not the cohort-9 model.
- r14 covers far fewer validation headings than r13 (242 against 332 covered
  positives, TP 230 against 323). It trades heading coverage for 0 FP.

**Secondary check (reported, not gating):** r14 at t_r14 on the 24 cohort-8
validation documents, through the product path, against r13's look on the same
documents. Running.
