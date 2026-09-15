# Heading-type adapter — Stage 1 round 5 results (front-rule fixes, no training)

**Previous record:** `heading-stage1-r4-2026-09-14-results.md` (r4a adopted). **Definition:** `heading-definition-2026-09-13.md` (frozen). **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md` (round 5 entries).

**Status:** REGISTRATION — written and committed before any rule code changes.

**What kind of evidence this is.** Both rule changes were designed from r4a's validation errors and are scored on the same validation rows. This is a **validation-tuned rule change, not held-out evidence**. The rules get their held-out test on the Stage 2→3 audit population (cohort 3's untagged PDFs) and on the sealed test set. Neither is touched in this round.

## Why this round
Of r4a's 183 validation misses, 24 (13 %) were decided in front of or behind the model, not by it. All 24 are in cohort 6, and none are in the ∩ set.

- **16 decided by the front rules:** 15 H→Artifact by the repeats rule (definition §4 rule 2) and 1 H→Lbl by the no-letters rule.
- **8 vetoed by `post_rules`:** the model said H, and the geometric `in_table_box` fact changed it to TH.

## Changes (registered before code)
1. **Table veto by tree ancestry.** `post_rules` vetoes a model H only when the card's `ancestors` contain `Table`, not when the geometric `in_table_box` is true. `in_table_box` stays a prompt fact.
   - The geometric box vetoed 8 true H; only 1 of those has Table ancestry.
   - It also vetoed 1 P, which has Table ancestry and stays vetoed, and 1 Lbl, which has none.
   - Measured on validation: 0 model-H rows would be newly vetoed by ancestry.
2. **Repeats rule restricted to the page margin (Fix 1′, from the definition's "in the same place").** A repeat is Artifact only when `repeats_on_pages ≥ 3` **and** the card sits in the top or bottom 12 % of its page's content extent. The extent is the min y0 and max y1 over that page's blocks in the tagged copy's Cards dump. 12 % is a ceiling taken from the definition's intent and is not tuned.
   - The measurement uses the tagged copy's dump, not `cards.jsonl`: all 17 validation rows the repeats rule decides today are measured against their page extents.
   - **c6-0024:** 10 rows, true H (key H4), mid-page, so no longer Artifact.
   - **c6-0102:** 5 rows, true H (key H3/H4) at y0 94 on every page, which is the top band, so still Artifact. They are keyed as headings but sit where a running head sits; the definition's rule 2 keeps them as Artifact.
   - **c6-0036:1025:** true Lbl, mid-page, so no longer Artifact.
   - **c6-0323:840:** true TH, top band, so still Artifact.
   - **Risk count** (validation rows the rule stops deciding that are not true headings): **1**, c6-0036:1025.

## Registered prediction
Adapter unchanged (r4a). Only rows whose rule or veto decision changes are re-predicted:
- the 8 unvetoed rows, whose model output was overwritten by the veto;
- the 11 rows the repeats rule no longer decides.

All populations are re-scored.

- **R5-a (control).** ∩ (273) is unchanged: accuracy 0.824, FP 0.011, FN 0.474. No ∩ row is touched by either change.
- **R5-b.** Cohort 6 validation FN rate falls from 0.355 (137/386) to between **0.31 and 0.34**.
  - The 7 unvetoed true H return as H, since their model output was H: 130 misses.
  - The 10 un-ruled true H go to the model, which is unmeasured on them. All recalled gives 0.311; none recalled gives 0.337; at r4a's cohort 6 recall (0.645), about 0.320.
- **R5-c.** Cohort 6 validation FP rate is **≤ 0.036** (now 0.033, 29/866).
  - The unvetoed Lbl returns as H: +1, making 30/866 = 0.035.
  - The un-ruled Lbl may add +1 if the model calls it H: 31/866 = 0.036.
  - ∩ FP stays at 0.011.
- **R5-d.** 0 no-brace outputs and 0 parse failures on the re-predicted rows (Q-e holds).
- **Revert rule:** if the FP rate exceeds 0.05 on either population, revert change 1 (the table veto) first and report.

## Then, no code: profile for round 6
Profile r4a's H1 misses and P→H false positives against recalled H1 and correct P, fact by fact:
- source cohort;
- page index;
- y-band;
- font against the page median;
- weight, words, case, punctuation;
- retagger tag;
- approved-headings stack empty or not;
- decider;
- repeats and table box.

Both tables go in this record. No class reweighting or prompt change before they exist.

## Results
*(to be filled after the run)*
