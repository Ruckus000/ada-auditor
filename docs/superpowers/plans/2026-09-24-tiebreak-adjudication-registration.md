# r13 confirmation tie-break: strict-protocol adjudication (registration, 2026-09-24, before any judge runs)

**Why.** 12 of the r13 confirmation batch's 15 FP were settled by the Opus 5.5-low
tie-break (`heading-stage2-2026-09-24-r13-confirmation-results.md`, open item).
Most are an enumerator plus heading words on one short line ("IV. Public
Comments", "Section 2."). `labels/judge/PROTOCOL-sheets.md` says such a card is
`H`, and the tie-break said P or Lbl. This settles whether the remaining FP are
label errors or model errors. That question decides whether an r14 aimed at
enumerated headings is worth training.

**Seen data, not a pass claim.** The batch is spent. The labels as judged stay
the record of the one look. Whatever this changes is reported as a second label
view.

## Population (fixed now)

All 28 tie-break cards (`out/labels/confirm-r13-judges/tiebreak-cards.json`).
They were selected by seat disagreement, never by the model's prediction. All
28 are re-judged, not only the 12 the model got "wrong", so the selection
can't favour the model.

## Judge

- **Three independent blind runs per card:** `claude-opus-5-5`, effort high,
  pinned by exact id in a Workflow. 84 runs.
- **The prompt** gives the protocol's step-2 rules verbatim and tells the judge
  to apply them literally. Each run returns a type, a level, and the protocol
  sentence that decides (`rule`).
- **What the judge sees:** the sheet image, its number tag and the extractor's
  text. It never sees predictions, seat answers, the tie-break verdict or
  labels.

## Decision

- **Adjudicated heading bit:** the majority of the 3 runs (H vs not-H).
- **Adjudicated type:** the most common type among the majority runs. If that
  is tied, it's the first run's type.
- **Output:** `out/labels/confirm-r13-labels-adjudicated.jsonl`. It is the
  confirmation labels with the 28 tie-break rows replaced, and
  `label_source` = `opus-kimi-fable-consensus+opus55-high-adjudication`.

## Reported

1. Heading-bit agreement with the original tie-break, on all 28 cards and on the
   12 tie-break FP (c3-0103:12, :14, :16, :18, :22, :24h, :35; c3-0309:24, :26;
   c3-0684:16, :84; c3-0721:72).
2. The confirmation batch recounted under the adjudicated labels, both as
   looked at and with the adopted rule guards (ceacc19). Both are seen data.

## Interpretation (fixed now)

- **Label error:** if ≥ 9 of the 12 tie-break FP adjudicate to H, the remaining
  FP are mainly label error. An r14 is not motivated by them.
- **Model error:** if ≤ 3 adjudicate to H, they are model errors. An r14
  targeting enumerated headings is motivated.
- **Mixed:** anything between is reported as mixed. No r14 decision follows
  from it alone.
