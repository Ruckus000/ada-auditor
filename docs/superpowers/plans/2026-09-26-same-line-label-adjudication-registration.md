# The 58 same-line heading labels: adjudication (registration, 2026-09-26, before the run)

**Question.** The largest error class in the fixed-geometry re-measurement
(`heading-stage2-2026-09-26-cohort8-remeasure-results.md`) is 58 FN where a
heading runs into its body on one physical line. Protocol v2.1 says **"a
heading merged with its first sentence is still `H`"**, a clause written for an
extractor merging a *visually distinct* heading. It also says **"a bold lead-in
ending in a colon followed by a list on the same line is `P`"**. Whether the
first clause reaches a document that marks its headings **not at all** has never
been decided, and 40 of the 58 carry no typographic distinction whatsoever.

This decides whether those 40 are errors before anyone builds a detector for
them. Scoping found a detector would reach at most 21 of the 58, needs
per-glyph x geometry that `Cards.java` does not emit and a box model `Mark.java`
does not have, and rests on a signal already measured as anti-informative
(0 of 338 on validation, 2026-09-22).

**Spent data, not a pass claim.** Cohort 8 was looked at and its labels are
training and validation data in `out/keys-r14-c8`. Any label this changes makes
that fold stale; an r14 rebuild would have to be redone. No model is run and no
threshold moves.

## Population (fixed now)

All **58** run-in-shaped FN — a covered card whose label is `H`, whose
prediction is not-heading, and whose text exceeds 60 characters — taken from
`out/suggest/cohort8-fixed/remeasure.json`. Split by `Cards.first_line_runs`,
the style runs of the block's first physical line:

| Arm | Cards | |
|---|---:|---|
| **Subjects** — one run: no style change in line 1 | **40** | of which 3 carry a colon cue |
| **Controls** — two or more runs: a style change exists | **18** | |

The deviation from the scoping note is deliberate: it counted 37 subjects by
requiring *neither* style nor text cue. Judging all 58 covers the whole class
and lets the 3 colon-only cards be reported separately.

Judges cannot tell the arms apart. The controls exist to show the judges report
a distinguisher when one is measurably there; without that, "none" on a subject
means nothing.

## Procedure

Three independent blind runs per card — **174 runs** — with `heading-judge-high`,
`claude-opus-5-5`, effort high, pinned by exact id, as in the two previous
adjudications.

Each run returns, **in this order**:

1. `distinguisher` — the typographic feature separating the opening phrase of
   the first line from the text following it on that same line (weight, size,
   case, a colon, extra spacing …), or the exact string `none`.
2. `type` and `level` — under protocol v2.1 **as written and unamended**.
3. `rule` — the protocol sentence relied on, quoted.

The observation comes first so the type call is not led by it. A judge is never
told that a card is an error, what the model predicted, which arm the card is
in, or that arms exist.

## Decision rule

**Control validity, checked first.** At least **15 of 18** controls must report
a distinguisher by majority of their three runs. Below that the arm is void,
nothing is concluded about the subjects, and the result is reported as a failed
instrument.

**Per subject, by majority of three runs:**

- **not-`H`** → the original label was wrong. Correct it and recount.
- **`H` with `distinguisher = none`** → the label rests on meaning, not
  appearance. It stands, and the card is out of reach of any card-building rule.
- **`H` with a distinguisher** → contradicts `first_line_runs`. **Stop and
  look**: either the field is missing a signal it should carry, or the judge is
  inferring one. Report; do not fold it in.

A surprise is a reason to stop, not to adjust the rule.

## Reported

1. Controls reporting a distinguisher, out of 18, against the threshold.
2. Subjects by outcome, with the 3 colon-only cards called out separately.
3. Every judge `distinguisher` against that card's `first_line_runs`.
4. If any subject flips: covered, errors, FP/FN and the exact interval beside
   the 133 / 8,762 baseline, after reproducing that baseline from the unchanged
   labels to prove the harness is the same one.

## Scope

- Protocol v2.1 is **not** amended here. This produces the evidence for whether
  it should be; that decision is the user's.
- No detector is built. `Cards.java`, `Mark.java`, `split_heads.py` and
  `rules.py` are untouched.
- Cohort 9 stays held and unspent.
