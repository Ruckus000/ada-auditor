# r13 confirmation tie-break: strict-protocol adjudication results (2026-09-24)

Counts only. **Registration:**
`docs/superpowers/plans/2026-09-24-tiebreak-adjudication-registration.md`
(2df4546, committed before any judge ran). **Seen data from a spent batch, not a
pass claim.** The labels as judged stay the record of the one look
(`heading-stage2-2026-09-24-r13-confirmation-results.md`).

**Verdict: MIXED.** 7 of the 12 tie-break FP adjudicate to H. The registration
set "label error" at ≥ 9 and "model error" at ≤ 3. No r14 decision follows from
this alone.

## Adjudication

- **Judges:** `claude-opus-5-5` at effort high, pinned by exact id in a Workflow.
  - 3 independent blind runs on each of the 28 tie-break cards: 84 runs, 0
    missing.
  - Each run quoted the protocol sentence that decides.
- **Agreement with the original Opus 5.5-low tie-break (heading bit):**
  - 19 of 28 cards.
  - 5 of the 12 tie-break FP.

| Card group | Tie-break | Adjudicated (votes) |
|---|---|---|
| Agenda items "IV. Public Comments", "V.", "VI.", "VII.", "X." (c3-0103) and "IV. Other business", "V. Conclusion" (c3-0309) | P | **H** (7 cards, 3/3 or 2/3) |
| "IX. Newfield Update Report" (c3-0103:22) | P | Other (2/3) |
| "XII. Adjournment" (c3-0103:35) | P | Other (3/3) |
| "Section 2.", "Section 4." (c3-0684), "Section 3." (c3-0721) | Lbl, Lbl, P | **Lbl** (2/3, 3/3, 3/3) |
| "Blue Earth County Buffer Protection" (c3-0088:61) | H | Caption (3/3) |
| "Standard Condition 1.5" (c3-0684:56) | H | Lbl (2/3) |
| The other 14 | agree | agree |

- **"Section N." cards:** the adjudicators apply the enumerator-only rule ("a
  box that covers only an enumerator … is `Lbl`"). They read "Section 2." as an
  enumerator, not heading words. The protocol's examples (`A.`, `II.`, `3.`)
  don't settle this.
- **This is a protocol ambiguity, not a judge error,** and it's noted for the
  next protocol revision.

## Confirmation batch recounted (seen data)

| Labels | Predictions | Covered | Errors (FP / FN) | Accuracy LB | FP UB | Clean docs |
|---|---|---|---|---|---|---|
| As judged | As looked at | 2,913 | 35 (15 / 20) | 0.9833 | 0.0088 | 29/40 |
| As judged | With guards (ceacc19) | 2,872 | 20 (15 / 5) | 0.9893 | 0.0088 | 31/40 |
| Adjudicated | As looked at | 2,913 | 28 (9 / 19) | 0.9861 | 0.0061 | 30/40 |
| Adjudicated | With guards | 2,872 | **14 (9 / 5)** | 0.9918 | 0.0061 | 32/40 |

**The last row is not a pass, and must never be quoted as one.**
- The documents are spent.
- The guards were designed on this batch's errors.
- The adjudication changed labels after the model's predictions on them were
  known. The judges were blind, but choosing to adjudicate was not.

It is an estimate of where r13 plus the guards may stand, and it is what the
fresh cohort-8 look will test.

## Remaining errors under the adjudicated labels with guards

- **9 FP:**
  - agenda items judged Other (c3-0103:22, :35)
  - "Section N." cards judged Lbl (c3-0684:16, :84, c3-0721:72)
  - the 3 seats-agree FP (c3-0004:13, :14, c3-0327:182)
  - c3-0684:56
- **5 FN:** as in the guards record.

## Provenance and disclosures

- **Output:**
  - `out/labels/confirm-r13-labels-adjudicated.jsonl`, with `label_source`
    `opus-kimi-fable-consensus+opus55-high-adjudication`
  - per-card votes and quoted rules in `out/labels/confirm-r13-judges/adjudication.json`
- **Run numbering:** the workflow journal kept no run labels, so runs were
  numbered in journal (completion) order. Run order matters only for the
  type tie rule, and it didn't decide any heading bit.
