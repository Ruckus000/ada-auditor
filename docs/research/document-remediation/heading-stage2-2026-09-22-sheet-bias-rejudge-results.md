# Page-sheet bias re-judge: result (2026-09-22)

Registration: `docs/superpowers/plans/2026-09-22-wild-sheet-bias-rejudge-registration.md`,
approved with amendments and committed before any judging (00362bd). Counts only.

## What ran

- Population: the 566 `opus-kimi-consensus` rows of
  `out/labels/s2wild-r3-consensus-final.jsonl`, of which **565** are covered at
  t = 0.9933 on the end-to-end run-in + R5 predictions (the uncovered one is
  c3-0507:27). Materialized to `out/labels/s2wild-r3-sheet-round-ids.json`; the
  registered stop-unless-565 check passed. 5 of the 565 are bodies the run-in
  split later shortened; they were judged on their round-3 card as registered.
- Judge: Claude Opus-quick, card by card, `labels/judge/PROTOCOL.md`, the
  marked-408 per-card images from `out/suggest/wild-r3`. Seeded order 20260922,
  10 chunks (9 × 62 + 7), one fresh run per chunk. All 10 ended with their
  `done` line and the right count; nothing was discarded.
- Scoring: `labels/judge/rejudge_verdict.py`. The verdict reads only the two
  label sets; predictions are opened only afterwards, for the reported f9.

## Verdict (model-blind, as registered)

| | Count |
|---|---|
| Re-judged | 565 |
| Unsure (sheet label kept, as registered) | 5 |
| g: sheet H → re-judge non-H | 2 |
| r: sheet non-H → re-judge H | 1 |
| g − r | 1 |

**REFUTED** (|g − r| ≤ 2). The sheet labels stand. The page-sheet bias
question is closed: no measurable lean toward H.

Reported, not used for the verdict:

- Heading-bit agreement with the sheet labels: **557 / 560 = 0.9946**; type
  agreement 482 / 560 = 0.8607. Headings among the 560: 25 under the sheet
  labels, 24 under the re-judge.
- **f9 = 2** of the 9 covered FN on sheet-round rows re-judge to non-H.

## Consequence

The 9 sheet-round misses are recorded as real misses; their excess rate over
the rest of the wild set (1.6% vs 0.6%) is a property of those documents, not
of the labelling method. No label is replaced and the gate is unchanged:
run-in + R5, end to end, 2,543 covered, 0.9917 [0.9874–0.9949], 0 FP, 21 FN,
**NOT MET** (15 errors allowed at this n).

The re-judge file `out/labels/s2wild-r3-cardrejudge-folds.jsonl` (label source
`opus-quick-card-rejudge`) is kept as an appendix record on the data branch and
is not folded.

With this result every registered lever of Stage 2 on the label and
card-building side is spent: line-based split, same-line style split,
enumerator convention (R5, adopted), and page-sheet label bias. The remaining
21 covered misses are model behaviour.
