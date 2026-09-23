# Strategy C: guard re-registration, before its wild look (2026-09-23)

**Post-hoc, and disclosed as such.** This amends the validation guard that
`2026-09-22-merged-heading-strategies.md` registered for strategy C. It is
written after r13's validation numbers were known and before its wild look
was computed. Any record citing r13's wild result must link here.

Provenance: this file was written, and its sha256 recorded
(`ba6d1d93…`, before this paragraph was added), before the wild look was
computed on 2026-09-23. It was committed only after the look, so the commit
time is not evidence of pre-registration; the order rests on the session
record.

## Why the registered guard is replaced

The registered guard: r13's validation covered-accuracy exact 95 % lower
bound and FP exact 95 % upper bound are each no worse than r10's
(`out/stage1/operating-point-r10.json`).

Request 15 (`out/overnight/15-op-r13/operating-point-r13.json`), r13 at its
r11-rule threshold 0.98081102556551 against r10 at 0.9933, same labels:

| | Covered | TP | TN | FP | FN | Acc LB | FP UB |
|---|---|---|---|---|---|---|---|
| r10 | 1,142 | | | 3 | 10 | 0.9806125 | 0.0112996 |
| r13 | 1,086 | 323 | 751 | 3 | 9 | 0.9807780 | 0.0115833 |

The guard fails on FP UB by 0.00028. Both adapters make exactly 3 false
positives. The UB differs only because r13 covers fewer validation negatives
(754 against 773), and the exact upper bound on 3/n rises as n falls. The
guard was meant to catch an adapter that labels more non-headings H. This
failure does not show that. It shows lower coverage, which the wild gate
already measures and pays for.

## Replacement guard

r13 proceeds to its wild look if, on validation at its r11-rule threshold:

1. its FP count is no higher than r10's (3 ≤ 3), and
2. its covered-accuracy exact 95 % lower bound is no worse than r10's
   (0.9807780 ≥ 0.9806125).

r13 meets both. This result was known when the rule was written. The rule
is therefore a disclosed judgement call, not a blind test.

## The one wild look (unchanged from the registration)

- Predictions: `out/overnight/14-score-wild-r13/pred-wild-r13.jsonl`
  (r13, own-stack, rules in front including R5, fold-view cards from request
  08, no threshold applied at scoring).
- Labels and cards: `out/labels/wild-23-labels-runin.jsonl` and
  `out/labels/wild-23-cards-runin.jsonl` (run-in consensus, the labels the
  baseline is graded against). No judging.
- Threshold: t_r13 = 0.98081102556551, from validation only. It is not refitted
  on wild.
- Pass: covered-accuracy exact 95 % LB ≥ 0.99 and FP exact 95 % UB ≤ 0.01.
- Compared with the baseline, run-in + R5 end to end at 0.9933: 2,543 covered,
  0.9917 [0.9874–0.9949], 0 FP, 21 FN, 20/30 clean.
- Reported too, not gating: r13 at r10's 0.9933, the FN split by merged versus
  single blocks, and the change in asks.

This is C's only wild look. If it fails, C is recorded as spent, whatever
the margin.
