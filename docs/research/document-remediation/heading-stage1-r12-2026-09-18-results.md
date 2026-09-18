# Heading-type adapter — Stage 1 round 12: a third epoch against the abstention rate

> **Graded against Claude-audited labels** (`labels-audited-r10`), with r10v's rates on rows no audit has touched.

**Plan (the registration):** `docs/superpowers/plans/2026-09-18-stage1-round12.md`, copied unchanged from the coordinator worktree and committed at 6524f32 before launch. **Baseline:** r10, the candidate. **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md`.

## Why
Abstention is Stage 2's largest miss: 25.1 % of rows are handed back at r10's operating point, against a gate of ≤ 10 %. Measured on r10 at threshold 0.9933, the abstained mass is mostly **correct but under-confident**: of 380 abstained rows, 187 score in [0.95, 0.9933) and 172 of those are already right; 58 score below 0.7 and 43 of those are right.

## The one variable
`adapter-r12` = `adapter-r10` resumed for one further epoch over the **unchanged** `sft-r10` (sha `6e1e7db6…`): r10's command plus `--adapter-path out/stage1/adapter-r10 --iters 4942 --output-path out/stage1/adapter-r12`. Nothing else changes.

**Registered prediction (r10 → r12, threshold rule unchanged):**
- coverage at the rule's threshold **≥ 0.82**, with the rule still satisfied;
- direct FP **≤ 0.045**;
- estimated FN **≤ 0.125**;
- regular-weight recall **≥ 0.90**.
- **Revert** if direct FP exceeds 0.05 on audited labels, or the rule's coverage falls below r10's 0.749.

## Training
**Step 100:** loss 0.0388, 0.190 it/s, peak 10.72 GB. Projection 4,942 / 0.190 ≈ 26,010 s ≈ **7.2 h**, under the 15 h gate, so the run continues to 4,942.

### Training — completed
- All **4,942** iterations in a wall time of about **6.8 h** (24,608 s), final loss 0.0048, 0 errors.
- `out/stage1/adapter-r12/adapters.safetensors` sha256 `cfb0a322…`.
- **One operational note:** a resumed run writes no `adapter_config.json` of its own, because it reads r10's. Prediction failed on the missing file, so r10's config was copied into `adapter-r12/` unchanged (same rank, same target modules, same fine-tune type) and prediction was relaunched.

## Results — graded against Claude-audited labels (`labels-audited-r10`, r10v rates on untouched rows)
`out/stage1/pred-validation-r12.jsonl`: 1,525 rows (rule 267 / model 1,258) with `--scores`, 0 parse failures. The controller computed every figure below. Each cell is accuracy / FP / FN.

| Population | Run | TP/FP/TN/FN | Direct | Estimated |
|---|---|---|---|---|
| ∩ 273 | r10 | 117/12/139/5 | 0.938 / 0.079 / 0.041 | 0.918 / 0.086 / 0.077 |
| ∩ 273 | r12 | 108/6/145/14 | 0.927 / 0.040 / 0.115 | 0.907 / 0.045 / 0.148 |
| Cohort 6 | r10 | 435/24/762/31 | 0.956 / 0.031 / 0.067 | 0.932 / 0.033 / 0.122 |
| Cohort 6 | r12 | 409/24/762/57 | 0.935 / 0.031 / 0.122 | 0.912 / 0.033 / 0.173 |
| All 1,525 | **r10** | 552/36/901/36 | **0.953 / 0.038 / 0.061** | **0.929 / 0.042 / 0.113** |
| All 1,525 | r12 | 517/30/907/71 | 0.934 / 0.032 / **0.121** | 0.911 / 0.035 / **0.168** |

**Recall by weight:** r10 bold 0.948, regular 0.920 → r12 bold **0.891**, regular **0.856**.

**Coverage curves:**

| Score ≥ | r10 coverage | r10 accuracy [95 % CI] | r12 coverage | r12 accuracy [95 % CI] |
|---|---|---|---|---|
| 0.9 | 0.908 | 0.973 [0.963–0.980] | 0.915 | 0.959 [0.947–0.969] |
| 0.99 | 0.784 | 0.987 [0.978–0.992] | 0.844 | 0.974 [0.963–0.982] |
| 0.995 | 0.732 | 0.990 [0.982–0.995] | 0.823 | 0.977 [0.967–0.984] |
| 0.999 | 0.588 | 0.990 [0.981–0.995] | 0.771 | 0.980 [0.970–0.987] |

**The threshold rule is never satisfied for r12.** No threshold gives an accuracy lower bound ≥ 0.98 with an FP upper bound ≤ 0.02; the best lower bound is 0.970, at score ≥ 0.999. r10's operating point is unchanged: 0.9933 → 0.749 coverage.

### Registered prediction check
- **Coverage at the rule's threshold ≥ 0.82, with the rule satisfied: FAILED.** The rule is never satisfied, so r12 has no operating point.
- **Direct FP ≤ 0.045: met** (0.032).
- **Estimated FN ≤ 0.125: FAILED** (0.168, up from r10's 0.113).
- **Regular-weight recall ≥ 0.90: FAILED** (0.856).
- **Revert condition fires:** the rule's coverage falls below r10's 0.749 (it is undefined).

### Why it failed
The third epoch made the model **more confident and more wrong**, not more confident and right.
- r12 has 34 errors at score ≥ 0.99 (30 of them misses), so abstention cannot catch them.
- It changes its answer on 88 rows against r10. The largest move is H → P on 47 rows, the under-calling r9 and r10 had worked to remove.

### audit-r12v
r12 has 19 un-audited error rows (FP 10, FN 9), above the plan's trigger of 10. **The audit cannot change the verdict:**
- In the best case every one of those 19 is a label error, and r12 still scores 0.946 accuracy and 0.105 FN.
- On the same flipped labels, r10 scores 0.948 and 0.068.

The audit is therefore offered to the reviewing session as optional rather than run by default.

## Stop decision — revert: r10 stays the candidate, and its operating point stands
- A third epoch over the same data does not trade abstention for coverage. It sharpens confidence indiscriminately, and the errors become confident.
- **r10 and its registered operating point (score ≥ 0.9933, 0.749 coverage, accuracy 0.9886 [0.9806–0.9939], FP 0.0039 [0.0008–0.0113]) remain the Stage 1 state**. The Stage 2 gate is not met.
- `adapter-r12` is kept on disk and not used.
- **Test was not evaluated**, and `test.spent` does not exist.
