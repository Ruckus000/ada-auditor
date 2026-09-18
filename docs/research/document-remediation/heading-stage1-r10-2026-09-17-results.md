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

**Task 1 as recorded by the reviewing session.** The registered prediction missed by one row, and the kill did not fire. The confidence score is a usable abstention channel, but no threshold reaches the bar on its own. The reviewing session recomputed the curve independently and matched it at every threshold. The 219 rows abstained at 0.9 hold 48 of the 75 errors.

## Task 2 — oversample regular-weight headings (sft-r10)
- **Code:** `emit_sft --oversample-regular-h N` (commit 9ba0597, 118 label tests pass). Every emitted H row whose card weight is `regular` is written N times in total. The copies carry `#dup{k}` ids in the sources list only, never in labels. The default of 1 leaves behaviour unchanged.
- **Emit:** `--keys-dir out/keys-all-9 --split out/keys-all-4/split/split.json --on train --exclude-doc-prefix c5 --oversample-regular-h 2`, giving **`out/stage1/sft-r10`, 4,942 rows** (sha `6e1e7db6…bb33`).

| | sft-r9 | sft-r10 |
|---|---|---|
| Rows | 4,475 | **4,942** (+467 duplicated regular-weight H) |
| H | 2,166 (0.484) | 2,633 (**0.533**) |
| H bold / regular | 1,699 / 467 (bold 0.78) | 1,699 / 934 (bold **0.65**) |
| H by level | 690 / 904 / 490 / 60 / 21 / 1 | 814 / 1,140 / 571 / 73 / 33 / 2 |
| Non-H | P 2,109 · TH 100 · Caption 36 · Lbl 34 · TOCI 27 · Artifact 3 | unchanged |
| Held back | rule_decided 599, other 678 | unchanged |

- **Leak check, sft-r10:** all 4,942 rows are train ids; 0 c5 rows; 0 train documents in validation or test; 0 missing or ambiguous images.
- **Against the plan's expectation** (about 4,475 + 430): 467 were added, in range. The bold share of H falls to 0.65, close to validation's 0.66.
- **Risk to watch:** the H share rises to 0.53, above P for the first time. The registered revert condition (FP above 0.05 → r9 stays the candidate) is the guard.
- **Configuration:** round 9's command with `--dataset out/stage1/sft-r10`, `--iters 9884` (2 × 4,942), `--steps-per-save 9884`, output `out/stage1/adapter-r10`; 15 h gate judged at step 100.

**Step 100:** loss 0.086, 0.197 it/s (window), peak 11.26 GB. Projection: 9,884 / 0.197 ≈ 50,170 s ≈ **13.9 h**, under the 15 h gate, so the run continues to 9,884.

### Training — completed
- All **9,884** iterations in a wall time of about **13.7 h** (49,449 s), final loss 0.0151, peak memory 14.16 GB, 0 errors.
- `out/stage1/adapter-r10/adapters.safetensors` sha256 `f9279289…`.

### Prediction
`out/stage1/pred-validation-r10.jsonl`: 1,525 rows (rule 267 / model 1,258), 0 parse failures, with `--scores`. The `--scores` path must run under the MLX interpreter; a first launch under the system python failed at import and was relaunched.

## Task 2 results — graded against Claude-audited labels (`labels-audited-r9`)
Estimated applies r9v's rates (TP 1/60, TN 3/40) to rows no audit has touched. Every figure below was computed by the controller. Each cell is accuracy / FP / FN.

| Population | Run | TP/FP/TN/FN | Direct | Estimated |
|---|---|---|---|---|
| ∩ 273 | r7 reference | 106/9/148/10 | 0.930 / 0.057 / 0.086 | 0.897 / 0.066 / 0.148 |
| ∩ 273 | r9 | 111/6/151/5 | 0.960 / 0.038 / 0.043 | 0.926 / 0.045 / 0.108 |
| ∩ 273 | r10 | 112/17/140/4 | 0.923 / 0.108 / **0.034** | 0.892 / 0.118 / **0.094** |
| Cohort 6 | r9 | 404/17/784/47 | 0.949 / 0.021 / 0.104 | 0.909 / 0.025 / 0.190 |
| Cohort 6 | r10 | 421/38/763/30 | 0.946 / 0.047 / **0.067** | 0.907 / 0.053 / **0.154** |
| All 1,525 | r9 | 515/23/935/52 | 0.951 / 0.024 / 0.092 | 0.912 / 0.029 / 0.174 |
| All 1,525 | r10 | 533/55/903/34 | 0.942 / **0.057** / **0.060** | 0.905 / **0.064** / **0.142** |

**Recall by weight, all 1,525 true headings:**

| | Bold | Regular |
|---|---|---|
| r9 | 0.952 | 0.821 |
| r10 | 0.952 | **0.916** |

**Level exactness (n / recalled / exact), all 1,525:**

| Level | r9 | r10 |
|---|---|---|
| H1 | 95 / 83 / 75 | 95 / 91 / **83** |
| H2 | 315 / 295 / 169 | 315 / 305 / 171 |
| H3 | 126 / 108 / 68 | 126 / 109 / **52** |
| H4 | 30 / 28 / 13 | 30 / 27 / **25** |
| H5 | 1 / 1 / 1 | 1 / 1 / 1 |

### Coverage curve for r10 (`out/stage1/coverage-r10.json`)

| Score ≥ | Coverage | TP/FP/TN/FN | Accuracy [95 % CI] | FP rate [95 % CI] | FN rate |
|---|---|---|---|---|---|
| 0.5 | 1.000 (1,525) | 533/55/903/34 | 0.942 [0.929–0.953] | 0.057 [0.044–0.074] | 0.060 |
| 0.8 | 0.941 (1,435) | 512/28/871/24 | 0.964 [0.953–0.973] | 0.031 [0.021–0.045] | 0.045 |
| 0.9 | 0.908 (1,384) | 498/18/849/19 | 0.973 [0.963–0.981] | 0.021 [0.012–0.033] | 0.037 |
| 0.95 | 0.873 (1,332) | 476/11/828/17 | 0.979 [0.970–0.986] | 0.013 [0.007–0.023] | 0.035 |
| 0.99 | 0.784 (1,195) | 396/5/785/9 | **0.988 [0.980–0.994]** | 0.006 [0.002–0.015] | 0.022 |

Against r9's curve, r10 holds the same accuracy at far higher coverage: 0.988 at **78 %** coverage where r9 needed to drop to 59 %, and 0.979 at 87 % where r9 was at 78 %.

### Registered prediction check (r9 → r10, same labels and rates)
- **Regular-weight recall ≥ 0.88: MET.** 0.821 → 0.916.
- **Bold recall not below 0.94: MET.** 0.952, unchanged.
- **Estimated FN ≤ 0.16: MET.** 0.174 → 0.142.
- **FP stays ≤ 0.05: FAILED.** Estimated FP 0.029 → **0.064**; direct 0.024 → 0.057. On ∩ the direct FP rate nearly triples, 0.038 → 0.108.

### Stop decision — (c)
The plan's option (c) applies: **FP rose above 0.05, so r9 stays the candidate.** Oversampling did what it was aimed at, and the cost landed exactly where the pre-registered risk said it might: the H share of training rose to 0.53, and the model now over-calls headings.

What the round establishes:
- **The regular-weight gap is a sample-count problem, not a capability problem.** Doubling those rows moved regular-weight recall 0.82 → 0.92 with bold recall unchanged, and total misses fell from 52 to 34.
- **It was paid for in false positives**, 23 → 55 rows, which is why r9 remains the candidate.
- **Abstention is worth more on r10 than on r9.** At score ≥ 0.99, r10 is at 0.988 accuracy with 78 % coverage, against r9's 59 %. An r10 with abstention covers more documents at the same quality than r9 with abstention does — that is the next round's obvious lever, at a threshold rather than in the weights.
- **The Stage 1 bar is still not met** by either adapter at full coverage. Test was not evaluated and `test.spent` does not exist.
