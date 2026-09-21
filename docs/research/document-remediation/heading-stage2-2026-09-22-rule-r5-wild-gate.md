# Rule R5 in the product path, re-scored on the wild gate (2026-09-22)

Counts only; no document bytes in this record. Inputs are on the data-only
branch `kimi-data-run-in-2026-09-21` (3184183); the wild gate numbers below
are graded against the run-in consensus labels (judges: Claude Opus-medium
seat 1 and Kimi K3 seat 2 on page sheets, Claude Opus-quick per-card
tie-break; Claude ×4 for the original rows).

**The rule** (registered 2026-09-18 in `heading-stage2-2026-09-18-results.md`,
"Rule R5 (enumerator-only = Lbl)"): a card whose whole text matches
`^(?:[IVX]+|[A-Z]|\d+)\.$` is decided `Lbl` before the model, rule score 1.0.

## Implementation

- `labels/rules.py`: new `enumerator_only` (`ENUMERATOR_ONLY` is the
  registered pattern verbatim), appended last in `decide`. The earlier rules
  keep their decisions: a digit enumerator is still r2's `Lbl` (rule 3), a
  margin-band repeat enumerator is still `Artifact` (rule 2). This is the
  product path — `predict.py` rules-in-front, consumed by `suggest.py`. It is
  not `run.py`'s `apply_r5_scope` (a different, older rule with the same
  name), which is untouched.
- Tests first: `labels/test_rules.py` gains the R5 pattern tests (matches,
  near-misses, and ordering against the earlier rules); label suite shows no
  new failures against the branch tip.
- `labels/r5_rescore.py` (with `labels/test_r5_rescore.py`): the offline
  recompute. Only `decided_by == "model"` rows are eligible, so the recompute
  is exactly the product path's outcome with no model run.

## Recompute over the run-in predictions

Inputs: `out/stage1/pred-wild-23-r10-runin.jsonl`,
`out/labels/wild-23-labels-runin.jsonl`, `out/labels/wild-23-cards-runin.jsonl`.

- R5 matches **219** of the 3,004 wild cards. Of the 218 with labels:
  **217 Lbl, 1 Artifact, 0 H** — none is a labelled heading.
- **82** rows were model-decided and are overridden; the other 137 matches
  were already rule-decided (mostly r2). The 7 convention-correction FP are
  all among the 82: c3-0094:58, c3-0094:60, c3-0128:7, c3-0128:10,
  c3-0128:181, c3-0128:188, c3-0128:196.

## Wild gate at t = 0.9933, rounds 2+3

| | Covered | Coverage | Accuracy [95% exact] | FP (UB) | FN | Docs clean |
|---|---|---|---|---|---|---|
| Run-in, before R5 | 2,536 | 0.888 | 0.9890 [0.9841–0.9927] | 7 (0.0059) | 21 | 19/30 |
| Run-in + R5 | 2,545 | 0.891 | 0.9917 [0.9874–0.9949] | **0 (0.0015)** | 21 | 20/30 |

Covered errors 28 → 21: the 7 FP are gone; the 9 newly covered rows (rule
score 1.0 on cards that used to abstain) are all correct. FN unchanged at 21
— misses are now the whole shortfall.

**Verdict: NOT MET.** Accuracy lower bound 0.9874 < 0.99 (FP upper bound
0.0015 ≤ 0.01 passes). 21 errors against the 15 allowed at n = 2,545. The
registered R5 view behaves exactly as predicted in the 2026-09-22 plan's
Step 0c: the FP are convention, and removing them does not pass the gate.
