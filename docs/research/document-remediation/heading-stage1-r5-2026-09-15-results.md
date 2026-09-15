# Heading-type adapter — Stage 1 round 5 results (front-rule fixes, no training)

**Previous record:** `heading-stage1-r4-2026-09-14-results.md` (r4a adopted). **Definition:** `heading-definition-2026-09-13.md` (frozen). **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md` (round 5 entries).

**Status:** RESULTS — registration committed before code (ef67122); results appended below. **Outcome: R5-a to R5-d all held. The rule changes are adopted.**

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

Numbers come from `out/stage1/eval-r5-*.json` and `pred-validation-r5.jsonl` (not committed). The controller recomputed the ∩, cohort 6 and all-validation confusion from the raw files and got the same figures.

### Implementation
- **Commit 7354ae7:** `forbids_heading` now keys on `Table` in `ancestors`, and the veto marker is renamed `table_ancestor`.
  - New `labels/margin_band.py` holds the page extent from the dump and the 12 % band.
  - `key_context` writes `in_margin_band` on every card.
  - `artifact_by_repeat` requires repeats ≥ 3 **and** the band. A repeat card without the field raises: fail loud, no legacy fallback.
  - Tests: 93 pass, 0 fail; the eligibility self-check passes.
- **Cards:** `out/keys-all-4/cards-r5.jsonl` adds the field to all 10,901 cards over 442 documents (4,074 in the band). Every other field is identical to `cards.jsonl`, which is not modified. `cards.jsonl` now fails loud under the new rules, by design.
- **The 17-row margin check matched the registration exactly.**
- **Changed rows:** 11 by the repeats rule and 8 by the veto, with 0 newly vetoed, for 19. All 1,506 other prediction lines are byte-identical to r4a's.
- **The 19 re-predicted rows:**
  - The 8 unvetoed rows (7 true H, 1 true Lbl) all came back H.
  - 5 of the 10 un-ruled c6-0024 H came back H.
  - The un-ruled Lbl `c6-0036:1025` came back Lbl.
  - 0 no-brace outputs, 0 parse failures.

### Evaluator results (adapter r4a throughout)

| Population | Rules | n | TP/FP/TN/FN | Accuracy | FP rate | FN rate |
|---|---|---|---|---|---|---|
| ∩ | r4 | 273 | 51/2/174/46 | 0.824 | 0.011 | 0.474 |
| ∩ | **r5** | 273 | 51/2/174/46 | 0.824 | 0.011 | 0.474 |
| Cohort 6 validation | r4 | 1,252 | 249/29/837/137 | 0.867 | 0.033 | 0.355 |
| Cohort 6 validation | **r5** | 1,252 | 261/30/836/125 | **0.876** | 0.035 | **0.324** |
| All validation | r4 | 1,525 | 300/31/1,011/183 | 0.860 | 0.030 | 0.379 |
| All validation | **r5** | 1,525 | 312/32/1,010/171 | **0.867** | 0.031 | **0.354** |

### Prediction check
- **R5-a — HELD.** ∩ is identical, a pure control.
- **R5-b — HELD.** Cohort 6 FN is 125/386 = 0.324, inside [0.31, 0.34]. The 7 unvetoed H returned, and the model recalled 5 of the 10 un-ruled H.
- **R5-c — HELD.** Cohort 6 FP is 30/866 = 0.035 (≤ 0.036), and ∩ FP is 0.011. The only new false positive is the registered unvetoed Lbl.
- **R5-d — HELD.** 0 no-brace outputs, 0 parse failures.
- **Revert rule:** not triggered; the highest FP rate is 0.035.
- **Caveat, again:** designed on these validation rows. The held-out test of the two rules is the Stage 2→3 audit population and the sealed test set.

## Profile for round 6 (r4a predictions; analysis only)

**Populations:**
- H1 misses: 72 (c6 46, c4 14, c3 9, build 4 3).
- Recalled H1: 57.
- P→H false positives: 30 (c6 28), plus 1 Other→H.
- Correct P: a sample of 300 of 518, seed 20260915.

Full bucket tables are in `out/stage1/profile-r5.json` and `.superpowers/sdd/2026-09-13-stage1-round1/r5-T5-report.md`. Page height uses the maximum card y1 per page as a proxy.

**H1 misses against recalled H1, largest contrasts:**

| Fact | Misses | Recalled | Δ |
|---|---|---|---|
| Page index 0 | 51 % | 23 % | +29 |
| Page index 2+ | 38 % | 65 % | −27 |
| 2–3 words | 19 % | 44 % | −24 |
| Retagger tag H* | 68 % | 91 % | −23 |
| Empty approved-headings stack | 42 % | 19 % | +22 |
| Retagger tag Figure | 19 % (14 rows) | 0 % | +19 |
| Not bold | 22 % | 9 % | +13 |

**P→H false positives against correct P, largest contrasts:**

| Fact | FP | Correct P | Δ |
|---|---|---|---|
| Retagger tag H* | 94 % | 27 % | +66 |
| Bold | 68 % | 35 % | +33 |
| 8+ words | 19 % | 42 % | −22 |
| Top 15 % of page | 29 % | 7 % | +22 |
| Font 1.2–1.5× page median | 23 % | 2 % | +21 |

**Reading (not yet tested):**
1. **The H1 misses are mostly document titles.** They sit on page 0 with nothing yet in the approved-headings stack, often long, and sometimes turned into Figures by the retagger (14 rows). The model does better with H1s once a heading stack exists.
2. **The false positives look like headings on every visual fact,** and the retagger agrees 94 % of the time. The label says P because the key is the author's original tag. Some may be author tagging errors, where the key is wrong and the model right, rather than model errors.
   - This is a **label-audit question for round 6**: sample these 31 against the definition before any model change.
   - The retagger tag is not in the prompt; it correlates with the visual facts the prompt does carry.
3. **Cohort 6 dominance in raw counts** is about proportional to its 82 % share of validation.

### Stop decision
Stop and report to the reviewing session. Round 6's direction is theirs and the user's.

The profile points first at two things:
- auditing the 31 false positives and a sample of page-0 H1 misses against the definition;
- how the prompt presents a document's first page, where the stack is empty.

Class reweighting is not indicated by these tables.
