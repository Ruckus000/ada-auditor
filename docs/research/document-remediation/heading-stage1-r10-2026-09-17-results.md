# Heading-type adapter — Stage 1 round 10: confidence scores and the coverage curve

> **Graded against Claude-audited labels** (`labels-audited-r9`). Audited rows come from the reviewing Claude session, not a human relabel.

**Plan (the registration):** `docs/superpowers/plans/2026-09-17-stage1-round10.md`, copied unchanged from the coordinator worktree @ 7466f5e and committed at 4fd511d before any work. **Adapter:** r9 (unchanged in Task 1). **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md`.

## Why this round
Round 9's stop decision was to measure before training again. r9's 52 remaining direct misses on `labels-audited-r9` point at weight and level:
- 34 of the misses are regular-weight headings;
- recall is 0.95 on bold headings and 0.82 on regular-weight ones;
- training headings are 83 % bold, while validation headings are 66 % bold;
- H1 recall is 0.87 (title pages set in large regular type).

Also recorded, rule left unchanged: 5 of the 6 rule-decided misses are one real section heading in c6-0102, "Test Description". It repeats at an identical y0 on 4 pages, and the margin-band repeat rule reads it as pagination.

## Task 1 — confidence scores (commit 6635858; 117 label tests pass)
- **Method: log-probabilities, not the 5-sample vote.** mlx-vlm 0.7.0 yields per-step log-probabilities from `generate_step`, so `predict.py --scores` now runs generation in-process, loading the model and adapter once.
  - `p_H` is read at the first token of the type value, normalised over the first tokens of the 8 valid types. All 8 types begin with distinct tokens, so no grouping was needed.
  - `score = max(p_H, 1 − p_H)`. Rule-decided rows get a score of 1.0 and are always covered. Vetoed rows keep the model's `p_H` and carry `vetoed: true` (2 rows: c6-0135:1, c6-0219:2).
- **Parity:** the first 20 model-decided rows gave the same type and byte-identical raw output to `pred-validation-r9.jsonl`. Over the full 1,525 rows there are **0 type, 0 decider and 0 raw differences**. The controller recomputed the type identity.
- **Cost:** 1,957 s for 1,525 rows, about 1.3 s per row. The previous CLI-per-row path took about 3.7 s per model row.
- `out/stage1/pred-validation-r9-scored.jsonl`; curve data in `out/stage1/coverage-r9.json`.

### Coverage curve, all 1,525 validation rows (graded against Claude-audited labels)
Rule rows are always covered. Bounds are exact two-sided 95 % Clopper-Pearson. The controller recomputed the rows at t = 0.5, 0.9, 0.95 and 0.99.

| Score ≥ | Coverage | TP/FP/TN/FN | Accuracy [95 % CI] | FP rate [95 % CI] | FN rate |
|---|---|---|---|---|---|
| 0.5 | 1.000 (1,525) | 515/23/935/52 | 0.951 [0.939–0.961] | 0.024 [0.015–0.036] | 0.092 |
| 0.6 | 0.972 (1,483) | 496/16/927/44 | 0.960 [0.948–0.969] | 0.017 [0.010–0.027] | 0.081 |
| 0.7 | 0.938 (1,430) | 474/10/910/36 | 0.968 [0.957–0.976] | 0.011 [0.005–0.020] | 0.071 |
| 0.8 | 0.908 (1,384) | 447/9/897/31 | 0.971 [0.961–0.979] | 0.010 [0.005–0.019] | 0.065 |
| **0.9** | **0.856 (1,306)** | 408/8/871/19 | **0.979 [0.970–0.986]** | **0.009 [0.004–0.018]** | 0.044 |
| 0.95 | 0.776 (1,184) | 338/5/828/13 | 0.985 [0.976–0.991] | 0.006 [0.002–0.014] | 0.037 |
| 0.99 | 0.590 (900) | 156/3/733/8 | 0.988 [0.978–0.994] | 0.004 [0.001–0.012] | 0.049 |

These are direct figures on audited labels. The un-audited-row estimate used in rounds 8 and 9 is not applied to the curve.

### Registered checks
- **Registered prediction — did not hold, by one row.** At score ≥ 0.9, coverage is 0.856, which passes the ≥ 60 % condition. Covered accuracy is **0.9793** (1,279/1,306), against the ≥ 0.98 condition. One more correct row would have passed it, and the interval [0.970–0.986] spans the threshold either way.
- **Task 2 kill — does not fire.** At score ≥ 0.9, accuracy is 0.979, below 0.99. FP is 0.009 on the point estimate, but its upper bound is 0.018. No threshold reaches 0.99 accuracy; the best is 0.988 at 59 % coverage. **Task 2 runs** under the plan.

### What the curve says
- **Abstention buys real precision.** At score ≥ 0.9 the FP rate falls from 0.024 to 0.009, and accuracy rises from 0.951 to 0.979, on 86 % of rows.
- **It does not reach the bar at any useful coverage.** Even at 59 % coverage, accuracy is 0.988 and the FP upper bound is 0.012.
- **Abstained rows are mostly real headings.** Of the 219 rows below 0.9, 140 are H and 110 are regular-weight. They include 33 of r9's 52 misses and 15 of its 23 false positives.
- **Confident misses survive.** On ∩, 4 of the 5 misses stay in the covered set at 0.9. That is the regular-weight gap Task 2 targets.
- **Caveats:**
  - 14 abstained rows are audit-Unsure and are graded on their earlier label.
  - These bounds are two-sided; earlier records used one-sided bounds for the Stage 1 bar. `coverage-r9.json` has the counts to recompute either.
