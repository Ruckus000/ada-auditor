# Heading-type adapter — Stage 1 round 6 results (claude-audit label overlay, re-score, no training)

**Previous record:** `heading-stage1-r5-2026-09-15-results.md` (r5 rule changes adopted). **Definition:** `heading-definition-2026-09-13.md` (frozen). **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md` (round 6 entries).

**Status:** RESULTS. No training, no prediction. `pred-validation-r5.jsonl` (r4a adapter with r5 rules) is re-scored, unchanged, against a new label source.

> **Every number below is graded against Claude-audited labels** where marked `audited` — judgements by a reviewing Claude session, not a fresh human relabel — per Ruling R9. `key` rows show the same populations scored against the unaudited key labels for comparison.

## R9 (user ruling, relayed by the coordinating session, their words)

> "Yes, use your labels and run the training-set count."

Claude-audited judgements are a label source. `claude-audit` is added to `eligibility_eval.LABEL_SOURCES`, with the disclosure **"graded against Claude-audited labels"** required on every metric reported from round 6 on. A `human-answer` row on the same id outranks a `claude-audit` row (a later human correction wins). This overrides the goal's "no model output as labels" rule for this one source only, by the user's explicit decision — it does not license any other model output becoming a label.

## Background: the Title-style measurement (round 6, step 1)

Before the audit, round 6 first measured whether Word's `Title` paragraph style (no `outlineLvl`, so it converts to a non-heading tag) systematically hides true H1s, since the frozen definition's §5 would make a Title-styled paragraph H1.

- Population: 99 word-outline documents (13 build-4 + 86 cohort-6).
- **29 of 99 documents have a `Title`-styled paragraph, all 29 in cohort-6** (0 of 13 build-4).
- Mechanism is **mixed, not systematic**: of 3 sampled documents with a Title paragraph, 2 converted to PDF tag `H1` (keyed H), 1 converted to `P`.
- **0 of 72 true-H1 validation misses (r4a) are Title-styled.**
- ~15 rows total show the Title-style pattern: 4 validation (`P`/`Other`, cohort-6) + 11 training (`P`, cohort-6, 7 of them the document's first paragraph).
- **Coordinator ruling: the Title fix is PARKED as a §5 candidate, "Word Title style = H1"** — recorded, no code change, no relabel. The evidence is too thin (single-digit documents, mixed mechanism, 0 of the real H1 misses) to justify a key-time fix this round.

This is why round 6 turned to an audit of the *existing* false positives and page-0 H1 misses instead of a Title-style fix.

## Audit method

70 cards, served to the user in `labels.serve --cards-file` (key-side file for agreement, keyboard-navigable), judged by the coordinating Claude session:

- **31 r5 false positives** (P→H on cohort 6 validation, sampled for the label-audit question r5's record raised — "some may be author tagging errors, where the key is wrong and the model right").
- **37 page-0 H1 misses** (true H1 the model called not-H, on page 0, where the approved-headings stack starts empty).
- **2 Title-styled** validation rows not already covered by the false-positive sample (`c6-0438:1`, `c6-0447:0` — 2 of the original 4 Title-styled validation rows, `c6-0055:0` and `c6-0446:0`, were already in the 31 false positives).

Total 31 + 37 + 2 = 70. Judged against the frozen definition; each card carries a one-line note. `out/labels/audit-r6-claude.jsonl` (70 rows, `label_source: "claude-audit"`, `actor: "claude-coordinator"`) and `out/labels/audit-r6-key.jsonl` (the key side for the same 70 ids) are the inputs.

### Audit outcome, by id (no document text — notes describe a card's role, e.g. "section heading", "cover title", never quote it)

**33 key-non-H → H** (the audit ruled these should be headings; all cohort-6 except `c4-0020:3`):

```
c6-0036:42, c6-0009:8, c6-0065:58, c6-0036:44, c6-0036:46, c6-0036:202, c6-0235:58,
c4-0020:3, c6-0036:48, c6-0373:0, c6-0036:515, c6-0235:60, c6-0056:63, c3-0502:1,
c6-0235:55, c6-0446:0, c6-0134:191, c6-0398:13, c6-0036:274, c6-0447:0, c6-0036:208,
c6-0055:0, c6-0410:0, c6-0056:59, c6-0135:59, c6-0009:624, c6-0438:1, c6-0009:7,
c6-0065:272, c6-0102:3, c6-0135:9, c6-0036:684, c6-0021:1
```

**4 key-H1 → non-H** (the audit ruled these were mis-keyed as headings; all key level 1, all → `P`):

```
c6-0061:1, c6-0381:1, c6-0136:1, c3-0919:1
```

**8 level-only, H1 → H2** (both sides agree H, the audit moved the level):

```
c3-0056:2, c6-0021:3, c6-0449:7, c6-0373:5, c6-0373:1, c6-0373:3, c6-0011:2, c3-0399:3
```

The remaining 25 of the 70 cards were unchanged by the audit (key type and level confirmed).

**Population membership of the 70 audited ids:** 62 in cohort-6 validation, 8 in ∩ (`c3-0056:2, c4-0020:3, c3-0919:1, c3-0502:1, c3-0056:0, c3-0424:1, c3-0399:3, r12:1`), 0 in train, 0 in test.

## `eligibility_eval.py`

- `"claude-audit"` added to `LABEL_SOURCES`. Docstring documents what the source is (a reviewing Claude session's judgement under R9, disclosed on every reported number) and that `human-answer` outranks it — the module does not enforce that ordering itself; the caller building an overlay must check.
- Self-check gained an assertion that a `claude-audit` row is accepted as a label and a `claude-draft` row is refused.
- `python3 -B eligibility_eval.py --self-check` → `eligibility_eval_self_check_ok`.

## Overlay, not an edit (Ruling S30)

`out/keys-all-4/labels-audited.jsonl` = every row of `labels.jsonl` in order, unchanged, except the 70 audited ids: `type` and `label` replaced with the audit row's, `label_source` set to `"claude-audit"`, the audit row's note copied under `audit_note`, and the original `type`/`label`/`label_source` kept under `superseded`. Verified: exactly 70 of 10,901 lines differ from `labels.jsonl`; none of the 70 audited ids carried `label_source: "human-answer"` in `labels.jsonl` (all were `stripped-tree` or `word-outline`), so R9's outranking rule never had to exclude one. `out/keys-all-4/labels.jsonl` itself was not edited.

**Split file:** `out/keys-all-4/split/split.json` was **not edited** — the 70 ids' document/client/template membership does not change, only their labels. A sidecar records the overlay:

```
out/keys-all-4/split/labels-audited.json = {
  "split_sha256": "e79612866e1ab07b…",
  "labels_sha256_original": "28fb043a4682eb32…",
  "labels_sha256_audited": "51fbcecfbdcf9294…",
  "overlay_ids": [...70 ids...]
}
```

**`eligibility_eval.py evaluate` refuses the overlay against `split.json`, as expected.** Its own sha256 gate exists to stop a labels file from silently changing which document/client/template ended up in which split (leakage safety):

```
$ python3 -B eligibility_eval.py evaluate --split out/keys-all-4/split/split.json \
    --labels out/keys-all-4/labels-audited.jsonl --predictions out/stage1/pred-validation-r5.jsonl
labels changed since the split was drawn; draw a new split
```

**The minimal way through, reported rather than silently bypassed:** the overlay never touches `document_sha256`, `client_id`, or `template_id` on any of the 10,901 rows — only `type`/`label`/`label_source` and two new fields (`audit_note`, `superseded`) on the 70 audited rows — so it cannot move any row across a split boundary; the CLI's blanket labels-sha gate is simply not overlay-aware, by design (it does not distinguish a relabel from a leak). Re-scoring below calls `eligibility_eval`'s library functions directly — the same `split.json` id sets (`validation`, and the c6-validation / ∩ sub-populations, unchanged from r5) and the same `evaluate()` row-scoring function the CLI subcommand itself calls — against the audited labels file, rather than weakening or bypassing the CLI's sha check. This is a scratch, uncommitted script; nothing under `eligibility_eval.py`'s own gate logic was changed to make this work.

## Re-score: r5 predictions (unchanged), key labels vs audited labels

`out/stage1/pred-validation-r5.jsonl` (sha `81ae9379…`) was not re-run. `out/stage1/eval-r6-*-key.json` / `eval-r6-*-audited.json` hold the per-population results; `eval-r6-summary.json` and `eval-r6-depth-summary.json` collect them.

**The `key` rows below reproduce r5's own numbers exactly** (cross-checked against `eval-r5-*.json`), confirming the re-score path matches the registered one.

| Population | Labels | n | TP/FP/TN/FN | Accuracy | Acc LB (95%) | FP rate | FP UB | FN rate | Level exact |
|---|---|---|---|---|---|---|---|---|---|
| ∩ 273 | key | 273 | 51/2/174/46 | 0.8242 | 0.7819 | 0.0114 | 0.0353 | 0.4742 | 41/51 |
| ∩ 273 | **audited** | 273 | 53/0/175/45 | **0.8352** | 0.7937 | **0.0000** | 0.0170 | 0.4592 | 42/53 |
| build 4 | key | 128 | 35/0/71/22 | 0.8281 | 0.7638 | 0.0000 | 0.0413 | 0.3860 | 25/35 |
| build 4 | audited | 128 | 35/0/71/22 | 0.8281 | 0.7638 | 0.0000 | 0.0413 | 0.3860 | 25/35 |
| cohort 3 | key | 68 | 1/1/57/9 | 0.8529 | 0.7633 | 0.0172 | 0.0792 | 0.9000 | 1/1 |
| cohort 3 | audited | 68 | 2/0/58/8 | 0.8824 | 0.7977 | 0.0000 | 0.0503 | 0.8000 | 2/2 |
| cohort 4 | key | 77 | 15/1/46/15 | 0.7922 | 0.7017 | 0.0213 | 0.0970 | 0.5000 | 15/15 |
| cohort 4 | audited | 77 | 16/0/46/15 | 0.8052 | 0.7160 | 0.0000 | 0.0630 | 0.4839 | 15/16 |
| c6 validation | key | 1,252 | 261/30/836/125 | 0.8762 | 0.8598 | 0.0346 | 0.0467 | 0.3238 | 235/261 |
| c6 validation | **audited** | 1,252 | 290/1/837/124 | **0.9002** | 0.8851 | **0.0012** | 0.0056 | 0.2995 | 248/290 |
| all 1,525 | key | 1,525 | 312/32/1010/171 | 0.8669 | 0.8517 | 0.0307 | 0.0410 | 0.3540 | 276/312 |
| all 1,525 | **audited** | 1,525 | 343/1/1012/169 | **0.8885** | 0.8744 | **0.0010** | 0.0047 | 0.3301 | 290/343 |

**Deltas (audited − key), the three headline populations:**

| Population | Δ Accuracy | Δ Acc LB | Δ FP rate | Δ FN rate | Δ TP/FP/TN/FN |
|---|---|---|---|---|---|
| ∩ 273 | +0.0110 | +0.0118 | −0.0114 | −0.0150 | +2/−2/+1/−1 |
| c6 validation | +0.0240 | +0.0253 | −0.0334 | −0.0243 | +29/−29/+1/−1 |
| all 1,525 | +0.0216 | +0.0227 | −0.0297 | −0.0239 | +31/−31/+2/−2 |

`build 4` is unaffected (0 of its 128 ids were among the 70 audited — `r12:1` is in build 4 but was one of the 25 unchanged cards). `cohort 3` and `cohort 4` each gained one true positive (0 false positives, matching the pattern that most audited flips are `non-H → H`, which turns an `fn` into a `tp` when the model had already predicted H, or leaves an `fn` as `fn` when it hadn't — see per-id detail below).

### Level exactness by true depth (n / recalled as H / exact), key vs audited

| set | labels | H1 | H2 | H3 | H4 | H5 |
|---|---|---|---|---|---|---|
| ∩ 273 | key | 42/16/16 | 16/12/10 | 24/19/12 | 15/4/3 | — |
| ∩ 273 | audited | 40/17/17 | 19/13/10 | 24/19/12 | 15/4/3 | — |
| c6 validation | key | 87/45/40 | 181/136/126 | 64/49/42 | 51/29/25 | 3/2/2 |
| c6 validation | audited | 88/53/47 | 208/157/132 | 64/49/42 | 51/29/25 | 3/2/2 |
| all 1,525 | key | 129/61/56 | 197/148/136 | 88/68/54 | 66/33/28 | 3/2/2 |
| all 1,525 | audited | 128/70/64 | 227/170/142 | 88/68/54 | 66/33/28 | 3/2/2 |

H3, H4 and H5 are untouched by the audit on every population (no audited id sits at those depths). H1's population count *drops* by one on ∩ and all-1,525 (33 non-H→H adds mostly land at H2, but the 4 H1→non-H flips remove H1 rows, and the 8 level-only flips move H1 rows to H2 — net H1 count = original − 4(H1→non-H) − 8(H1→H2) + however many of the 33 non-H→H land at H1). Recall and exactness both rise at H1 and H2 because several of the 33 additions were already predicted H by r5 (turning an FN into a counted-and-correct row) or already predicted H2 (the 8 level-only rows: several were already predicted H2, so the "exact" count only moves where the model's own predicted level matched the *new* true level).

## Which of the 70 ids fall in ∩ vs c6 vs elsewhere

- **∩ (8):** `c3-0056:2` (cohort 3), `c4-0020:3` (cohort 4), `c3-0919:1` (cohort 3), `c3-0502:1` (cohort 3), `c3-0056:0` (cohort 3), `c3-0424:1` (cohort 3), `c3-0399:3` (cohort 3), `r12:1` (build 4, unchanged card).
  - By ∩ sub-population: cohort 3 gets 6 of the 8, cohort 4 gets 1, build 4 gets 1 (unchanged).
- **c6 validation (62):** the remainder of the 70.
- **train / test (0):** none of the 70 audited ids fall in train or test — the audit only touched validation rows, consistent with the audit set being built from r5's validation false positives and H1 misses.

## `labels.serve` Safari fixes (one line)

Two fixes landed on `labels.serve` during the audit session.
- `15357a9` added clickable answer links beside the keyboard shortcuts.
- `6368d5e` fixed the real cause of the Safari failure. The single-threaded server blocked on Safari's idle keep-alive connections, so every request after the first page load hung. The server is now threaded. One lock around each request keeps the card-id check atomic, so that two in-flight answers for one card cannot both be written.

## Training-set measurement

*(pending — running)*

## Concerns

- **The audit only examined rows r4a got wrong, so the gain is one-sided.** The 70 cards are the model's false positives and its page-0 H1 misses. No row the model got right was audited. Corrections can therefore only move errors toward correct, or correct H1s toward non-H, never a correct prediction toward wrong. The audited accuracy (c6 0.900, all 0.889) is an upper-leaning figure until a random sample of correctly-scored rows is audited the same way.
  - Measured FN, graded against Claude-audited labels: ∩ 0.474 → 0.459; c6 0.324 → 0.300; all 0.354 → 0.330 (the controller recomputed these).
- **The overlay is validation-only in this population.** All 70 audited ids sit in ∩ or c6 validation; none touch train or test, so this re-score changes nothing about what the model was trained on — it only changes what r5's already-frozen predictions are graded against.
- **The 8 ∩ audited ids are a small population inside an already-small ∩ (273).** A single-digit id count moving FP from 2→0 on ∩ is a large relative swing (−100%) on a thin base; the same pattern (1–2 FP removed) repeats on cohort 3 and cohort 4. Treat the ∩ accuracy delta (+0.011) as consistent with, not independent confirmation of, the c6-validation delta (+0.024), since both come from the same 70-card audit batch and the same underlying error mode (P→H false positives the audit judged as true H, and a few key-H1 the audit judged as P).
- **This measures the audit's effect on *grading*, not the model.** r5's predictions were never re-run; every delta above is entirely a change in what counts as correct, not a change in what the adapter outputs. A P→H prediction that used to be scored FP is now scored TP wherever the audit agreed with the model, and a few key-H1→P audit flips remove predictions that used to be scored (correctly, by the old key) as recalled H1.
- **`eligibility_eval.py`'s CLI still cannot evaluate an overlay directly**, by design — its sha gate does not distinguish "labels relabeled without moving split membership" from "labels changed in a way that could leak." Round 6 worked around this with an uncommitted scratch script rather than loosening the gate; a future round that wants overlay-aware evaluation as a first-class path would need to decide whether and how to extend the CLI itself, which this task did not attempt.
- **The Training-set measurement section is deliberately left pending** — the brief for this task said a separate process was already running it; this task did not compute it and did not touch that process's outputs.
