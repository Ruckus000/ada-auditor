# Addendum 2026-09-21: wild gate finished on completed labels (NOT MET)

Addendum to `heading-stage2-2026-09-18-results.md`. Drafted by the Kimi K3 implementing session; counts re-scored independently by the coordinator from the prediction and label files (2,516 covered, 32 errors, 17/17 tests) before commit.

**Disclosure for every number below: graded against consensus labels, judges:
Claude ×4 (rounds 1–3 original rows) and, for the 566 round-3 completions and
the 20 convention-conflict re-judgements, Claude Opus-medium (seat 1, page
sheets), Kimi K3 (seat 2, page sheets), Claude Opus-quick (per-card
tie-break).** Label source `opus-kimi-consensus`, actor
`consensus-2seat-tiebreak`, registered into `eligibility_eval.LABEL_SOURCES`,
`labels/fold_wild.py` and `labels/eval_wild.py` before any consensus was
written (tests: 17/17 in test_fold_wild + test_eval_wild).

## Judge calibration and seating

- Kimi K3 on page sheets, first method (dense PNG sheets, 418 boxes on 31
  pages): heading-bit agreement **0.9409** (239/254) vs the 4-judge rows —
  below 0.973, superseded method, recorded and stopped.
- Re-registered method (greyscale JPEG q80, ≤12 boxes per sheet): Kimi K3
  **0.9810** (155/158); Claude Opus-medium on the same 31 sheets / 320 boxes:
  **0.9810** (155/158). Pair check on the shared 158: the two agree on 152 and
  all 152 match consensus; all 6 single-judge errors sit in the 6
  disagreements (0/152 agreed-pair errors, 95% UB ≈ 2% — supportive, not
  proof).
- **Post-hoc re-registration, disclosed as post-hoc:** Opus-medium's 0.9810
  fails the ≥ 0.99 full-seat bar as registered; the user re-registered the
  seating AFTER seeing that result — seat 1 = Opus-medium on sheets, seat 2 =
  Kimi K3 on sheets (0.973–0.99 tier), tie-break = Opus-quick per-card (0.998)
  on heading-bit disagreements only. The tie-break being per-card while the
  seats judged sheets is part of the registration.
- Production judging: 586 cards (566 covered round-3 + 20 conflict) on 90
  sheets / 15 chunks per seat; seat disagreement 18/586 (3.1%), all 18
  tie-broken, 17 resolving with seat 1, 1 with seat 2 (c3-0507:144).

## Consensus and merge

- Round-3 completion: 566/566 consensus — **548 two-of-two, 18 two-of-three,
  0 no-consensus**. Type mix: P 253, Other 142, Lbl 89, H 25, Artifact 23,
  TH 18, Caption 16. Merged into NEW `out/labels/s2wild-r3-consensus-final.jsonl`
  (1,720 rows: the 1,040 previously labelled rows byte-identical, 566 filled,
  114 uncovered cards stay null by design). Provenance file untouched.
- Conflict cards: 20/20 consensus `Lbl`, all two-of-two. Patched by id into NEW
  `out/labels/s2wild-consensus-v2-final.jsonl` (1,226 rows byte-identical, 20
  replaced; the round-2 26-card patch preserved by patching the current v2
  file, not the round-1 base). Provenance untouched; `v2_patch.py` takes
  optional path arguments, defaults unchanged.

## Evaluation (adapter-r10, registered threshold 0.9933, test split never touched)

Split: `out/keys-all-4-wild-final/split` built on the round-2 split with
`--keep` (train 7,051 / validation 4,364 / test 2,325; new ids assigned to
validation; no kept id moved).

| View at t = 0.9933 | Covered | Coverage | Accuracy [95% exact] | FP (UB) | FN | Docs clean |
|---|---|---|---|---|---|---|
| Round 3 alone | 1,418 | 0.883 | 0.9873 [0.9800–0.9925] | 0 (0.0027) | 18 | 13/20 |
| Rounds 2+3 | 2,516 | 0.886 | 0.9873 [0.9821–0.9913] | 7 (0.0060) | 25 | 18/30 |

Abstention as ask-rate: 0.114 combined (0.117 round 3 alone). Round-3 fold:
1,606 kept, 114 excluded (uncovered cards never sent to judges, null by design — not no-consensus); round-2 fold: 1,233 kept, 13 excluded.

All 32 covered errors at 0.9933, by id:
- FP (7, all in round 2, all re-judged enumerator cards the model still calls
  headings — the v2 convention correction moved them here): c3-0094:58,
  c3-0094:60, c3-0128:7, c3-0128:10, c3-0128:181, c3-0128:188, c3-0128:196.
- FN (25): c3-0128:12, c3-0252:53, c3-0489:34, c3-0489:10, c3-0794:1,
  c3-0794:134, c3-0794:138, c3-0178:37, c3-0268:5, c3-0268:72, c3-0299:28,
  c3-0299:69, c3-0299:293, c3-0299:445, c3-0507:109, c3-0507:110,
  c3-0507:475, c3-0507:499, c3-0533:1, c3-0533:2, c3-0533:10, c3-0722:147,
  c3-0722:209, c3-0755:26, c3-0755:27.

## Gate verdict

**NOT MET.** Accuracy lower bound 0.9821 < 0.99 (short by 0.0079). FP upper
bound 0.0060 ≤ 0.01 passes. The shortfall is misses, not false alarms: 25
covered FN against 7 covered FP, and the 7 FP are the convention-corrected
enumerator cards rather than new model behaviour. Per the registered rule for
a shortfall larger than 0.005, no further judging was spent; stop and report.

## Coordinator caveat: where the new misses sit

Of the 25 covered FN, 12 are on the original four-judge rows (about 0.6% of
their covered cards) and 13 are on the 566 sheet-judged completions (2.3%).
All 13 are two-of-two H: both seats agreed, so no tie-break looked at them. In
calibration both sheet judges erred toward H, and the pair check (0/152) only
bounds a shared error rate below about 2%, so a sheet-format bias toward H is
NOT excluded as a partial cause. It is unresolved and deliberately not chased:
re-judging only model-error cards is a label-conditioned selection and could
not change labels, and even with all 13 removed 19 errors remain against the
15 that a 0.99 lower bound allows at n = 2,516. With the registered R5 view
(bare enumerator -> Lbl) the 7 FP vanish and 25 errors remain: still short.

The remaining lever is card building for run-in headings (plan step 5a),
registered on validation first; not started.
