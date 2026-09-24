# Rule fixes: two abstain guards (registration, 2026-09-24, before any code)

**Post-hoc, and disclosed as such.** Both guards were designed after reading
the errors of the r13 confirmation batch
(`docs/research/document-remediation/heading-stage2-2026-09-24-r13-confirmation-results.md`).
16 of that batch's 35 covered errors were two deterministic rules at score
1.0, which can never become asks. That batch is spent. Nothing measured on it
below is a pass claim. A pass claim needs new documents.

**Principle.** A rule decides only when it is certain. Each guard makes its
rule **abstain** (`None`), so the model and threshold decide, and the card can
become an ask. A guard never forces H.

## Guard 1: definition rule 2, `rules.artifact_by_repeat`

**Cause.** `margin_band.in_margin_band` measures the band from the top of the
page's *content*. On a page whose first line is a repeated title (each map in
a series, each form in a packet), that title is always in the band, so it is
taken for a running header.

**Guard.** When the repeat is in the **top** band and the card's `font_pt` is
at least the document's median `font_pt` (the body size), the rule abstains.
- Bottom-band repeats, and top-band repeats smaller than body text, are still
  `Artifact`.
- If either new fact is missing, the rule behaves as before.

**New card facts,** computed in `key_context.context_cards` (shared by keys and
suggestions):
- `margin_band`: `"top"`, `"bottom"` or `null`. A card inside both bands is
  `top`.
- `body_font_pt`: the median `font_pt` over every card of the document.

`in_margin_band` is unchanged.

**Measured before the code** (rule-2 hits by band side and size against body
text):

| | Top band, ≥ body (released) | Top band, smaller | Bottom band |
|---|---|---|---|
| Keys, train+val (137 hits) | **8 H / 68 not** | 0 / 12 | 1 / 48 |
| Confirmation, spent (184 hits) | **11 H / 106 not** | 0 / 62 | 0 / 5 |

## Guard 2: definition rule 3's no-letters case, `rules.r2_no_letters`

**Cause.** Some documents' text layers do not match their glyphs: a broken
encoding, or a typewritten scan. The page reads "NORTH" and the text layer
reads "552,579". A card with no letters is taken for a list label. The card's
own facts can't reveal this:
- font size against body text doesn't separate the cases (the true titles
  read 0.43–0.7× body)
- box height against font doesn't either (it overlaps the clean cards)

**Guard.** For cards whose text has no letters, OCR the card's crop in its
marked page image, where the box is found by the mark's magenta.
- If Tesseract reads an alphabetic word of ≥ 3 letters at confidence
  **≥ 80**, the text layer contradicts the page and the rule abstains.
- If there is no fact (`ocr_word_conf` missing, or no box found), the rule
  behaves as before.
- Tesseract (`/opt/homebrew/bin/tesseract`) becomes a required tool for card
  building, as the user decided on 2026-09-24. A missing binary raises an
  error; nothing is skipped silently.

**New card fact:** `ocr_word_conf`, the highest word confidence (0 when no word
is read). It is computed only for cards whose text has no letters, right
after `marked_image` in `suggest.build_cards` and in `key_context.main`.

**Measured before the code** (Tesseract `--psm 7`, conf ≥ 80):

| | No-letter cards | Released H | Released not-H |
|---|---|---|---|
| Validation keys (unspent) | 254 | 0 of 1 | 1 of 253 |
| Confirmation, spent | 923 | **4 of 5** | 18 of 918 |

- The 4 H are "NORTH", "PAHRUMP", "TOWN" and "BOARD".
- In the 18 not-H, OCR reads real words ("the", "inspection"). Their text
  layers are broken too.
- The one H not released is `2007-34`, where OCR reads "LU 7-34". It is
  plausibly genuine digits.

## Adoption

The plan's draft criterion (at most 1 surrendered non-H decision per 3 H
recovered) counted surrendered decisions as losses. They are not losses: a
released card goes to the model, which usually gets it right. That draft is
replaced, before any model scoring, by this:

**A guard is adopted if, once r13 scores the cards it releases, covered errors
on those cards do not rise above the errors the rule made on them.** Released
cards the model can't cover become asks. The added asks are reported, not
gated.

It is measured on:
- **validation keys:** unspent for this question (r13 never trained on
  validation)
- **the confirmation batch:** spent, reported as seen data

Train keys are excluded from the model-scored check, because r13 was trained
on them.

A guard that fails is recorded as dropped, and its code is reverted.

## Scope and consequences

- `decide`'s order and every other rule are unchanged. Cards no guard touches
  must produce byte-identical `decide` output (diffed over the keys and both
  wild card sets).
- An SFT rebuild would change which rows are held back as rule-decided.
  Record the count; no retraining is part of this change.

## Amendments during implementation (2026-09-24, before any model scoring)

Both came from checking the implementation against the four target cards of
the spent batch. They are post-hoc and disclosed.

1. **The crop is taken from the clean page render, not the marked image.** As
   first implemented, the crop was taken inside the marked image's magenta
   outline. It read the four garbled titles at confidence 0–79, because the
   mark is drawn tight over the glyphs. The box is now found from the mark,
   padded by 4 px, cropped from the unmarked render that `marked_image` writes
   beside it, and given a 10 px white border. It reads "PAHRUMP", "TOWN",
   "BOARD" and "NORTH" at 92–97, and `2007-34` at 0.
   - **The crop settings were tuned on those 4 cards.** The false-release rate
     is measured on validation keys with the final method: 4 of 254 no-letter
     cards (1.6 %) are released, and 0 of them are H.
2. **Guard 2 applies to the whole rule chain.** When the text layer is
   contradicted (`ocr_word_conf` ≥ 80), `decide` returns `None` before any
   rule runs. Every rule reads that same text or its derived facts.
   - With the guard inside `r2_no_letters` alone, 2 of the 4 released garbled
     titles were decided `Other` by `list_item_body`. Its `after_inline_label`
     fact is computed from the same wrong text layer.

Release counts with both amendments are recorded in the results record.
