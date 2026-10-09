# Registration: a CPU-only second opinion over the combination's decided cards (2026-10-09)

Written and committed before any out-of-fold prediction is read. No MLX run, no judging, cohort 9
and the shadows untouched. Development data only (cohort 8, 101 documents).

## Question

The combination (mean p_H of r16-panel and MIX) at its certification threshold t = 0.9940428477888315
decides 8,893 cards with 48 errors; the S1 entry bar is 31 (0.35 %). Its errors are confident
(p_H < 0.012 on both adapters), so no threshold over its own score removes them. Two adapters on one
base, prompt and image make correlated errors. **Does a model that sees a different input, stored
typography and text shape only, disagree with the combination on its errors more than on its correct
cards, by enough to pass the bar inside the coverage floor?**

## Instrument

- Cards: `out/suggest/cohort8-combined-panel-mix/*/sidecar.json`, the 101 development documents
  (c8-0033, c8-0034, c8-0072 dropped, as in `cert_fit.py`). Decided = `score >= t`.
- Labels: the five `LABELS` files of `out/r15/tools/cert_fit.py`, later files override earlier.
  For the gate read, a card's truth is `label.heading` exactly as `cert_fit.py` reads it (Unsure
  counts as not-H), so the baseline reproduces. Unsure rows are left out of the second opinion's
  *training* only.
- Features: `out/suggest/cohort8-combined-panel-mix/all-cards.jsonl`. Per card: `font_pt`,
  `body_font_pt`, their ratio, the card's font percentile within its document; `weight`;
  `existing_tag` (the ODL auto-tagger's tag, available to the product at inference); ancestor flags
  (in L, in LI, in Table, in TD/TR) and ancestor depth; `in_table_box`, `repeats_on_pages`,
  `margin_band`, `after_inline_label`; box width, height, and the card's rank by y0 and x0 within its
  page; text length, word count, caps share, digit share, enumerator class (`runin_probe3.enum`),
  trailing colon, trailing period; the same text-shape features for `prev` and `next`. No image, no
  model output, no label-derived field.
- Model: scikit-learn `HistGradientBoostingClassifier(random_state=20261009)`, defaults otherwise,
  categorical features from dtype. No tuning.
- Folds: `GroupKFold(5)` grouped by host (the URL host in `out/cohort8/refetch-manifest.json`).
  Every card gets an out-of-fold p_H from a model that saw none of its host's documents.

## Read

For c in {0.5, 0.8, 0.95}: veto a decided card when the second opinion disagrees with confidence ≥ c
(the combination says H and OOF p_H ≤ 1 − c, or it says not-H and OOF p_H ≥ c). Vetoed cards become
undecided. Report per c: errors caught (of 48, split model FN / rule FN / FP), correct cards lost, new
decided n', new errors, `int(0.0035 n')`, coverage n' / all sidecar cards, FP against `fp_max` of
decided negatives, and documents with an error.

- **Success:** at one or more c, errors ≤ `int(0.0035 n')`, coverage ≥ 0.857 and FP ≤ `fp_max`.
- **Kill:** caught < 18 at every c, or the coverage floor breaks before the bar is met.
- **Instrument checks, before the read:** (1) the baseline reproduces 8,893 decided and 48 errors;
  (2) a control with labels shuffled inside each training fold gives OOF AUC in [0.45, 0.55]. If
  either fails, nothing is read.
- Also reported, not gating: OOF AUC and accuracy of the second opinion on all labelled cards.

## Disclosure

Three veto settings are a small multiple look on development data that has been read many times.
A success here is a reason to build the second opinion and test it on fresh documents (a shadow),
never a pass claim, and never a reason to open cohort 9. A model trained out of fold on ~80 cohort-8
documents is not the model a product would ship; that one would be trained on more documents.
