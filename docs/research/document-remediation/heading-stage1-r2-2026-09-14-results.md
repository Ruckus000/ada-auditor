# Heading-type adapter — Stage 1 round 2 results (validation only)

**Roadmap:** `docs/superpowers/plans/2026-09-13-staged-autonomy-roadmap.md` (Stage 1). **Registration:** `2026-09-13-stage1-round1.md` (worktree sleepy-mclaren-b8ba9e), amended by the round-2 rulings S10–S17 in the SDD ledger. **Definition:** `heading-definition-2026-09-13.md` (frozen). **Previous record:** `heading-keys-2026-09-13-results.md` (Stage 0, build 4). **Branch/head at record time:** `claude/heading-labelling-pass` @ 9996434; `predict.py` from e078403.

This is the first real measurement of the model. Everything below is as measured.

## Stated plainly
- **The Stage 1 bar was not met.** Accuracy 0.806 (95 % lower bound 0.754) against ≥ 0.99. FP rate 0.101 (95 % upper bound 0.155) against ≤ 1 %. Level exactness 22/42 = 0.524 against ≥ 95 %. Parse failures 0 and abstentions 0 do meet the bar.
- **The test split was not evaluated.** `out/keys-all/split/test.spent` does not exist.
- **The test split fails two of the evaluator's floors.** It has 15 documents (`MIN_TEST_DOCUMENTS` 30) and 9 templates (`MIN_TEST_TEMPLATES` 10). It meets `MIN_TEST_CLIENTS` 5 with 9. The evaluator has no explicit non-heading floor; the 309 non-headings enter only through the FP rate's 95 % upper bound, which must be ≤ 1 %. A single test evaluation could not certify the bar even if validation met it.
- **Validation is small.** It has 10 documents and 9 hosts. One document, r12, is 91 of 196 rows and holds 20 of 38 errors. The bounds are wide, and the population means say more about r12 than about a web population.
- **The smoke adapter's evaluation numbers are not quoted here or anywhere** (ruling S5). Its training speed and peak memory appear only as the timing and memory context behind S10. No round 1 comparison is reported, because round 1 was skipped as a quality round (S17).

## Population
- **How the data came to be.** Build 4 (70 tagged originals from the corpus) fired the Stage 0 kill at 67 % excluded (47 of 70). Over the 70 tagged originals, YIELD (keys with no headings) was 37/70 = 53 % and TRUST was 23/70 = 33 % as distinct documents, or 27/70 = 39 % counted by reason instance (S4). The peer ruled that round 1 would not train on the build-4 pool as a quality round, and a plumbing smoke ran instead (S5). The smoke was diagnosed through the S9 overfit probe: 10/10 seen rows parsed, and the masked span was correct, so the cause was coverage and not masking.
  - Round 2's pool combines two parts (R1). The first is build 4's documents, rebuilt under K24 (container types excluded), K25/K27 (the §4 tie-break) and K28.
  - The second is cohort 3: a .gov web sweep of 963 documents from 120 hosts, all one CMS. 441 of its originals were tagged, 55 were usable and 54 contributed rows.
  - Combined: 1,697 rows, 77 documents, 57 hosts. On the combined pool TRUST is 189/511 = **37.0 %**, which is ≤ 50 %, so S8 allowed training. YIELD is 362/511 = **70.8 %**.
- **Split.** `eligibility_eval.py split --keep` over build 4's split (K29), with salt `1789358051-d8f5b13f` (kept salt `1789354356-055bad5c`) and labels sha256 `4591465b…95bbe5`. No build-4 document moved.

  | | train | validation | test |
  |---|---|---|---|
  | rows | 1,120 | 196 | 381 |
  | documents | 52 | 10 | 15 |
  | hosts | 39 | 9 | 9 |
  | H | 259 | 67 | 72 |

- **SFT (train split).** 879 rows: P 599, H 255, TH 13, TOCI 7, Lbl 3, Caption 2.
  - 241 rows were held back: 86 decided by rules, 155 other (not in the vocabulary).
  - sha256 `e497349de686fadc3c65085ecb8e97314ec0af157a930785fb0a0b70770893b8`, recomputed on `out/stage1/sft-r2/train.json` at record time.
  - 0 SFT ids are in validation or test.
  - S2 leak check: 8 text hits, 0 cases of a row's own element appearing in the stack.
- **Validation population.** 196 rows: P 115, H 67, Other 9, Caption 2, Lbl 2, TH 1.
  - Build-4 documents: n07, n10 and r12, 128 rows.
  - Cohort-3 documents: c3-0056, c3-0073, c3-0399, c3-0424, c3-0502, c3-0551 and c3-0919, 68 rows.

## Config
The command that produced the adapter (Task 3, attempt 2):

```bash
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 nohup <venv>/bin/python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset out/stage1/sft-r2 --split train \
  --batch-size 1 --lora-rank 8 --iters 879 \
  --steps-per-report 50 --steps-per-save 879 \
  --train-on-completions --grad-checkpoint \
  --output-path out/stage1/adapter-r2 > out/stage1/train-r2.log 2>&1 &
```

The model is `mlx-vlm 0.7.0`, language-side LoRA only, with the default learning rate (2e-5).

**Amendments to the registration, all made before any result:**
- **S1 (code deviation).** The prior stack excludes the card's own key element (matched by `key_locator`, with a 2 pt same-page guard). Without it, every heading card would have shown its own answer in the prompt.
- **S11 (code deviation).** `key_context` and `emit_sft` gained `--out` and a repeatable `--source <build dir>:<manifest>[:<word_pdfs>]`, so the combined pool's tagged and stripped copies resolve from their own builds (keys-b4r2 and keys-c3).
- **S10.** The registration assumed about 1.0–1.1 it/s, which put 2 epochs at about 2 h. The smoke measured 0.079 it/s, so 2 epochs × 1,120 rows would have taken about 7.9 h. That falsified the timing assumption before any validation number existed. S10 made three changes:
  1. Images use Part 28's 408-token contract: reduced copies under `out/keys-all/pages/marked-408/`, used by both the SFT rows and `cards.jsonl`. 1,697 were reduced to 1,697.
  2. `--grad-checkpoint` was turned off, on the premise of the smoke's 14.4 GB peak out of 36 GB.
  3. One epoch, with a 3 h projection gate after 50 steps and a 600-iteration cap if the gate failed.
- **S12.** "408" is the sizing contract (`max_pixels` 448000 through Part 28's `resize_row`), not an exact token count. Page aspect gives 405–432 tokens: 414 for 1,493 images, 432 for 153, 416 for 29 and 405 for 22.
- **S13.** "One epoch" means one pass over the emitted SFT, so `--iters 879 --steps-per-save 879`. The 1,120 figure counted rows that emit holds back.
- **S15.** Attempt 1, without checkpointing, ran out of Metal memory on step 1 (`kIOGPUCommandBufferCallbackErrorOutOfMemory`; log kept as `train-r2-attempt1-oom.log`). `--grad-checkpoint` was restored and every other S10 item stood. S10(2) had read a checkpointed run's peak as headroom for a run without checkpointing.
- **S16.** Outputs with no brace are counted separately from parse failures.
- **S17.** One predict run over all 196 validation rows and one registered evaluator run. Each fixed population goes through `eligibility_eval.evaluate()` on its own filtered rows.

## Training
- **Iterations:** 879/879. The cap did not fire: the projection at step 50 was 879 / 0.255 ≈ 57 min, under 3 h.
- **Wall time:** about 7,763 s (2 h 9 m). The log was created at 00:47:17 and the adapter written at 02:56:40.
- **Speed.** The ledger's **0.265 it/s** is the trainer's report for the last window (iterations 851–879) only. The mean over the whole run is 879 / 7,763 ≈ 0.113 it/s. Mid-run windows fell to 0.067–0.13 it/s between iterations 400 and 850, and the cause was not diagnosed.
- **Loss:** first report (iteration 50) 0.1635, last (iteration 879) 0.0460. No NaN at any point.
- **Peak memory:** 11.742 GB.
- **Adapter:** `adapters.safetensors` sha256 `648c406376764d1725f7b3a6063ee2924d12ed3f8f27d1553f6610fafd8d175c`.

## Prediction
`python3 -B -m labels.predict … --on validation --adapter out/stage1/adapter-r2 --out out/stage1/pred-validation-r2.jsonl` wrote 196 rows: 23 decided by rules, 173 by the model.
- Predictions sha256: `0288ef69cba943c550cffb2d1049d417115b748155973a117c12bb474040876e`.
- The table-box veto fired 0 times.

## Evaluator results

| | whole validation | build-4 docs | cohort-3 docs |
|---|---|---|---|
| n (H / non-H) | 196 (67 / 129) | 128 (57 / 71) | 68 (10 / 58) |
| tp / fp / tn / fn | 42 / 13 / 116 / 25 | 35 / 4 / 67 / 22 | 7 / 9 / 49 / 3 |
| accuracy (95 % lower bound) | 0.8061 (0.7538) | 0.7969 (0.7295) | 0.8235 (0.7298) |
| FP rate (95 % upper bound) | 0.1008 (0.1554) | 0.0563 (0.1243) | 0.1552 (0.2552) |
| FN rate | 0.3731 | 0.3860 | 0.3000 |
| abstentions | 0 | 0 | 0 |
| parse failures | 0 | 0 | 0 |
| no-brace outputs (S16) | 0 | 0 | 0 |
| missing predictions | 0 | 0 | 0 |
| level exactness (accepted true headings) | 22/42 = 0.524 | 17/35 = 0.486 | 5/7 = 0.714 |
| documents / clients / templates | 10 / 9 / 9 | 3 / 3 / 3 | 7 / 6 / 6 |
| target_met | false | false | false |

There were no abstentions or parse failures, so every card was decided and accuracy on decided cards equals accuracy.

**Evaluator type confusion** (truth→predicted, excluding truth `Other`):

| | whole | build-4 | cohort-3 |
|---|---|---|---|
| H→H | 42 | 35 | 7 |
| H→P | 24 | 21 | 3 |
| H→TOCI | 1 | 1 | 0 |
| P→P | 80 | 41 | 39 |
| P→H | 13 | 4 | 9 |
| P→Lbl | 22 | 16 | 6 |
| Caption→P | 2 | 2 | 0 |
| TH→P | 1 | 1 | 0 |
| Lbl→Lbl | 2 | 2 | 0 |

**Blockers.**
- Whole split: accuracy below target; FP rate above target; 95 % lower bound on accuracy below target; 95 % upper bound on FP rate above target; fewer than 30 documents; fewer than 10 known templates.
- Build-4 population: the same list, plus fewer than 5 clients.

The full JSON is in `out/stage1/eval-validation-r2.json`, `eval-validation-r2-build4.json` and `eval-validation-r2-cohort3.json`. None of these files are committed.

## Rule-decided vs model-decided

| | rule n | rule acc | rule FP / FN | model n | model acc | model FP (rate) | model FN (rate) |
|---|---|---|---|---|---|---|---|
| whole | 23 | 1.000 | 0 / 0 | 173 | 0.780 | 13 (13/106 = 0.123) | 25 (25/67 = 0.373) |
| build-4 | 17 | 1.000 | 0 / 0 | 111 | 0.766 | 4 (4/54 = 0.074) | 22 (22/57 = 0.386) |
| cohort-3 | 6 | 1.000 | 0 / 0 | 62 | 0.806 | 9 (9/52 = 0.173) | 3 (3/10 = 0.300) |

- All 38 heading-bit errors come from the model. No validation row is truly H among the rule-decided rows.
- **On type, though, the rules are wrong on 22 of 23 rows.** The no-letters rule (`Lbl`, rule 3) fired on 22 rows the key labels `P` (16 build-4, 6 cohort-3) and on 1 row the key labels `Lbl`. The `Artifact`-by-repeat rule fired on 0 validation rows.
- The bit is unaffected, since both types are non-H.

## Top confusions
There are only 3 distinct bit-error shapes and 8 distinct type-mismatch shapes, so the full lists are given. Each entry is (truth type, predicted type, cited rule, decider) with its count.

Bit errors (heading vs not):

| truth | predicted | cited rule | decider | whole | build-4 | cohort-3 | §4 rule it points at |
|---|---|---|---|---|---|---|---|
| H | P | 4 | model | 24 | 21 | 3 | rule 4: the model called a key heading a prominent non-heading (visual cue not the reason) |
| P | H | 1 | model | 13 | 4 | 9 | rule 1: the model called a key paragraph a section label |
| H | TOCI | 3 | model | 1 | 1 | 0 | rule 3: more specific type (TOC entry) claimed over H |

All type mismatches (the bit errors above, plus type errors that leave the bit correct):

| truth | predicted | cited rule | decider | whole | build-4 | cohort-3 | §4 rule |
|---|---|---|---|---|---|---|---|
| H | P | 4 | model | 24 | 21 | 3 | rule 4 |
| P | Lbl | 3 | rule | 22 | 16 | 6 | rule 3 (bare numeral / list marker → Lbl) |
| P | H | 1 | model | 13 | 4 | 9 | rule 1 |
| Other | P | 4 | model | 7 | 4 | 3 | rule 4 (truth is outside the vocabulary) |
| Caption | P | 4 | model | 2 | 2 | 0 | rule 3 missed (caption), rule 4 cited |
| Other | Lbl | 3 | model | 2 | 1 | 1 | rule 3 (truth outside the vocabulary) |
| TH | P | 4 | model | 1 | 1 | 0 | rule 3 missed (table header), rule 4 cited |
| H | TOCI | 3 | model | 1 | 1 | 0 | rule 3 |

**Where the errors sit.**
- **By document** (fp / fn): r12 0/20, n07 4/1, n10 0/1, c3-0073 4/1, c3-0551 3/0, c3-0502 2/0, c3-0424 0/1, c3-0919 0/1; c3-0056 and c3-0399 have 0/0.
- **r12 alone holds 20 of 25 false negatives** (19 H→P, 1 H→TOCI). The per-document cap of 150 bound on r12 at candidate selection; the 91 validation rows are what remained after matching.
- **False negatives by true level:** H1 5, H2 2, H3 7, H4 11.
- **Level on the 42 true positives, as (truth, predicted) counts:** exact at H1 6, H2 6, H3 7 and H4 3; off by one 20 times: (3,2) 7, (2,3) 6, (3,4) 3, (1,2) 2, (2,1) 1, (4,3) 1.
- **Match kind** of the 38 bit errors: exact 37, contains 1. None is a box match.
- **Table box:** 0 of the 38 bit errors are in a table box.

## Prediction check (registered: accuracy on decided cards 0.95–0.985; FP rate 1–4 %; Stage 1 bar expected to fail)
- **Accuracy on decided cards 0.95–0.985: falsified.** Measured 0.806 over 196 decided cards (lower bound 0.754), below the predicted range. Model-decided cards alone score 0.780.
- **FP rate 1–4 %: falsified.** Measured 10.1 % (upper bound 15.5 %), above the range. The cohort-3 population is at 15.5 %. The build-4 population is at 5.6 %, also above.
- **Stage 1 bar expected to fail: held.** The bar failed on accuracy, both bounds, FP rate and level exactness.
- **"The deliverable is the errors-by-rule and type-confusion tables": delivered above.**

## Caveats
- **The level stack is optimistic.** The "approved headings so far" stack is the key's own ladder (by design; roadmap "approved prior stack"). In deployment a person or earlier model decisions build it. Even with the true ladder, level exactness is 0.524. S1 keeps the card's own key element out of the stack.
- **TLS was off for the harvest.** Cohort 3 was fetched with TLS verification off. Content was validated by magic bytes (0/963 mismatches) and SHA-256.
- **Cohort 3 is one CMS** (CivicPlus). About 520 untagged documents and 294 scans without fonts are excluded by construction.
- **Keys under-count headings.** A heading an author tagged P still enters as a P label. Some P→H "false positives" may be key errors, and no validation card was checked by eye for this record.
- **S14:** c3-0577:164 and :165 share text and key element c3-0577:124, so one train label may be duplicated or mismatched. Both are train rows (c3-0577 is not in validation), so they cannot touch these numbers directly.
- **Stage 0's gate is still not met.** Labelled cards are about 1.7k against ≥ 20,000, and the match rate is 0.638 on cohort 3.

## Stop decision — what round 3 addresses
The evidence comes from the errors-by-rule table above.

This section states what was measured. The data gap on deep headings is the leading hypothesis, not a finding.

1. **Leading hypothesis: a data gap on deep headings, addressed by more cohorts.**
   - **False negatives.** The largest class is H→P citing rule 4 (24 of 38 bit errors). r12 holds 20 of the 25 false negatives (19 H→P and 1 H→TOCI). By true level, 18 of the 25 are H3/H4.
   - **Training depth.** The SFT's 255 H rows come from 40 documents; the SFT as a whole spans 51. By level they are H1 107, H2 122, **H3 25, H4 1**.
   - **Validation depth.** Validation has 24 H3 and 15 H4 headings. **All 39 are in r12**, and r12 holds 55 of validation's 67 headings. 11 of the 15 H4s were missed.
   - **Confounded.** On this validation set a heading-depth data gap and an r12-specific gap cannot be separated: every deep heading is in r12, and r12 is almost every heading. More cohorts are the fix that would separate them and narrow the bounds.
   - **False positives.** The second class, P→H citing rule 1 (13), is mostly cohort 3 (9), spread over three documents. Cohort 3 is one CMS.
   - **Facts: only one fact was checked.** The in-table-box fact is involved in 0 of the 38 errors.
     - The repeat and numeral facts are 0 by construction: the rules in front decide those rows before the model sees them, so their zeros say nothing about ignored facts.
     - Font size, weight, existing tag and ancestors were not examined against the errors.
     - A facts gap is not indicated by the one fact checked, and is not ruled out.
   - **Definition.** No definition-level cause was found for the model's errors. None was looked for beyond the numeral item below, which is the only definition-level item found.
2. **Definition item: a §5 ruling on numerals.**
   - The no-letters rule in front labels 22 of 23 rule-fired rows `Lbl` where the key says `P`.
   - §4 rule 3 says "a list marker or bare numeral is Lbl"; the keys' authors tagged these numerals as paragraph content. The bit is unaffected.
   - A §5 ruling is needed on which is right: a bare numeral in running content, versus a list marker. Without it, every typed metric for Lbl/P is at odds with the keys by construction.
3. **Facts gap: not indicated by the one fact checked (table box), and not examined for the others.**

**No-brace regression: did not persist.** 0 of 173 model outputs lack a brace, and parse failures are 0 on both populations. The smoke adapter's prose regression did not recur after one full pass over the SFT (S9's coverage verdict stands).

The Stage 1 kill ("after three rounds with error analysis applied, validation accuracy flat below 97 %") is not yet reachable. This is the first measured round.
