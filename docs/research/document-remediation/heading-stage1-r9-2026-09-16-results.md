# Heading-type adapter — Stage 1 round 9: audit-corrected training labels, retrain, symmetric measurement

> **Graded against Claude-audited labels** (Ruling R9). Audited rows come from the reviewing Claude session (`label_source` "claude-audit"), not a human relabel. Model output is never a label.

**Plan (the registration):** `docs/superpowers/plans/2026-09-16-stage1-round9.md`, copied unchanged from the coordinator worktree @ 1674891 and committed at eb749f7 before any round 9 work. **Previous records:** round 7 and round 8. **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md`.

## Registration (from the plan's Global Constraints)
- **Split:** `out/keys-all-4/split/split.json`, ids unchanged. Test is never evaluated, and `test.spent` must not exist.
- **Label sources:** stripped-tree, word-outline, planted, claude-audit, human-answer.
- **Level policy (r7 ruling 2):** where key and audit both say H, keep the key's level.
- **Planted data:** c5 stays excluded; c7 is not used.
- **Population:** sft-r7 plus every row of the 804-row audit pool that emit accepts under its audited type, minus rule-decided rows. Expected 4,400–4,800.
- **Configuration:** `mlx_vlm.lora`, batch 1, rank 8, `--train-on-completions --grad-checkpoint`, two epochs (`--iters` = 2 × rows), default learning rate, 408-token images. One run.
- **Prediction:** on all 1,525 validation rows graded against `labels-audited-r9`, estimated FN falls from 0.258 to **at most 0.20** and estimated FP stays **at or below 0.05**. The Stage 1 bar is expected to fail again.
- **Kill (Task 1):** fewer than 55 % of audited pool rows change label → stop before Task 2.
- **Time gate:** 13 h from step-100 throughput; stop and report if exceeded.

## Round 9 audit (Task 1)
**Cards:** `out/labels/audit-r9-cards.jsonl`, 804 train ids, 104 documents, shuffled with seed 20260916, no prediction.
- A-pool remainder: 266 key-H rows the train probe called non-H.
- Proxy remainder: 538 key-non-H rows excluded from sft-r7.
- Deduped against the r6, r7, r7AB and r8 audits; every id asserted train.

**Two corrections to the plan's script, data unchanged:**
1. `audit-r7AB-groups.json["A_pool"]` is a count (366), not a list. The 366 ids were taken from `out/stage1/pred-train-keyH-r4a.jsonl`, with the count asserted.
2. `split.json["ids"]` maps split → ids, so it was inverted before the train-only assertion.

Expected counts (266, 538, 804) held.

**Judgements:** `out/labels/audit-r9-claude.jsonl`, 804 rows, 0 Unsure. The controller recomputed every figure below.

| Pool | Scored | Audited H | Heading-bit changes | Share | Type transitions |
|---|---|---|---|---|---|
| A-pool remainder | 266 | 233 | 33 | 0.124 | H→P 19, H→Caption 10, H→TH 4 |
| Proxy remainder | 538 | 454 | 454 | **0.844** | P→H 422, Other→H 28, TOCI→H 2, TH→H 1, Caption→H 1; P→Caption 16, P→TH 14, Other→Caption 2, P→Artifact 1, Other→P 1 |
| **All** | 804 | 687 | **487** | **0.606** | type changes 521 (0.648) |

- **Kill check:** 0.606 ≥ 0.55, so **Task 2 runs.**
- **Per-document concentration:** 104 documents, but c6-0375 supplies 75 cards, c6-0179 67, c3-0924 57, c6-0120 41 and c4-0024 39. The first three, a policy manual, a catalogue and a newsletter set, supply about a quarter of the pool.
- **File shas** (the files are gitignored, so the shas stand in for a commit):
  - cards `224688e6…87906`
  - groups `fa15203a…d5ee`
  - judgements `ac7b9c19…e390`

## Round 9 data (Task 2)
**`out/keys-all-9/labels.jsonl`** (sha `bb9de21c…75da1d`, **10,901 rows**) = `keys-all-7/labels.jsonl` (sha `ba8a9085…ded96e`) with two changes:
- the 266 A-pool rows overwritten with their audited type;
- the 538 proxy rows restored from `keys-all-4/labels.jsonl` with their audited type.

Details:
- Level policy per r7 ruling 2; the original is kept under `superseded`.
- 804 audited, 538 restored, 0 still excluded.
- Cards are `cards-r5`; key ladders are copied from keys-all-7. Manifest: `out/keys-all-9/manifest-r9.json`.

**`out/stage1/sft-r9`:** **4,475 rows** (sha `4e1d3cfa…6763f`).
- **Held back:** rule_decided 599, other 678. c5 excluded: 1,480 rows.
- **By type:** H 2,166 · P 2,109 · TH 100 · Caption 36 · Lbl 34 · TOCI 27 · Artifact 3. **H share 0.484.**
- **H by level:** L1 690, L2 904, **L3 490**, L4 60, L5 21, L6 1.
- **By source (H / non-H):** stripped-tree 961 / 1,640; word-outline 344 / 521; claude-audit 861 / 148.
- **Leak check:** all 4,475 rows are train ids; 0 c5 rows; 0 Unsure-audited ids; 0 train documents in validation or test; 0 missing or ambiguous images.

**Against the plan's expected ranges:**
- n 4,475 falls within 4,400–4,800.
- H share 0.484 falls within 0.44–0.50.
- claude-audit rows: 1,009 against the expected 217 + (804 − 0 − rule-held) = 1,011. The 2-row difference is two r7AB rows audited TOCI (c6-0292:187, c6-0375:301). Round 8's TOCI rule now decides them, so emit holds them.

**Two observations reported before training:**
1. **The rules-in-front changed between sft-r7 and sft-r9.**
   - 46 rows emitted in sft-r7 are now rule-decided and held: TOCI 38, P 5, TH 3. That is round 8's TOCI, Caption and list-item rules, which run inside `decide()`.
   - `cards-r5` has no `after_inline_label` field, so the list-item rule is inert on train, while round 8's validation predictions used `cards-r8`.
   - The plan names `cards-r5`, so this is recorded rather than changed.
2. **H3 more than doubles, 228 → 490, almost entirely from restored proxy rows.** Their levels come from the audit, because the key had no heading: L3 265, L2 145, L1 29, L4 15.
   - Round 7 recorded audit levels as weak: 32 of 85 A rows agreed with the key.
   - The level target of about 265 training rows therefore rests on single-page level judgements.

**Rulings on the two observations (reviewing session, before training):**
1. **Accepted and recorded.** r9 differs from r7 in the rules-in-front as well as in labels.
   - The rules decide those rows at inference, so holding them out of training is consistent, and `cards-r5` is what the registration names.
   - The list-item rule is inert on train, because `cards-r5` has no `after_inline_label`. It was also near-inert on validation (2 hits in round 8).
   - The rules difference is therefore **38 TOCI + 5 P + 3 TH rows**. The cards file is not switched mid-round.
2. **Proceed.** The registered prediction is on the heading bit only (estimated FN ≤ 0.20, FP ≤ 0.05).
   - Level exactness is reported with the caveat that about 450 restored rows carry single-page audit levels.
   - The H3 rise from 228 to 490 is named as the reason for any level shift.
   - A level-free target would be a new SFT format, and it is not in the plan.

## Training (Task 3) — stopped at the gate
- **Launch:** the registered command, `--iters 8950` (2 × 4,475), `--steps-per-save 8950`, output `out/stage1/adapter-r9`.
- **Step 100:** loss 0.071, **0.178 it/s** (window), peak 9.52 GB.
- **Projection:** 8,950 / 0.178 ≈ 50,280 s ≈ **13.97 h**, over the registered 13 h gate. The process was killed at about step 100, as the plan requires. No adapter was saved, because `--steps-per-save` equals `--iters`.
- **Conditions at the gate:** lid open (`AppleClamshellState` No) and on AC power, so this was not a clamshell-sleep artefact.
  - Other load on the machine: a Cursor extension host at about 46 % CPU and a Virtualization.framework VM at about 26 %.
  - r7 measured 0.215 it/s at its step 100 on the same data pipeline, and r4a measured 0.182 before rising to about 0.21.
- **Reported to the reviewing session for a decision.** Nothing was relaunched.

## Registration change after the step-100 reading: gate raised to 15 h for this run
Ruled by the reviewing session after seeing the 13.97 h projection. The configuration is unchanged. Reason, verbatim:

> "r9 has 12 % more iterations than r7 (8,950 vs 7,986); at r7's measured 0.215 it/s it is 11.6 h, inside the original gate. The step-100 window rate under-reads the run rate by ~15 % (r4a: 0.182 at step 100, ~0.21 later), and the machine carries external load that is the user's and is not stopped. The 13 h gate was set to catch a runaway run, not a 7 % overshoot from contention; 15 h keeps that purpose."

Rejected alternatives:
- **Relaunch unchanged under the 13 h gate.** It would most likely project about 14 h again and stop again.
- **Change the iteration count.** That is a configuration change against the registration.

**Step-100 readings:**
- Attempt 1: 0.178 it/s → 13.97 h (stopped under the 13 h gate). Log kept as `train-r9-attempt1-gate13.log`.
- Attempt 2: loss 0.091, **0.206 it/s**, peak 11.25 GB → 8,950 / 0.206 ≈ 43,450 s ≈ **12.1 h**. That is under the 15 h gate, and also under the original 13 h one, so the run continues to 8,950.

## Training (Task 3) — completed
- Attempt 2 ran all **8,950** iterations in a wall time of about **12.1 h** (43,613 s, log creation to last write).
- Final loss 0.0416 (at the 8,950 report window); peak memory 14.37 GB; 0 errors.
- `out/stage1/adapter-r9/adapters.safetensors` sha256 `0506f49b…feedc9f`.

## Prediction (Task 4 Step 1)
`out/stage1/pred-validation-r9.jsonl`: 1,525 rows (rule 267 / model 1,258), 0 parse failures, using the plan's command (`cards-r5`, `keys-all-9`). `test.spent` does not exist.

**r7 reference.** `pred-validation-r8.jsonl` is the r7 adapter under round 8's rules, so both adapters are graded with the same rules in front. Its cards were `cards-r8`, where the list-item rule fired on 2 rows, **c3-0073:27** and **c4-0019:75** (both labelled Other). With r9's `cards-r5` the rule is inert. If either row is scored differently between the two runs, the comparison can be corrected by hand. `pred-validation-r7.jsonl` (r7 under round 5 rules) belongs only in an appendix, for continuity with the r7 record.

## Provisional evaluation on labels-audited-r8 (Task 4 Step 2) — superseded by Step 5
> Graded against Claude-audited labels. **The direct column is biased against r9 here**: r7's error rows were audited exhaustively in round 8, and r9's are not yet. Estimated = r8's rates (TP 2/60, TN 6/40) on rows no audit has touched.

Each cell is accuracy / FP / FN.

| Population | r7 reference, direct | r7 reference, estimated | r9, direct | r9, estimated |
|---|---|---|---|---|
| ∩ 273 | 0.949 / 0.050 / 0.053 | 0.874 / 0.069 / 0.189 | 0.949 / 0.056 / 0.044 | 0.877 / 0.075 / 0.177 |
| Cohort 6 validation | 0.947 / 0.022 / 0.108 | 0.862 / 0.034 / 0.275 | 0.947 / 0.026 / 0.101 | 0.863 / 0.038 / 0.268 |
| All 1,525 | 0.948 / 0.027 / 0.097 | 0.864 / 0.040 / 0.258 | 0.948 / 0.031 / 0.090 | 0.866 / 0.044 / 0.251 |

The controller computed these. At this provisional stage r9 is almost indistinguishable from r7: estimated FN is 0.251 against 0.258, and estimated FP 0.044 against 0.040.

## audit-r9v (Task 4 Step 3)
**Cards:** `out/labels/audit-r9v-cards.jsonl`, 116 ids, shuffled with seed 20260916, no prediction. **Groups:** `out/labels/audit-r9v-groups.json`, which also carries r9's prediction per id. Deduped against r6, r7, r7AB, r8 and r9.

| Group | Carded | Pool | Documents | Top documents |
|---|---|---|---|---|
| FP_all | 10 | 30 (20 already audited) | 9 | c3-0073 2 |
| FN_all_model | 6 | 44 (38 already audited) | 4 | c6-0065 3 |
| FN_rule_decided | listed, not carded | 6 | — | — |
| TP_sample | 60 (document-capped) | — | 25 | c6-0398, c6-0258, c6-0447 at 3 each |
| TN_sample | 40 (document-capped) | — | 40 | 1 each |

Because most of r9's errors fall on rows already audited, the un-audited error surface is small: 16 cards.
