# Heading suggestions — Stage 2 same-line run-in probe: Step 0 counts (2026-09-22)

**Plan context:** the run-in split plan (2026-09-22) cut shape 2 — heading and
body sharing line 1 — as unreachable by a line-based split (9 of the then-25
covered FN). This probe adds the smallest per-glyph style output that could
show a bold (or larger) run at the start of the first line followed by regular
text, and counts only. **No rule was built, no model was run, no label was
written, no threshold moved.** Counts only; no document bytes in this record.

## The Cards.java change

One new field, `first_line_runs`: the first line's style runs — maximal spans
of glyphs with equal rounded font size and weight, each `{"text", "font_pt",
"bold"}`, text joined by the same gap rule as `wordsOf`; empty for a glyphless
block. The line-change test is the existing `dy > 0.5 em`, factored out of
`firstLineOf` unchanged. The field is probe-only: no rule and no prompt reads it.

Byte-identity of every pre-existing field, measured:

- 5 PDFs (3 validation tagged copies, 2 wild tagged copies), 1,255 blocks,
  dumped before and after the change: **0 diffs** in any pre-existing field.
- Validation measurement rerun end-to-end (67 documents): per-width table
  identical (19,277 blocks; 192 lost; 43 / 49 / 50 recovered; 87 / 99 / 123
  false splits; freeze stays 0.5) and
  `training_keys_sha256 = ffc5558c20953a161772371537d434d60df882b2c2e1712b806e10bd9249bb0e`
  — **unchanged** from the frozen record
  (heading-stage2-run-in-split-validation-2026-09-22-results.md). A unit test
  pins that `candidate_pool` fingerprints identically with the field present.

## Registered probe definitions

- **Clean style boundary** on a block: `first_line_runs` has ≥ 2 runs; run 0 is
  bold or strictly larger than run 1; run 1 is regular and not larger than
  run 0; and run 0 ends at a word boundary of the first line (not mid-word).
- **Same-line lead-in**: a lost key heading whose normalized text is a strict
  prefix of a block's normalized first line (heading and body share line 1).
- Validation truth is struct-tree key headings, as in the frozen measurement;
  the wild side reads the already-committed run-in + R5 FN set
  (heading-stage2-2026-09-22-rule-r5-wild-gate.md).

## Validation counts (67 documents, off arm = wild sidecar configuration)

- Key headings lost in the off arm: **192** (as frozen).
- Of those, same-line lead-ins: **7**.
- Of those 7, reachable by a clean style boundary (lead run text = the heading):
  **0**. Six lead-ins are a single uniform-style run on line 1; the seventh's
  only run boundary is a bullet glyph, not the heading.
- Pattern census (precision): **338** off-arm blocks show a clean style
  boundary; the lead text is a struct-tree key heading of the document in
  **0 of 338**.

## Wild counts (the 9 shape-2 misses)

The 9 shape-2 ids, re-derived because `fn-shapes.json` is not on the data
branch at 3184183: the 21 run-in + R5 FN minus the 7 shape-1 FN the split did
not split (`shape1-fn-recovery.json`), minus the 3 standalone short blocks
(1–2 words, single line), minus c3-0533:2 (registered shape 4), minus
c3-0755:5 (the registered new error): c3-0128:12, c3-0268:5, c3-0489:10,
c3-0507:110, c3-0533:1, c3-0722:147, c3-0722:209, c3-0794:1, c3-0794:138 —
matching the registered count of 9. Blocks read from the tagged copies in
`out/suggest/{wild-v2,wild-r3}/<doc>/odl-out/`.

**0 of the 9 show a clean style boundary.**

- 5 are a single uniform-style run on line 1 (no style change at all).
- 1 is all-bold multi-run OCR noise (no regular body run).
- 1 has its only run boundary mid-token (rejected by the word-boundary rule).
- 2 have the lead run smaller than the body run (numbering small, title
  larger — the opposite of the pattern).

For completeness: the only one of all 21 FN showing the pattern is the
shape-4 card c3-0533:2, whose lead is a form-field label, not the heading.

## Decision (registered in advance)

Build a rule only if the boundary could reach about 6 or more of the 9 AND the
validation lead-ins show it can be precise. **Reach 0 / 9; validation precision
0 / 338 (and validation reach 0 / 7).** The conjunction fails on every term.

**Do not build the rule.** The same-line lever is dead: on this corpus, same-line
run-ins carry no usable bold-or-larger lead-in signal, and where the signal does
appear it never marks a heading. The line-based split record's verdict stands:
the remaining run-in misses are model behaviour, not card building.
