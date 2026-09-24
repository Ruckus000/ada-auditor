# Rule guards: adoption results (2026-09-24)

Counts only. **Registration:**
`docs/superpowers/plans/2026-09-24-rule-fixes-registration.md` (d4d6a6a),
with two amendments made during implementation and disclosed there.
**Code:** 32465aa. **Scores:** r13 (`out/overnight/12-train-r13/adapter-r13`)
at t_r13 = 0.98081102556551. The test split was not evaluated.

**Verdict: both guards are ADOPTED.** On the cards each one releases, r13 makes
**0** covered errors, against the errors the rule made on the same cards. The
released headings become asks. No confident wrong answer replaces them.

## The guards (in `labels/rules.py`)

1. **Repeated per-page titles.** `artifact_by_repeat` abstains on a repeat that
   sits in the top band at body size or larger. The facts are `margin_band`
   and `body_font_pt`, from `key_context.context_cards`.
2. **Contradicted text layers.** `decide` abstains when a card's text has no
   letters but OCR of its own crop reads a word at confidence ≥ 80
   (`labels/text_layer.py`, fact `ocr_word_conf`, Tesseract). The crop comes
   from the clean page render at the mark's box.

## Adoption table

Validation truth is labels-audited-r10 (10 of 10 released cards).
Confirmation truth is `opus-kimi-fable-consensus`.

| | Released (H) | Rule errors | r13 covered errors | Covered | Asks | |
|---|---|---|---|---|---|---|
| Guard 1, validation keys (unspent) | 6 (5) | 5 | **0** | 1 | 5 | ADOPT |
| Guard 2, validation keys (unspent) | 4 (0) | 0 | **0** | 2 | 2 | ADOPT |
| Guard 1, confirmation (spent, seen) | 114 (11) | 11 | **0** | 94 | 20 | ADOPT |
| Guard 2, confirmation (spent, seen) | 23 (4) | 4 | **0** | 11 | 12 | ADOPT |

- Validation used the key ladder, so only the 10 released cards were scored.
- The confirmation documents use the product's own stack, so all 13 affected
  documents were rescored end to end: 2,456 cards, of which 1,419 went to the
  model and 1,037 were decided by rule.
- **Every released card r13 covered was right, and every released heading
  became an ask.** The guards turn confident rule errors into questions. They
  do not turn them into answers.

## The confirmation batch after the guards (seen data, not a pass claim)

| | Covered | Errors (FP / FN) | Accuracy LB | FP UB | Clean docs |
|---|---|---|---|---|---|
| As looked at (2026-09-24) | 2,913 | 35 (15 / 20) | 0.9833 | 0.0088 | 29/40 |
| With the guards, 13 docs rescored | 2,872 | **20 (15 / 5)** | 0.9893 | 0.0088 | 31/40 |

- FN fall from 20 to 5. FP are unchanged at 15.
- In the rescored documents, 214 cards' predictions moved, because the stack
  changed. No new error came from that.
- **This is still NOT MET** (about 17 errors allowed at n = 2,872). It is not a
  pass claim in any case: the batch is spent, and the guards were designed on
  its errors.
- **The remaining 20 errors are dominated by the model's FP on enumerated
  headings.** 12 of them came from tie-break decisions that look contrary to
  `PROTOCOL-sheets.md` (see the confirmation record, open item).

## Consequences

- **SFT rebuild:** 46 of 7,051 train key cards would no longer be held back as
  rule-decided (P 19, TH 12, H 6, Lbl 5, Other 4; none are c5). There is no
  retraining in this change.
- **Tesseract is now required to build cards** (`text_layer.tesseract` raises
  without it). This was decided by the user on 2026-09-24.
- **A pass claim needs new documents.** Both the confirmation batch and its
  extension are unusable for it. Candidate sources are Kimi's sourcing task or
  a new census draw.
