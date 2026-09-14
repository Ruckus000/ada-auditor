# Heading-type adapter — Stage 1 round 4 results

**Roadmap:** `docs/superpowers/plans/2026-09-13-staged-autonomy-roadmap.md` (Stage 1). **Registration base:** round 3's record `heading-stage1-r3-2026-09-14-results.md` (configuration S10/S15, P8 comparison rule). **Rulings:** S21–S23, K34, P9 in the SDD ledger (`.superpowers/sdd/2026-09-13-stage1-round1/progress.md`). **Definition:** `heading-definition-2026-09-13.md` (frozen).

**Status:** REGISTRATION (final, pending the reviewing session's acknowledgement). Data prepared and committed before r4a trains; nothing is trained.

## Why this round
Round 3 added a planted Word cohort (c5) for H3/H4 depth and regressed on real validation: accuracy fell from 0.781 to 0.720, and the FN rate rose from 0.392 to 0.784. The measured cause (S23) is surface uniformity. The 653 planted training headings were bold 0.99 / Title Case 0.87 / ALL CAPS 0.00 / 12 pt, against real training headings at 0.69 / 0.46 / 0.21 / 14 pt. The adapter learned the planted form.

Round 4 separates the two things round 3 mixed: real depth from harvest, and planted depth with realistic surfaces.

## Arms (registered order)
1. **r4a — real only.**
   - Data: build 4 + cohort 3 + cohort 4 + cohort 6.
   - No planted rows at all; c5 and c7 are both excluded.
   - Configuration: S10/S15 as in rounds 2–3. That means upstream `mlx_vlm.lora`, batch 1, rank 8, `--train-on-completions`, `--grad-checkpoint`, the 408-token image contract and the default learning rate. It also means one epoch: `--iters` equals the SFT row count and `--steps-per-save` equals `--iters`. Output: `adapter-r4a`.
   - **Time gate (S27, replaces the S10 3 h gate / 600-iteration cap for this round).** That cap was sized for a roughly 900-row SFT; here it would train on under a tenth of the data.
     - r4a runs one full epoch with no iteration cap.
     - The wall-time gate is **10 h, judged once at iteration 100** from the measured it/s (S21's judge-once rule). sft-r4a has 4,403 rows; at about 0.2–0.24 it/s the projection is about 5–6 h.
     - If the projection exceeds 10 h, training stops and the number goes to the reviewing session. It is not capped.
   - **Prediction budget.** Round 3 took about 1 h per adapter for 279 rows, about 13 s per row including rule-decided rows.
     - r4a on the ∩ set (273 rows) plus cohort 6 validation (1,252 rows): 1,525 rows, about 5.5 h.
     - r2 on cohort 6 validation is run before training, as part of data preparation.
     - r2 and r3 on the ∩ set are restated from round 3's prediction files, not re-run (S25/S26).
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
  - **What the double-matches are.** All 43 groups are on a single page, and 41 of 43 have `repeats_on_pages` = 1, so they are **not running heads or repeated page furniture**. Most are candidate-extraction duplicates in the retagged candidate copy, not repeated text in the source.

    | Class | Groups | Extra rows |
    |---|---|---|
    | Identical box (same x0/y0), one or more copies tagged `Figure` by the retagger (stripped-tree) | 22 | 72 |
    | Identical box, no Figure copy (planted 8, stripped-tree 2, word-outline 1) | 11 | 11 |
    | Identical box + Figure copy (planted) | 2 | 2 |
    | Different box: the same text genuinely twice on a page (stripped-tree) | 7 + 1 with a Figure copy | 8 |

    Five examples, ids only:
    1. `c4-0028`, key H: one text line at one position yields 22 cards, one retagged H2 and 21 retagged Figure. The retagger emitted the same text object once as text and 21 times inside Figure elements.
    2. `c3-0875`, key P: one one-word line gives two cards at an identical box, retagged H3 and Figure.
    3. `c3-0423`, key P: a single numeral gives two cards at an identical box, retagged Caption and Figure.
    4. `c5-0006`, key P, planted: a table-cell line gives two cards at an identical box, retagged TD and P.
    5. `c3-0577`, key H: the same heading text at two positions 28 pt apart on page 24, retagged H1 and H2. This is the only kind where the source really repeats the text.

    **Hygiene finding.** The source key element is not suspect in these cases, because the key tree has the text once. The retagged candidate copy (ODL) duplicates text objects, mostly under Figure. K34 removes the duplicated labels, but the candidate pool still carries the duplicate cards as unmatched.
    - `existing_tag` is not used by the SFT prompt, so the Figure tag on a kept copy does not reach the model.
    - On identical-box ties, K34 keeps the first card in input order, which may be the Figure-tagged copy. Its box and image are identical, so the label is unaffected.
    - **K35, reviewer ruling, applied from keys-c6 onward (be46806).** `build_keys` drops later cards whose (page, box rounded to 1 pt, normalised text) equals an earlier card's, before candidate selection. The first copy is kept, and drops are counted per document in `report.json` (`duplicate_cards_dropped`).
      - This stops Figure copies from consuming a document's 150-card cap.
      - K34 remains the backstop for the same text at a different box.
      - keys-all-3 stays pinned and was built without K35, so its 93 K34 rows are removed by K34 in keys-all-4, not by K35.
      - c7 iteration 2 was built without K35; c7 iteration 3 is built with it.
      - K35 changes the input to the candidate selector, so per-page medians, repeat counts and the random-slice draws shift for any document that had duplicates.
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

**Added gate (reviewer): planted H median words must be within ±1 of pooled real (3).** The iteration 2 build had median words 2; it is kept on disk as `out/planted-c7-it2` and `out/keys-c7-it2`. **Iteration 3 (6a7bb63) is the c7 of record.** It adds new, longer per-family heading pools of 2–6 words (no padding) and is built with K35.

| c7 iteration 3 | n | Bold | Title Case | ALL CAPS | Ends punct | Median pt | Median words | PASS |
|---|---|---|---|---|---|---|---|---|
| H | 953 | 0.70 (+1) | 0.45 (−1) | 0.24 (+3) | 0.01 (−2) | 14 | 4 (+1) | PASS |
| P | 504 | 0.49 | 0.30 | 0.14 | 0.29 | 13 | 2 | not gated |
| Real train P, pooled | 1,112 | 0.44 | 0.34 | 0.18 | 0.21 | 12 | 4 | — |

About the iteration 3 build:
- 1,527 cards, match rate 0.938, H by level 100/264/395/194. c5 still regenerates byte-for-byte.
- K35 dropped **2,802 duplicate cards across 91 of 100 documents**, up to 100 in one document. The Word→PDF→retag path duplicates heavily.
- The controller recomputed the H and P rows.

**c7 acceptance rule (reviewer, generalised from the word-count finding).** The gate is on the H-vs-P **contrast**, not on H alone. Every share in `surface_facts.py` (bold, Title Case, ALL CAPS, ends punct) must be within ±10 points, with median words within ±1:
- for planted H against pooled real train H, **and**
- for planted P against pooled real train P.

The purpose is that no surface cue separates the classes in planted data unless it also separates them in real data. This rule does not block r4a.

**c7 iteration 3 against the rule:**
- **H:** passes on every share and on words.
- **P, four shares:** all pass. Bold 0.49 against 0.44 (+5), Title Case 0.30 against 0.34 (−4), ALL CAPS 0.14 against 0.18 (−4), ends punct 0.29 against 0.21 (+8).
- **P median words:** **fails**, 2 against 4.
- Result: c7 is **not yet accepted**. The inversion is that planted H (4 words) is longer than planted P (2), while real H (3) is shorter than real P (4). If r4b is triggered, the P distractor text is lengthened and c7 re-measured before any r4b SFT is emitted.

**K35 on the Word→PDF→ODL path.** 2,802 drops across 91 of 100 c7 documents. That is far more duplication than K35 finds on stripped originals. Cohort 6's docx half goes through the same route, so its drop count is reported separately from the PDF half.

Known residual cues, not gated by the spec:
- Median words is 2 against 3 real, because the text pools are reused from c5. Now gated; see above.
- ALL CAPS (0.24) sits slightly above both real sources.
- Ends punct (0.01) sits below both.

If r4b runs, these are the first suspects should it regress.

Emitter (202f6e4):
- `--exclude-doc-prefix` (repeatable) drops rows before emit.
- `--max-planted-heading-share` drops planted H rows in sha256(id) order after emit, until they are at or under the share. The counts go in the manifest, and the run fails loudly if the cap cannot be met.
- Both flags are tested on fixtures only; no real SFT has been written.

## Cohort 6 keys (`out/keys-c6`)
- **Harvest:** 460 files (159 docx, 301 pdf) from a bounded crawl of .edu/.gov hosts. The docx keep gate required heading use, not just a defined heading style. Ids and URLs are in `labels/cohort6-names.txt`.

| | docx | pdf | Total |
|---|---|---|---|
| Files | 159 | 301 | 460 |
| Usable | 87 (0.55) | 158 (0.52) | 245 |
| Label rows | 1,815 | 5,014 | 6,829 |
| K35 drops | 3,777 (54 docs) | 11,535 (97 docs) | 15,312 |

- **Rows:** 6,829, from 244 documents on 146 hosts, match rate 0.710.
  - H 2,223: L1 823, L2 959, L3 282, L4 129, L5 25, L6 5. That is 411 real H3/H4, against 26 in round 2's whole SFT.
  - Types: P 3,073, Other 881, Lbl 334, TH 226, TOCI 87, Caption 5.
- **Exclusions by reason instance:** level-skip 128, untagged-content 90 (89 pdf), prose-headings 41, no-headings 11, 7.4.4 2, checker-failed 1, strip-failed 1.
- **K35 is a property of the retagged copy on both paths.** 10 documents account for 66 % of drops, and a spot check on 3 documents found every drop an exact duplicate.
- **H surface:** stripped-tree bold 0.66 / Title Case 0.37 / ALL CAPS 0.22 / 12 pt / 3 words; word-outline 0.86 / 0.35 / 0.32 / 12 pt / 4 words. P runs 5–6 words.
- **Host spelling (S28).** The manifest counted 219 hosts to the harvest's 218. `labels.manifest.host_of` did not strip a port, so `acf.gov:443` was a second spelling of `acf.gov`.
  - As client and template id, that would be two split groups for one host.
  - It is fixed in `host_of` (a210767, with a test). The 75 affected keys-c6 rows are normalised in keys-all-4 at combine, and the split check asserts that no client or template spans two splits.
- **c6-0139.** Usable, but its 3 candidate cards all went unmatched and it produced 0 rows. It is a small document whose candidates matched no key element; recorded, not a defect.

## Population and split
- **Pool `out/keys-all-4`:** keys-all-3 with K34 applied at combine (−93 rows), plus keys-c6 (+6,829), for 10,901 rows.
  - K34 path: 35 identical-box groups kept the first row. The 8 different-box groups took the key box from a read-only `key_document` re-read of the original; no scratch rebuild was needed. Group c4-0019:86 was decided by file order, because both cards had IoU 0.
  - S28 normalised 75 rows to `acf.gov`.
  - Cards and ladders were built by concatenation (S26). keys-all-3 card lines are byte-identical, and only c6 images were reduced to the 408 contract.
- **Split `labels/split-keys-all-4-2026-09-14.json`** (f56413b): `--keep` of `split-keys-all-3` with `--keep-labels out/keys-all-3/labels.jsonl`, salt `1789423048-f2076c30`. A second draw was byte-identical.
  - 0 kept ids moved; the 93 K34 ids are simply absent.
  - No document, sha, client or template spans two splits, and no host is shared between keys-all-3 and keys-c6. The controller recomputed the no-span check and the counts.

| Split | Rows | Docs | Hosts | H | Non-H | H1 | H2 | H3 | H4 | H5 | H6 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| train | 7,051 | 285 | 129 | 2,331 | 4,720 | 746 | 880 | 490 | 193 | 21 | 1 |
| validation | 1,525 | 67 | 46 | 483 | 1,042 | 129 | 197 | 88 | 66 | 3 | 0 |
| test | 2,325 | 90 | 48 | 711 | 1,614 | 251 | 265 | 131 | 59 | 1 | 4 |

- **Train by population:** build 4 337, c3 770, c4 698, c5 planted 1,299 (excluded from every SFT), c6 3,947.
- **Fixed validation populations:**
  - build 4: 128 rows / 3 docs, H L1 3, L2 15, L3 24, L4 15.
  - cohort 3: 68 / 7 docs.
  - cohort 4: **77** / 2 docs from 1 host (83 − 6 K34 drops).
  - **cohort 6: 1,252 / 55 docs / 36 hosts, H 386** (L1 87, L2 181, L3 64, L4 51, L5 3).
- **∩ set:** 273 ids. Dropped from round 3's 279 were c4-0019:5, :69, :150, :180, :202 and :229, all negatives that both adapters scored TN. Every ∩ id's card, image and ladder is identical to keys-all-3's, so no re-prediction was needed.
- **Test floors:** 90 documents, 48 clients and 48 templates, all passing. Test is not evaluated.
- **SFT `out/stage1/sft-r4a`:** 4,403 rows, sha `3a2ac327…913f`, rebuild byte-identical, `--exclude-doc-prefix c5-`. 0 planted rows, 0 train documents in validation or test, 0 own-element leaks (controller recomputed rows→train and the planted count).
  - H by level: L1 675, L2 728, **L3 200, L4 46**, L5 21, L6 1. Round 2's SFT had 25 H3 and 1 H4; round 3's had 326/144, mostly planted.

## Reference figures, restated before training (S24)

| Adapter | Set | n | TP/FP/TN/FN | Accuracy | FP rate | FN rate |
|---|---|---|---|---|---|---|
| r2 | ∩ | 273 | 59/23/153/38 | 0.777 | 0.131 | 0.392 |
| r3 | ∩ | 273 | 21/2/174/76 | 0.714 | 0.011 | 0.784 |
| r2 | cohort 6 validation | 1,252 | 314/99/767/72 | 0.863 | 0.114 | 0.187 |

- **Level exactness on ∩** (n / recalled as H / exact level):
  - r2: H1 42/24/22, H2 16/14/6, H3 24/17/7, H4 15/4/3.
  - r3: H1 42/10/6, H2 16/1/1, H3 24/7/5, H4 15/3/3.
- **r12:** r2 H3 recall 17/24 and H4 missed 11/15; r3 7/24 and 12/15. These are unchanged from round 3.
- **r2 on cohort 6 validation:**
  - Level exact 236/314. By depth: H1 87/71/59, H2 181/159/144, H3 64/54/18, H4 51/27/13, H5 3/3/2.
  - 0 no-brace outputs, 0 parse failures.
  - Errors by rule: P→H rule 1 (model) 93; H→P rule 4 (model) 44; **H→Artifact rule 2 (rule) 15**; H→TH rule 3 (model) 8; small others.

**Found in preparation, recorded, not changed this round:**
1. **Rules-in-front mislabel real headings.** On cohort 6 validation, 15 true H were ruled Artifact (repeats rule 2) and 1 Lbl (no-letters rule 3) before any model ran. This caps r2 and r4a equally on Q-f, and the 279-row set never showed it. It is a candidate for the next round's rule review.
2. **Source cue inside real data.** In sft-r4a, word-outline H are bold 0.93 against stripped-tree H at 0.64. Not gated; P10's contrast rule applies to planted data only.
3. **Validation is now dominated by cohort 6** (1,252 of 1,525 rows), and cohort 4's validation is 2 documents from one host. That is why the pass/fail set stays the ∩ set, and why cohort 6 is its own population.

## Registered prediction *(final; the reviewing session acknowledges before r4a trains)*
The comparison set is ∩ (273 rows), with r2 and r3 as restated above. r4a predicts on keys-all-4 cards over ∩ and cohort 6 validation.

- **Q-a.** r4a's accuracy on ∩ is greater than r2's (0.777).
- **Q-b.** r4a's FN rate on ∩ is at most r2's (0.392).
- **Q-c.** r4a's FP rate on ∩ is at most r2's (0.131).
- **Q-d.** On r12, r4a's H3 recall is at least 17/24, and r4a misses at most 11 of 15 H4.
- **Q-e.** r4a has 0 no-brace outputs and 0 parse failures across every predicted row (∩ and cohort 6 validation).
- **Q-f.** On cohort 6 validation (1,252 rows), r4a's accuracy is greater than r2's (0.863).
  - This is a prediction, not a gate for the arm decision. It is the only real out-of-distribution test.
  - Cohort 6 validation is its own fixed population: full evaluator table for both adapters, errors by rule, and a per-depth level table H1–H6. It is the first test of the H3/H4 claim on real documents other than r12.
- **Arm decision (not a prediction).** r4b runs iff r4a's H3 recall or H4 recall on ∩ is below r2's (17/24, 4/15). Before any r4b SFT, c7 must pass P10, the H and P contrast gate; it currently fails on P median words.
- **Not predicted:** the Stage 1 bar (accuracy ≥ 0.99, FP ≤ 1 %, level exactness ≥ 95 %).

**Budget:**
- Training: 4,403 iterations at about 0.2–0.24 it/s, about 5–6 h. The 10 h gate is judged at iteration 100 (S27).
- Prediction: r4a on 273 + 1,252 = 1,525 rows at about 13 s per row, about 5.5 h.

## Also reported, unscored
- S16 no-brace count.
- Type confusion by decider.
- Errors by rule, per population.
- Level exactness by depth (H1–H6) per population.
- The surface-facts table of sft-r4a's H and P rows by source.

## Results
*(to be filled after the run)*
