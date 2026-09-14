# Heading-type adapter — Stage 1 round 4 results

**Roadmap:** `docs/superpowers/plans/2026-09-13-staged-autonomy-roadmap.md` (Stage 1). **Registration base:** round 3's record `heading-stage1-r3-2026-09-14-results.md` (configuration S10/S15, P8 comparison rule). **Rulings:** S21–S23, K34, P9 in the SDD ledger (`.superpowers/sdd/2026-09-13-stage1-round1/progress.md`). **Definition:** `heading-definition-2026-09-13.md` (frozen).

**Status:** DRAFT REGISTRATION — prepared while cohort 6 is harvested. Nothing is trained. The data sections marked *(pending)* are filled, and this record is committed, before r4a trains.

## Why this round
Round 3 added a planted Word cohort (c5) for H3/H4 depth and regressed on real validation: accuracy fell from 0.781 to 0.720, and the FN rate rose from 0.392 to 0.784. The measured cause (S23) is surface uniformity. The 653 planted training headings were bold 0.99 / Title Case 0.87 / ALL CAPS 0.00 / 12 pt, against real training headings at 0.69 / 0.46 / 0.21 / 14 pt. The adapter learned the planted form.

Round 4 separates the two things round 3 mixed: real depth from harvest, and planted depth with realistic surfaces.

## Arms (registered order)
1. **r4a — real only.**
   - Data: build 4 + cohort 3 + cohort 4 + cohort 6.
   - No planted rows at all; c5 and c7 are both excluded.
   - Configuration: S10/S15 exactly as in rounds 2–3. That means upstream `mlx_vlm.lora`, batch 1, rank 8, `--train-on-completions`, `--grad-checkpoint`, and the 408-token image contract. It also means one epoch (`--iters` = SFT rows, `--steps-per-save` = `--iters`), with the 3 h projection gate judged once at step 50 (S21) and the 600-iteration cap. Output: `adapter-r4a`.
2. **r4b — r4a's data + varied planted cohort c7, capped.** Runs **only if** r4a's H3 or H4 recall on real validation is still below r2's on the same rows.
   - Same configuration; output `adapter-r4b`.
   - Planted H is capped at ≤ 40 % of emitted training headings (`emit_sft --max-planted-heading-share 0.40`).
   - `--exclude-doc-prefix c5-` always applies.
3. **Kill for planted.** If r4b does not beat r4a on real validation accuracy, on the same rows, planted data is abandoned for good.

## Data changes carried into this round
- **K34.** When two or more cards exact-match the same key element within a document, the card with the larger IoU keeps the match and the others are unmatched (08c9662). Round 3's known instance was `c3-0577:164`/`:165`, both train rows from one document, so no train/validation leak was possible. `:164` is kept and `:165` drops out when keys-all-4 is built.
  - keys-all-3's labels file is not edited; its sha is pinned by `split-keys-all-3`.
  - Counted, not applied: had K34 applied to keys-all-3, it would have unmatched **93 rows in 43 (document, key element) groups**.
    - By split: 82 train, 6 validation, 5 test.
    - By type: Other 45, H 29, P 15, TH 3, Lbl 1.
    - By source, across all rows in those groups: stripped-tree 114, planted 20, word-outline 2.
    - `c3-0577` was one of these groups, not the only one.
  - Consequence for P8: the 6 validation drops shrink the fixed comparison set. Pass/fail is judged on the **intersection** of round 3's 279 validation ids and keys-all-4's validation ids, expected to be 273. r2 and r3 are re-scored on exactly that set, and the dropped ids are listed in the results.
- **c5 excluded.** c5 stays on disk and never enters an SFT again (P9).
- **c7 surface facts.** Measured with `labels/surface_facts.py`, against pooled real train H and with c5 for reference. Pass rule: each share within ±10 points of pooled real train H.

| H population | n | Bold | Title Case | ALL CAPS | Ends punct | Median pt | Median words | PASS (±10) |
|---|---|---|---|---|---|---|---|---|
| Real train, pooled (stripped-tree + word-outline) | 377 | 0.69 | 0.46 | 0.21 | 0.03 | 14 | 3 | — |
| c5, train rows (excluded) | 653 | 0.99 | 0.87 | 0.00 | 0.00 | 12 | 2 | FAIL |
| c7, all rows | 961 | 0.67 (−2) | 0.52 (+6) | 0.24 (+3) | 0.01 (−2) | 14 | 2 | PASS |

Commands:
- Pooled real: `python3 -B -m labels.surface_facts --labels out/keys-all-3/labels.jsonl --cards out/keys-all-3/cards.jsonl --split out/keys-all-3/split/split.json --pool stripped-tree --pool word-outline`.
- c7: `--labels out/keys-c7/labels.jsonl --cards out/keys-c7/cards.jsonl`.

The controller recomputed both rows.

About c7 (generator commit 202f6e4):
- **Cohort:** 100 docx, seed base 20260915. c5 still regenerates byte-for-byte (101/101 files).
- **Keys:** `out/keys-c7` holds 1,672 cards, with match rate 0.930. H by level is 100/261/396/204.
- **Iterations:** 2 of 3. The first failed Title Case at +12.
- **P facts:** planted P bold is 0.38, against 0.44 real (c5: 0.53).

**Added gate (reviewer): planted H median words must be within ±1 of pooled real (3).** The c7 build above (iteration 2) has median words 2. It is renamed to `-it2` and kept on disk. c7 is regenerated with wider heading text pools, not padded strings, and re-measured *(pending — iteration 3)*.

Known residual cues, not gated by the spec:
- Median words is 2 against 3 real, because the text pools are reused from c5. Now gated; see above.
- ALL CAPS (0.24) sits slightly above both real sources.
- Ends punct (0.01) sits below both.

If r4b runs, these are the first suspects should it regress.

Emitter (202f6e4):
- `--exclude-doc-prefix` (repeatable) drops rows before emit.
- `--max-planted-heading-share` drops planted H rows in sha256(id) order after emit, until they are at or under the share. The counts go in the manifest, and the run fails loudly if the cap cannot be met.
- Both flags are tested on fixtures only; no real SFT has been written.

## Population and split *(pending cohort 6)*
- Split `split-keys-all-4`: `--keep` of `split-keys-all-3`. Build 4, cohort 3 and cohort 4 are pinned; only cohort 6 hosts are newly assigned. c7 hosts are assigned to train only if r4b runs, by a separate `--keep` that moves no existing id.
- Fixed real validation populations: build 4 (128), cohort 3 (68), cohort 4 (83), plus cohort 6's validation rows, reported separately.
  - Pass/fail below is judged on the **279 rows fixed since round 3**. That keeps r2, r3 and r4 comparable (P8). The cohort 6 population is reported alongside.
- Test floors are reported; test is not evaluated.

## Registered prediction *(confirmed by the reviewing session with edits; figures are finalised before r4a trains)*
Comparison set: the fixed real validation set, meaning round 3's 279 ids intersected with keys-all-4's validation ids (see K34). r2, r3 and r4a are each re-run on keys-all-4 cards over exactly that set. The r2 reference figures below come from the 279-row set and are restated on the intersection before training.

- **Q-a.** r4a's accuracy is greater than r2's (0.781 on 279 rows).
- **Q-b.** r4a's FN rate is at most r2's (0.392).
- **Q-c.** r4a's FP rate is at most r2's (0.126).
- **Q-d.** On r12, r4a's H3 recall is at least r2's (17/24), and r4a misses at most 11 of 15 H4.
- **Q-e.** r4a has 0 no-brace outputs and 0 parse failures across all predicted rows.
- **Q-f.** On cohort 6's validation rows, a new population neither adapter trained on, r4a's accuracy is greater than r2's.
  - Both adapters are scored on the same rows.
  - This is a prediction, not a pass/fail gate for the arm decision. It is the only real out-of-distribution test available.
- **Arm decision (not a prediction).** r4b runs iff r4a's H3 recall or H4 recall on the 279 rows is below r2's.
- **Not predicted:** the Stage 1 bar (accuracy ≥ 0.99, FP ≤ 1 %, level exactness ≥ 95 %).

## Also reported, unscored
- S16 no-brace count.
- Type confusion by decider.
- Errors by rule.
- Level exactness by depth (H1–H4).
- The surface-facts table for each SFT's headings, by source.

## Results
*(to be filled after the run)*
