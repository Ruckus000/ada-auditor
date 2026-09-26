# The 58 same-line heading labels, adjudicated: the signal exists on the page and not in the facts (2026-09-26)

Counts only. **Registration:**
`docs/superpowers/plans/2026-09-26-same-line-label-adjudication-registration.md`
(e569d69), with **Amendment 1** (a6af928) recording the first control arm as
void. Spent data: cohort 8 was looked at and its labels feed `out/keys-r14-c8`.
No model was run and no threshold moved.

## Control arm

| Arm | Reported a distinguisher | Threshold | |
|---|---:|---:|---|
| v1, 18 controls | **10** | 15 | **VOID** |
| v2, 20 controls | **20** | 17 | **PASS** |

**v1 failed because of the control definition, not the judges.** A control was
any card with two or more first-line style runs, which admits runs differing
only in font size. Seven of the eight failures are `c8-0220`, a garbled scan
whose runs are all `bold: false` at 11–31 pt — size jitter in a broken text
layer. The judges answered `none` and called the line "bold at one size from
start to end". They were right. On the 11 v1 controls carrying a real
bold→regular contrast, judges scored 11 of 11.

**v2 requires a weight contrast** (run 0 bold, run 1 regular), drawn by
`random.Random(20260926)` from the 55 qualifying cards outside the 58. All 20
are labelled non-`H`, and the judges typed them **P 39 / Other 15 / H 6** across
60 runs — they report the typography and still decline to call it a heading,
which is the protocol's "typography alone never decides". The distinguisher
answer is independent of the type call.

## Subjects: 40 cards, 120 blind runs

| Outcome | Cards |
|---|---:|
| **not-`H`** — the original label was wrong | **2** |
| **`H`, no distinguisher at all** — the label rests on meaning | **23** |
| **`H`, a distinguisher the judge can name** | **15** |

### The 23 are semantics, confirmed twice over

`c8-0114` is the shape: its pages are *entirely* bold italic underlined, so
"1. Minimum Lot Size Requirements" is set exactly like the rule text beside it.
The judges say so unprompted — "the opening phrase is set exactly like the text
that follows it on the same line … the same bold italic underlined face, the
same size" — and `first_line_runs` independently reports one run. 11 of the 23
are `c8-0114`, 5 `c8-0317`.

### The 15 name a boundary that extraction destroys

They do **not** report a style contrast; several say "the same regular weight,
size and case". They report **punctuation and a wide gap**: a closing `.` or `:`
(18 run-mentions), and "extra spacing (a double space)" (18).

**The gap is real on the page and absent from every fact a rule can read.**
`Cards.wordsOf` appends **one** space whenever the glyph gap exceeds
`WORD_GAP_EM = 0.12` em (`Cards.java:270`), so a wide gap and an ordinary word
space are the same character in the extracted text:

| | Cards |
|---|---:|
| Of the 15, a closing `.`/`:` then a **double** space in `first_line` | **0** |
| Of the 15, a closing `.`/`:` then a **single** space | 8 |
| Of the 23, either | 0 |

`first_line_runs` carries `{text, rounded font_pt, bold}` and no x extents, so
the gap is not recoverable from it either. Two cards (`c8-0162:7`) also report
underline, which `Cards` does not model at all — `isBoldFace` reads the font
*name*, and there is no italic or underline field.

## Recount

Baseline reproduced from the unchanged labels before anything moved, to prove
the harness is the one that produced `remeasure.json`.

| | Covered | Errors | FP | FN | Accuracy LB |
|---|---:|---:|---:|---:|---:|
| Re-measurement baseline | 8,762 | 133 | 36 | 97 | 0.9820 |
| **After adjudication** | 8,762 | **131** | 36 | **95** | 0.9823 |

Two cards flip (`c8-0206:314`, `c8-0206:318`). Labels:
`out/labels/cohort8-fixed-labels-adjudicated.jsonl`. This is spent data and not
a pass claim; it makes the `out/keys-r14-c8` fold stale by two rows.

## What this settles

- **The same-line class is 38 real misses, not 58 mislabels.** The labels stand.
- **No card-building rule can reach them on today's facts.** For 23 there is
  nothing to see; for 15 the thing the judges see — a wide gap — is collapsed to
  a single space before any rule runs.
- **A detector would need new extraction, not a new rule**: per-glyph x gaps on
  the first line (and underline/italic), then an intra-line cut that
  `split_heads`'s vertical `y0 + 1.3 em` and `Mark`'s single box cannot express.
  That is a new subsystem for a ceiling of 38 of 131 errors, on a signal whose
  last two measurements were 0 of 7 and 0 of 338.
- **So this is a model class.** The page carries the cue; the extractor drops it;
  the model sees the page. That is where it can be fixed, if anywhere.

## Method notes, disclosed

- The judges were asked for the observation **before** the type call, and were
  never told a card was an error, what the model predicted, or that arms existed.
- The v2 controls were judged in a second batch, after the subjects. Each card
  is judged alone, so batch composition is invisible to a judge. Subjects were
  not re-judged.
- **Two classifier defects of mine, both caught against the data, both fixed.**
  First a negation regex counted "bold, at the same size" as *no* distinguisher;
  then a feature regex counted `none — … the same bold italic underlined face`
  as *a* distinguisher, because the explanation names the shared face. The final
  rule reads the leading token, which is what the prompt asked for. Every number
  above uses it, controls and subjects alike.
