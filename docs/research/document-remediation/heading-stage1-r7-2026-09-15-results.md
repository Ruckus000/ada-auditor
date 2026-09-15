# Heading-type adapter — Stage 1 round 7: two-sided audit and training-set pollution (no training)

> **Graded against Claude-audited labels** (Ruling R9). Every number in this record comes from judgements by the reviewing Claude session (`label_source` "claude-audit", actor "claude-coordinator"), not from a human relabel. A `human-answer` row on the same id outranks it.

**Previous record:** `heading-stage1-r6-2026-09-15-results.md`. **Adapter / rules:** r4a with round 5 rules, predictions in `out/stage1/pred-validation-r5.jsonl`. **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md`.

## Why
Round 6's audit examined only the rows r4a got wrong: its false positives and page-0 H1 misses. An audit like that can only raise the score. This round audits a random sample of the rows it got **right**, blind to group, so the audited accuracy gets a two-sided estimate.

## Sample
- **Draw:** 100 TP + 100 TN, seed 20260915, from r5 validation predictions scored against `labels-audited.jsonl`, excluding the 70 ids audited in round 6. The pools held 312 TP and 1,008 TN.
- **Files:** `out/labels/audit-r7-correct-sample-cards.jsonl` (shuffled ids) and, kept apart for blind judging, `out/labels/audit-r7-correct-sample-groups.json`.
- **By cohort:** TP c6 85 / b4 10 / c4 5; TN c6 84 / c3 8 / c4 4 / b4 4.
- **Judgements:** `out/labels/audit-r7-claude.jsonl`, 200 rows, judged from the marked-408 images, with 1 Unsure (TN group).

## Result (the controller recomputed the disagreement lists from the files)
- **TN group (key non-H, model non-H):** **13 of 99** decided rows are headings in the audit, so they are hidden misses. Exact 95 % interval **0.072–0.214**.
  - c3-0919:13
  - c4-0020:35, :37 (lettered subsections)
  - c6-0009:15, :33, :71, :257, :553, :2074 (column subsection headings)
  - c6-0134:195
  - c6-0224:11 (an FAQ question heading its answer)
  - c6-0381:317, :318 (form section labels)
- **TP group (key H, model H):** **4 of 100** are not headings in the audit, so they are hidden false positives. Exact 95 % interval **0.011–0.099**.
  - c6-0024:70, :351 (chapter running-head bands at the page top → Artifact)
  - c6-0102:248 (a table caption → Caption)
  - c6-0026:304 (a spanning group-header row in a checklist table → TH)
- **Agreement:** binary agreement 182/199. Non-H type agreement is loose (key P against audit Other or BlockQuote on list items and quotes), which does not affect the binary. Type-confusion tables exclude Other as before.
- **Clustering caveat.** The draw sampled rows, not documents. c6-0009 supplies 19 of the 99 decided TN rows and 6 of the 13 hidden misses. Without that document the TN rate is 7/80 = 0.088. The exact binomial intervals assume independent rows, so they are too narrow for a clustered sample.

## Two-sided estimate for r4a + r5 rules on validation (1,525), graded against Claude-audited labels
Round 6's audited counts were TP 343, FP 1, TN 1,012, FN 169. The hidden-miss rate is applied to the 1,008-row TN pool and the hidden-FP rate to the 312-row TP pool. The 70 round-6 ids are already audited.

| Rates used | Hidden misses | Hidden FPs | Accuracy | FN rate | FP rate |
|---|---|---|---|---|---|
| Point (13/99, 4/100) | ≈ 132 | ≈ 12 | **≈ 0.79** | ≈ 0.48 | ≈ 0.015 |
| Both rates at their interval's low end | ≈ 72 | ≈ 3 | ≈ 0.84 | ≈ 0.42 | ≈ 0.005 |
| Both rates at their interval's high end | ≈ 216 | ≈ 31 | ≈ 0.73 | ≈ 0.55 | ≈ 0.039 |

- The low and high rows pair the two interval ends to show a range. They are not a joint confidence interval, and clustering widens them.
- **Reading:** the round 6 figure (0.889) was upper-biased, as its caveat said. The two-sided estimate puts r4a with r5 rules near 0.8 accuracy with FN near 0.5.
- **The dominant error is under-calling headings:** hidden misses outnumber hidden false positives roughly ten to one.

## Train pollution: an independent rough estimate
- **Extrapolation:** the 13/99 hidden-miss rate among key-P rows the model also calls P suggests about 0.13 × 3,498 ≈ 455 real train rows keyed non-H that are headings.
- **Candidate proxy:** 639 train rows are retagger-H*, bold and ≤ 7 words, a count consistent in size with the extrapolation.
- **Caveat:** the validation TN population is conditioned on model-P, and train rows differ from validation rows. This is an order-of-magnitude cross-check, not a measurement.
- The measurement itself is below.

## §5 definition cases raised by the audit (need rulings; no label changed by this record)
1. **Running-head bands.** A chapter title repeated in the page-top band on chapter pages (c6-0024:70, :351). The audit reads Artifact; the key says H. Related: round 5's c6-0102 top-band repeats, which rule 2 kept as Artifact.
2. **Form section labels.** Short labels that head a group of form fields (c6-0381:317, :318). The audit reads H; the key says P.
3. **FAQ questions.** A question line heading its answer paragraph (c6-0224:11). The audit reads H; the key says P.
4. **Spanning group-header rows in tables.** A row spanning a checklist table that heads the rows beneath it (c6-0026:304). The audit reads TH; the key says H.

Also recorded as audit disagreements, not new definition shapes:
- column and lettered subsection headings the author left as P (c6-0009 ×6, c4-0020 ×2, c3-0919:13, c6-0134:195);
- a table caption keyed H (c6-0102:248).

## Training-set probe: seeded 400-row samples (r4a + r5 rules, real train, rows no rule decides)
Lower bounds, because r4a trained on these rows. 0 no-brace outputs.

| Direction | Flipped | Rate | Documents | Max per document | By cohort (flipped / sampled) |
|---|---|---|---|---|---|
| Key non-H → called H | 12 / 400 | 3.0 % | 11 | 2 (c6-0365) | c6 10/245, c3 1/63, b4 1/29, c4 0/63 |
| Key H → called non-H | 96 / 400 | **24.0 %** | 60 | 6 (c6-0259) | c6 71/315, c3 11/29, b4 8/35, c4 6/21 |

- **Reading, non-H → H:** the probe echoes the model's own training labels, so it cannot size under-tagging. That direction stops under the reviewing session's 5 % rule. The audit rate (13/99) and the 639 proxy remain the handles on it.
- **Reading, H → non-H:** a quarter of key-H rows are called non-H even though the model has seen them. That is either under-fitting or key over-calling, and only an audit can separate the two. This direction continued to the full set of 1,671.

**Full key-H set (1,671 real train rows no rule decides), lower bound:**
- **366 called non-H (0.219)**: 361 as P, 2 TH, 2 TOCI, 1 Caption.
- **Documents:** 133, most concentrated c6-0179 24, c6-0073 16, c6-0259 14, c3-0577 13, c6-0417 11.
- **By cohort:** c6 260/1,326, c3 54/135, c4 35/96, b4 17/114.
- **By key level:** H1 214/675 (0.32), H2 96/728 (0.13), H3 41/200 (0.21), H4 15/46 (0.33), H5 0/21, H6 0/1.
- H1 carries most of the flips, the same shape as r4a's page-0 title misses on validation.

**Audit sets built (seed 20260915):**
- **A:** 100 rows from the 366, document round-robin with a cap of 5. Actual: 100 documents, 1 per document.
- **B:** 120 rows from the proxy, recounted under r5 rules and `cards-r5` as 658 (the 639 used round 4 rules). Actual: 92 documents, at most 2 per document.
- **Blind file:** both sets shuffled together in `out/labels/audit-r7AB-cards.jsonl`, with groups in `out/labels/audit-r7AB-groups.json`.

## Round 7 plan (registered before any audit, relabel or training)
1. **Two audit sets, both sampled by document with a cap of 5 rows per document.** Card files hold ids only, and group files are kept apart so the judge stays blind.
   - **A:** 100 rows from the full key-H → called-non-H set.
   - **B:** 120 rows from the 639-row proxy (train key non-H, retagger H*, bold, ≤ 7 words).
2. **The reviewing session audits both sets** (label_source claude-audit).
3. **Round 7 SFT:**
   - Audited rows take their audited labels.
   - The un-audited remainder of the 639 proxy is **excluded** if B's heading precision is ≥ 0.8, **kept** if it is < 0.5, and audited in full before deciding if it falls in between.
   - Key-H rows that A shows are over-calls take their audited labels.
   - Nothing else changes.
4. **Configuration:** if A shows under-fitting (≥ 70 % of the flagged key-H rows are real headings), round 7 trains **two epochs**. That configuration change is justified by this pre-run measurement and stated as such. Otherwise it trains one epoch. Everything else is S10/S15.
5. **Evaluation:**
   - Score on the fixed populations against `labels-audited.jsonl`, plus any A/B corrections that touch validation (none expected; they are train rows).
   - Report the round 7 two-sided calibration beside the point numbers, and per-document concentration beside every rate.
   - Test stays untouched.

## Audit results for A and B (graded against Claude-audited labels)
Judged blind from `out/labels/audit-r7AB-cards.jsonl` into `out/labels/audit-r7AB-claude.jsonl` (220 rows, 0 Unsure). The controller recomputed both counts.

- **A (key H, called non-H by r4a on train):** **85/100 are real headings** (exact 95 % interval 0.765–0.914).
  - The 15 non-headings: letterhead lines 3, table captions or titles 3, running head or logo fragment 2, TH cells 2, list lead-ins 2, metadata or form-number lines 2, a menu item 1.
  - Verdict: **under-fit**, not key over-call. By the registered rule (≥ 70 %), round 7 trains **two epochs**.
- **B (proxy: train key non-H, retagger H*, bold, ≤ 7 words):** **89/120 are real headings**, precision 0.74 (exact 95 % interval 0.654–0.817). 92 documents, at most 2 per document, so no cluster.
  - Key type of the 89: P 81, Other 5, Caption 2, TH 1.
- **None of the 220 r7AB ids is a validation or test id** (controller assertion). Training and evaluation labels share no row. The 270 audit rows from round 6 (70) and round 7 (200) are all validation ids.

## Rulings made after the A/B results (reviewing session), before training
1. **B, a registration change made after seeing B's number, not the rule's outcome.** Precision 0.74 fell in the between band, where the registered rule said to audit all 658. The un-audited remainder of **538** is instead **excluded** from training. Reason, verbatim:

   > "The registered between-band resolution (audit all 658) costs ~540 more hand-read cards; excluding the un-audited remainder is the conservative choice on both axes the loop cares about (no label is fabricated, and no row with a ~74 % wrong-label rate trains the model). The 538 remain queued for audit in audit-r7-proxy-ids.json and are not labels."

2. **Level policy.** Where key and audit both say H, the key's level is kept, because it comes from the author's whole-document ladder while the audit's comes from one page image. Audited levels are used only where the key had no heading. Reason: audit and key levels agreed on only **32 of 85** A rows where both say H.
3. **Evaluation.** Score against `labels-audited.jsonl` plus the 200 round-7 validation audit rows directly. Apply the 13/99 and 4/100 calibration only to the un-audited remainder of each pool (TN 1,008 − 99 − 1 Unsure; TP 312 − 100). Report the direct number beside the calibrated point estimate, each tagged "graded against Claude-audited labels".
4. **Time gate (S27 raised for this run).** The gate is **13 h**, judged at step 100 from the measured it/s. Reason: "two epochs is the registered consequence of A ≥ 70 %". If step 100 projects past 13 h, training stops and reports. The projection is recorded below.

## Round 7 data
- **`out/keys-all-7/labels.jsonl`** (sha `ba8a9085…ded96e`, 10,363 rows) is `keys-all-4/labels.jsonl` (sha `28fb043a…e74c2`) with two changes:
  - the 220 r7AB rows take their audited type, under the level policy above, with the original kept under `superseded`;
  - the 538 proxy-remainder rows are removed.
  - Cards are `cards-r5`; ladders unchanged; split `split-keys-all-4` (ids unchanged, excluded rows absent). Manifest: `out/keys-all-7/manifest-r7.json`.
- **Exclusion arithmetic.** Train rows **7,051 = 5,214 entering emit + 538 excluded + 1,299 c5**.
  - Of the 538 excluded, **503 would have been emitted** under today's rules with their key labels: P 489, TOCI 11, TH 2, Caption 1. The other 35 are held by emit as "other".
  - Today's rules with key labels and no exclusion emit 4,493. Removing those 503 gives 3,990, and the audit's type changes move 3 held rows into emittable types, giving **3,993**.
  - The 90-row difference from sft-r4a (4,403) is the r5 margin-band rule deciding fewer rows plus cards-r5.
- **`out/stage1/sft-r7`:** **3,993 rows** (sha `43e38f27…bfa2`; held back: rule_decided 547, other 674).
  - By type: H 1,745 · P 2,058 · TH 84 · TOCI 62 · Lbl 34 · Caption 8 · Artifact 2 (H share 0.44).
  - H by level: L1 682, L2 767, L3 228, L4 46, L5 21, L6 1.
  - By source (H / non-H): stripped-tree 1,181 / 1,666; word-outline 390 / 539; claude-audit 174 / 43, which is 217 of 220, with 3 held by rules.
  - **Leak check:** all 3,993 rows are train ids; 0 c5 rows; 0 of the 538 excluded; 0 train documents in validation or test; 0 ambiguous or missing images.
- **Configuration:** S10/S15 as in r4a, with `--iters 7986` (two epochs) and `--steps-per-save 7986`. The 13 h gate is judged at step 100.
