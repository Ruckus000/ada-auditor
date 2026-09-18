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
