# Merged-heading strategies: results (2026-09-23)

Counts only; no document bytes in this record. The registration is
`docs/superpowers/plans/2026-09-22-merged-heading-strategies.md`, amended for
C by `docs/superpowers/plans/2026-09-23-strategy-c-guard-reregistration.md`
(post-hoc, disclosed). Runs went through the overnight runner
(`docs/superpowers/plans/2026-09-22-overnight-kimi-runner.md`), and their outputs are
on the data branch `kimi-data-run-in-2026-09-21` under
`experiments/qwen-role-decisions/out/overnight/`. Wild numbers are graded
against the run-in consensus labels (`out/labels/wild-23-labels-runin.jsonl`;
judges Claude Opus-medium seat 1 and Kimi K3 seat 2 on page sheets, Claude
Opus-quick per-card tie-break; Claude ×4 for the original rows). Dev numbers
are graded against keys (struct-tree truth). The test split was not read.

**Verdict: strategy C (r13) passes the wild gate on its one look, and is the
winner under the registered rule. The pass depends on a post-hoc guard, has a
4-error margin, comes mostly from abstention, and does not hold when split by
block type (below). It needs confirmation on freshly judged documents before
it is called clean.**

## Dev set

Reproduced exactly by the runner's imaged build (request 01):
sha256 `336caf83…74c6c`. It has 1,299 positives (1,152 train, 147 validation)
and 600 validation negatives.

## A, B, D

- **A, probe-and-ask:** τ_A = 0.9838874545166708 (12 of 600 negatives trigger).
  Dev recall 792/1,299 = 0.61, so the wild look ran. It probed 1,021 wild
  multi-line blocks (requests 09 and 10) and abstained on 5 blocks, none of
  them among the 21 errors. The gate did not move (2,540 covered, LB 0.9874).
  The wild merged first lines score 0.001–0.83 as probes. **Spent.**
- **B, probe-and-split:** registered as dev-only, from A's scores. It has no gate
  look, and this record reports no numbers for it.
- **D, rule-only:** dev recall 0.202 under the 2 % cap, as reported by Kimi and
  not recomputed here. **Spent.**

## C: convention fix in training (r13)

- **Data (request 04):** emit_sft with the r10 recipe over the overlay. N = 5,572
  rows (sha256 `20aee8b1…`), which matches the registration's local count.
- **Training (request 12):** exact r10 recipe, 11,144 iters, exit 0, 58,692 s
  (16.3 h). The runner's time gate was raised from 16 h to 18 h after request 05
  projected 17.0 h and was stopped. That limit is a compute budget, not a result
  threshold. Request 12 projected 16.1 h.
- **Validation (requests 13 and 15), r11 rule, labels-audited-r10:**

| | Threshold | Covered | TP | TN | FP | FN | Acc LB | FP UB |
|---|---|---|---|---|---|---|---|---|
| r10 | 0.993316 | 1,142 | 359 | 770 | 3 | 10 | 0.9806125 | 0.0112996 |
| r13 | 0.98081102556551 | 1,086 | 323 | 751 | 3 | 9 | 0.9807780 | 0.0115833 |

  The registered guard failed on FP UB by 0.00028. FP is identical at 3, and the
  bound differs only through covered negatives (754 against 773). The guard was
  re-registered before the look (FP count no higher, acc LB no worse; r13
  meets both) and is disclosed as post-hoc.

  Tooling note: `labels.operating_point` reports `coverage` 0.0996, because it
  divides by all 10,901 label rows, not the scored validation rows. The
  covered counts above are right. The coverage field is not.

- **Wild look (request 14 scores, t_r13 from validation, no refit):**

| Wild gate | t | Covered | Asks | TP | FP | TN | FN | Accuracy [95 % exact] | FP UB | Clean docs | |
|---|---|---|---|---|---|---|---|---|---|---|---|
| r10 + R5, end to end (baseline, reproduced) | 0.9933 | 2,543 | 313 | 78 | 0 | 2,444 | 21 | 0.9917 [0.9874–0.9949] | 0.0015 | 20/30 | NOT MET |
| **r13** | **0.98081** | **2,337** | **519** | **97** | **6** | **2,229** | **5** | **0.9953 [0.9916–0.9976]** | **0.0058** | **21/30** | **PASS** |
| r13 (not gating) | 0.9933 | 2,073 | 783 | 63 | 1 | 2,006 | 3 | 0.9981 [0.9951–0.9995] | 0.0028 | 26/30 | pass |

  Asks here means labelled rows minus covered rows (2,856 labels). Covered
  errors fell from 21 to 11, where the gate allows 15.

  Of the baseline's 21 errors:
  - **16 are no longer errors.** Only 2 of them are now answered correctly
    (c3-0533:10, c3-0722:147). The other 14 fell below t_r13 and became asks.
  - **5 remain:** c3-0268:5, c3-0299:293, c3-0489:34, c3-0507:110, c3-0794:1.
  - **6 new FP:** c3-0094:0, c3-0722:55, c3-0722:57, c3-0825:16, c3-0825:20,
    c3-0869:13.

## By block type (reported, not a registered gate)

Strata: single blocks; multi-line blocks (the wild probe set of request 09);
and the two parts of a run-in split, split heads and split bodies.

| | Rows | r10 covered | r10 errors | r10 acc LB | r13 covered | r13 errors | r13 acc LB | r13 FP UB |
|---|---|---|---|---|---|---|---|---|
| Single | 1,767 | 1,478 | 0 FP, 4 FN | 0.9931 | 1,424 | **6 FP**, 1 FN | 0.9899 | 0.0097 |
| Multi-line | 1,003 | 986 | 0 FP, 16 FN | 0.9738 | 846 | 0 FP, 4 FN | 0.9879 | 0.0044 |
| Split head | 35 | 29 | 0 | 0.8806 | 29 | 0 | 0.8806 | 0.2059 |
| Split body | 51 | 50 | 1 FN | 0.8935 | 38 | 0 | 0.9075 | 0.0925 |

r13 fixes the merged blocks. All 6 of its new FP land on single blocks,
which r10 answered with 0 FP, and the single-block stratum's LB falls from
0.9931 to 0.9899. No stratum passes 0.99 on its own; the small ones cannot
at their size. A pooled guarantee does not imply a per-group one. See
hierarchical group-conditional conformal risk control,
https://arxiv.org/abs/2607.24562.

## What is spent, and what is next

- Every strategy's registered look is used: A, and C (passed); B and D are dev-only.
- During the 2026-09-23 research round, first-line-length abstention rules
  (k ∈ {4, 6, 8, 10}) were evaluated on these wild labels, so any such rule
  now needs a freshly judged batch.
- Next:
  1. read r13's 6 new single-block FP (a convention pattern, or real errors?)
     before any r14;
  2. confirm on a freshly judged wild batch, which needs the user's go-ahead.
- A batch-size benchmark on the training Mac (M4 Max, 36 GB) found batch 1
  fastest: 0.217 examples/s, against 0.176 at batch 2 and 0.094 at batch 4.
  Faster training on this Mac has to come from less work per run.
