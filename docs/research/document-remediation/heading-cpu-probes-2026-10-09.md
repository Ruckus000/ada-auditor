# No-GPU heading probes: trainer audit, label-audit design, CPU second opinion (2026-10-09)

The three levers from the 2026-10-09 literature review that need no GPU, plus the user-approved
re-judge of §4. Nothing here started MLX or touched cohort 9, the shadows, or the r14 checkout. Scripts
are in `experiments/heading-cpu-probes/`. Card-level outputs (predictions, labels, judge answers) are
in the data directory under `out/cpu-probes-2026-10-09/`, backed up to the private data repo
(a440d54), not in this repository.

## 1. Trainer audit: no silent waste, and the page-sharing levers do not apply to this input

These facts are read from mlx_vlm 0.7.0 and the r17-mix log, without running anything.

| check | finding |
|---|---|
| vision tower | Frozen. `get_peft_model` → `freeze_model` (`trainer/utils.py:196-254`), and `--train-vision` is never passed |
| LoRA targets | 248 modules, all under `language_model`: MLP 3×32, Gated DeltaNet projections 5×24, attention 4×8. Rank 8, scale 2.0, dropout 0 |
| trainable parameters | 16.2M of 4,539M (0.36 %), printed at `lora.py:201` |
| image size | About 414 tokens (576×736 marked-408 PNGs, made by `reduce_marked_408.py`, `MAX_PIXELS` 448,000). The trainer does no resizing |
| r17-mix run | 24,714 iterations at 0.20 it/s, 162 tok/s, about 815 tokens per iteration, peak memory 14.4 GB, **34.8 h** |
| achieved compute | 6 to 8 × 4.54B parameters × 162 tok/s ≈ **4.4 to 5.9 TFLOP/s**. The review's 2.6 TFLOP/s was too low; there is less overhead to recover than it implied |

**Every card has its own marked image.** The magenta box is drawn into the pixels. All 10,728
cohort-8 cards have distinct image files, and the r17-mix SFT has 11,493 images for 12,357 rows
(the duplicates come from oversampling). So the review's two biggest speed levers cannot work on the
current input:
- caching a page's image across its cards at scoring time;
- packing a page's cards into one training sequence.

Each would first need a different input: one unmarked or numbered-box page image, with each card
identified in text. The judges' page sheets already work that way.

**What a numbered-box input would buy, measured:**
- **Scoring:** cohort 8 has 7,139 model-scored cards on 416 pages, a mean of 17.2 per page
  (median 11). With the image paid once per page, a card costs about 400 + 414 / 17 ≈ 424 tokens
  instead of 815, so **about 1.9× less scoring work**. That is an upper bound before any accuracy
  effect.
- **Training:** the current SFT has 1.08 cards per page, so packing it saves almost nothing.
  Training on whole pages would cover every block on a page at roughly the cost of one image. It
  would also move the training mix from 49.5 % H toward the product's 8.5 %, which is option A of
  the 2026-10-06 stock-take. This is an inference, untested.
- It is a new formulation that needs its own training run and registration. It is not a free
  speed-up.

## 2. Label-audit design (costed, nothing spent)

Errors at the certification threshold by mechanism (2026-10-09 anatomy classes) and by how the label
was settled:

| mechanism | seats agreed | tie-break |
|---|---:|---:|
| rule-decided | 7 | 6 |
| scan segmentation | 8 | 2 |
| forms and tables | 9 | 1 |
| run-in | 6 | 4 |
| map title | 1 | 2 |
| false positives | 0 | 2 |
| **total** | **31** | **17** |

17 of the 40 tie-broken decided cards are errors (42 %), against 31 of the 8,853 cards where the
seats agreed (0.35 %). That gap justifies a re-judge. It does not settle which way the re-judge
will go: 15 of the 17 tie-breaks were unanimous.

**Proposed sample (`audit-design.json`, seed 20261009):**
- All 48 errors.
- 92 correct decided comparators, about 2 per error. Each comes from the error's own document, with
  the same predicted heading bit and the same decider (model or rule). Four errors had too few
  comparators.
- 140 cards in all, shuffled into one blind list.

Re-judging only the errors could only lower the count, so the comparators carry the result.

**Cost in the shadow budget's unit** (deduplicated; input + cache writes + output + 0.1 × cache reads):

| item | cost |
|---|---:|
| seats, at 7.3k per card | 1.0M |
| tie-breaks, at the sample's existing 15 % rate × 209k | about 4.4M |
| **total** | **about 5.4M** |

**Price note, checked against the claude-api reference.**
- Actual cache-read prices against base input:

  | model | cache read | share of base input |
  |---|---|---:|
  | Opus 5.5 | $0.20 per MTok | 0.05× |
  | Fable 5.1 | $0.25 per MTok | 0.025× |
  | Sonnet 5.5 | $0.20 per MTok | 0.1× |

- Cache writes cost 1.25× base input on the 5-minute TTL and 2× on the 1-hour TTL.
- The Batch API's 50 % discount stacks with both.
- So the 0.1× weighting overstates cache-read dollars on Opus and Fable. It is still the unit the
  shadow budget is denominated in, so costs here stay in that unit.

## 3. CPU second opinion: stopped at the instrument check, nothing read

The registration is `heading-cpu-probes-2026-10-09-registration.md` (commit 8bf22762).

- **Check 1 passed.** The sidecars at t = 0.9940428 reproduce 8,893 decided cards and 48 errors,
  with the same ids as `cert-fit-2026-10-09.json`. Features cover all 10,021 cards. The folds span
  78 hosts and 101 documents.
- **Check 2 failed:** the shuffled-label control gave a pooled out-of-fold AUC of **0.424**, outside
  the registered [0.45, 0.55]. As registered, the real model was not fit and nothing was read.

**Diagnosis**, using control predictions only (the real out-of-fold model was never computed):

| run | per-fold AUC | pooled AUC |
|---|---|---:|
| registered settings | 0.49, 0.48, 0.48, 0.35, 0.40 | 0.424 |
| shuffle seeds 1–3 | — | 0.43, 0.41, 0.42 |
| early stopping | — | 0.465 |
| `min_samples_leaf` = 200 | — | 0.472 |

- The low AUC repeats across seeds and shrinks as the trees are regularised. That is the signature
  of a model fitting noise on an imbalanced label (8 % H), not of a leak. In sparse, heading-like
  feature regions, small leaves usually hold zero positives, so a noise-fit model scores real
  headings below average.
- **A leak would push AUC up, not down.** So this check was mis-specified: a two-sided band around
  0.5 assumes a noise-trained model scores at chance, and with this imbalance and unregularised
  trees it does not.
- Amending the check is a decision for the user, made before any real read. The obvious amendment
  is one-sided: control AUC ≤ 0.55.

### Result under amendment 1 (one look): KILL, the second opinion makes the same mistakes

The checks passed under the one-sided control (0.424 ≤ 0.55, baseline exact). Out of fold, the
typography-only model reaches AUC 0.909 and accuracy 0.939 on all labelled cards, far weaker than
the combination. On the combination's 48 errors it is wrong the same way:

| veto at | caught (model FN / rule FN / FP) | correct lost | decided | errors | bar | coverage |
|---:|---|---:|---:|---:|---:|---:|
| 0.50 | 4 (1 / 3 / 0) | 122 | 8,767 | 44 | 30 | 0.875 |
| 0.80 | 1 (0 / 1 / 0) | 44 | 8,848 | 47 | 30 | 0.883 |
| 0.95 | 0 | 14 | 8,879 | 48 | 31 | 0.886 |

- Kill fires (caught < 18 at every setting), and no setting passes. FP stays at 2, within `fp_max`.
- **The model false negatives look like non-headings in every stored field.** The weaker model,
  given only typography, text shape, neighbours and the ODL tag, catches 1 of 33. These errors are
  not a VLM quirk that a cheap different-input model can outvote. Whatever separates them is not in
  the stored card fields.
- **What the stored fields lack:** the image, the line's style runs (`first_line_runs` is not
  stored), and sibling context such as the table row or column.
- This narrows the open levers to those that change the input:
  - page or sibling context;
  - per-run style from a fixed extraction;
  - a decorrelated *image* view, such as a crop.
- It argues against spending GPU time on another same-input ensemble member.
- The linear-probe test over the VLM's hidden states is still open. It asks a different question:
  whether the VLM's *own* features separate these cards.

## 4. Blind re-judge of the 48 errors and 92 comparators (registered in d2e62aa1)

**Mechanics:**
- 140 cards on 63 page sheets in 11 chunks, judged under the frozen protocol (PROTOCOL-sheets sha c1b05cf5104d).
- The seats agreed on 131 cards. The other 9 got 3 blind Opus-high tie-break runs each.
- Every run's model was checked from its transcript: 22 seat runs on claude-opus-5-5 / claude-fable-5-1, 27 tie-break runs on claude-opus-5-5. Every seat file ended with its `done` line and the right count.
- Runs went through the plain Agent tool, not a Workflow; this was disclosed in the registration. With no output schema, each tie-break returned a single JSON object.
- **Cost (deduplicated, cache reads ×0.1): 3.1M** — seats 1.0M, tie-breaks 2.15M (239k per tie-broken card). The estimate was 5.4M; only 9 cards were tie-broken, against the 21 expected.

**Read (registered):**

| | flipped | rate |
|---|---:|---:|
| errors (new label agrees with the combination) | 8 of 48 | 16.7 % |
| comparators (new label disagrees with the combination) | 1 of 92 | 1.1 % |

Fisher exact, two-sided: **p = 0.0008**. Panel noise is concentrated on the errors.
- **By the old resolution:** 6 of the 17 errors settled by tie-break flipped, against 2 of the 31 settled by seat agreement.
- **By mechanism:**
  - 5 of the 13 rule-decided errors flipped. 4 of the 5 are c8-0319's per-page title repeated on 18 pages, where the old panel had already split (4 of 19 H).
  - 3 of the 35 model errors flipped: one map title, one scan fragment, one false positive.
- **Registered estimate:** 48 − 8 = **40 genuine errors**, 8 decided by rules and 32 by the model. The bar is still about 31, so the combination would still fail with every flip granted.

**As registered:**
- No label file changes and no gate number is re-stated. A correction would need the same re-judge over every decided card, because a 1.1 % comparator flip rate scaled to 8,845 cards is not small. The comparators are matched to the error documents, though, so that rate must not be extrapolated.

**Instrument note:** on the c8-0325 page-0 sheet, tag 4 is drawn under tag 5. One tie-break run reported this and inferred the box from its outline. The card (c8-0325:58) did not flip either way. `page_sheets.py` should offset colliding tags; that belongs to the other chat's tooling.

**What it means:**
- Label noise is real and sits where the panel was already contested, especially on rule-decided repeated titles.
- It accounts for about 8 of the 17-error gap, not the whole of it.
- The 32 model errors that remain stand on labels that re-judge cleanly.
