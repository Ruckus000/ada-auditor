# Re-judge registration: page-sheet label bias (2026-09-22)

Status: REGISTERED and APPROVED with two amendments (user, 2026-09-22),
committed before any re-judging. Amendments: (1) the verdict is model-blind:
it reads only the judge-side flip asymmetry over all 565 cards; f9 is
reported, never a condition. (2) The label source is registered in code in
the same commit as this amendment, before the run.

Why the stakes changed: at n = 2,545, up to 15 covered errors pass
(12 errors -> lower bound 0.9918; 15 -> 0.9903; 16 -> 0.9898). The run-in +
R5 view has 21, so replacing labels could by itself decide the gate. That is
why the adoption decision must not depend on whether the new labels help the
model.

## Question

The page-sheet round (label source `opus-kimi-consensus`, seats Claude
Opus-medium + Kimi K3 on sheets, Claude Opus-quick per-card tie-break) may
carry a bias toward H: a judge who sees the whole page sheet may call a card
"heading" more readily than a judge who sees the card alone. In
`out/labels/s2wild-r3-consensus-final.jsonl`, 566 rows carry that label
source; 565 of them are covered at t = 0.9933 in the run-in + R5 fold (the
one uncovered row is c3-0507:27).

The numbers that keep the question open (run-in + R5, t = 0.9933,
recorded in heading-stage2-2026-09-22-rule-r5-wild-gate.md):

- 21 remaining misses (FN); 9 of them sit on the 565 covered sheet rows.
- FN rate on covered sheet rows: 9 / 565 = 1.6%.
- FN rate elsewhere: 12 / 1,980 = 0.6%.
- If sheet rows behaved like the rest, expected FN on them ~= 3.4;
  the excess over expectation is ~= 5.6 of the 9.

If sheet judging inflates H labels, some of those 9 FN are spurious
(card really P, sheet label H), and the gate deficit is partly a
labelling artifact, not model error.

## Population (fixed)

The 565 covered rows with `label_source == "opus-kimi-consensus"` in
`out/labels/s2wild-r3-consensus-final.jsonl` (the round-3 file, pre-run-in,
so the 53 run-in-round judgements are never included).
`out/labels/s2wild-r3-remaining-ids.json` does not exist on the data branch
at 3184183, so before any judging a script materializes the id list to a NEW
data-branch file `out/labels/s2wild-r3-sheet-round-ids.json`; the run stops
unless the list holds exactly 565 ids. Every one of the 565 is re-judged.
Never only the model's errors, never only the 9 FN rows, never a sample.

## Judge and method

- Judge: Claude Opus-quick, card by card — the same per-card protocol
  used for the original wild judging and for the sheet round's
  tie-breaks. NOT page sheets. The judge sees only the card, never
  the sheet label, never model output, never which rows are the 9 FN.
- Presentation order: randomized with seed 20260922, recorded in the
  output; chunks of 62 cards, the per-card protocol `labels/judge/PROTOCOL.md`,
  one fresh judge run per chunk, images are the marked-408 per-card images
  from `out/suggest/wild-r3/<doc>/cards.jsonl` (the ones the original
  four-judge and tie-break rounds used).
- A run that does not end with its `done` line, or whose line count differs
  from its chunk, is discarded in full and re-run.
- Calibration: Opus-quick's measured per-card accuracy is 0.998, so
  over 565 cards the expected spurious-disagreement count is ~= 1.
  All decision thresholds below are set well above that noise floor.
- Blinding: this plan names the hypothesis and thresholds in advance;
  the judging run cannot see this file's expectations.

## Output files and label handling (fixed)

- New labels are written to a NEW data-branch file:
  `out/labels/s2wild-r3-cardrejudge-folds.jsonl`.
  The published consensus files are never edited.
- Label source value for the new file: `opus-quick-card-rejudge`, actor
  `opus-quick-card`, one judge (agree 1 of 1). Registered now, before the
  run, in `eligibility_eval.LABEL_SOURCES`, `labels/fold_wild.SOURCES` and
  `labels/eval_wild.LABEL_SOURCES`/`DISCLOSURES`, with a fold test.
- An `Unsure` re-judge answer keeps the sheet label for that row; the count
  of Unsure rows is reported.
- Flips are counted per row against the sheet label. Let:
  - f9 = of the 9 sheet-round FN rows, how many re-judge to non-H;
  - g = of all 565 rows, H under sheet -> non-H under re-judge;
  - r = of all 565 rows, non-H under sheet -> H under re-judge.

## Verdict criteria (fixed)

Model-blind: g and r are computed over all 565 rows from the two label
sets alone; no model output is read to reach the verdict.

- Bias CONFIRMED: g - r >= 4.
  Action: the re-judge labels replace the sheet labels for all 565 rows
  (never a subset); the run-in + R5 gate is recomputed on the end-to-end
  predictions (wild-v5-r5 for c3-0094/c3-0128, wild-v4-runin for the other
  fired documents) and recorded with both label files named; replaced rows
  are disclosed by count (never by content).
- Bias REFUTED: |g - r| <= 2.
  Action: sheet labels stand; the 9-FN excess is recorded as real
  misses, the sheet-bias question is closed, no gate change.
- INCONCLUSIVE: g - r = 3, or r - g >= 3 (a bias toward non-H would be a
  different question).
  Action: sheet labels stand; the re-judge file is kept as an appendix
  record; the excess stays an open question in the run-in record;
  no gate change.

Reported with every verdict, never used to reach it: f9 (of the 9
sheet-round FN rows, how many re-judge to non-H), and the gate numbers
under the re-judge labels.

## Disclosure

Any record that consumes replaced labels must name both label files,
both label sources, the verdict reached, and the flip counts
(f9, g, r). Counts only, as everywhere in this work.

## Explicit non-goals

- No model run, no threshold move, no rule change follows from this
  re-judge by itself. It answers one labelling question.
- The judge does not see this document.
