# Stage 2 — run-in heading split: measure, plan, build (validation-frozen)

Written 2026-09-21, measurement first, per the registered task. No judging in
this phase; the wild gate set (30 documents) is counted in Step 0 but never
tuned against. Thresholds freeze on VALIDATION data only.

## Step 0 numbers (measured 2026-09-21, scripts only)

Label sources: wild gate numbers are graded against consensus labels (judges:
Claude ×4 for rounds 1–3 original rows; Claude Opus-medium seat 1 + Kimi K3
seat 2 on sheets + Claude Opus-quick per-card tie-break for the 566 round-3
completions and 20 conflict re-judgements — `opus-kimi-consensus`). Shape
counts below are field readings, not judgements.

**0a — shapes of the 25 covered FN** (full table:
`out/labels/s2wild-judges-r3/fn-shapes.json`):

| Shape | Count | Reading |
|---|---|---|
| (1) run-in — short first line (≤6 words, no closing .;:) then body | **12** | the candidate rule's target |
| (2) same-line run-in — heading and body share line 1 | 9 | not recoverable by a line-based split |
| (3) standalone short block the model missed | 3 | card building cannot help |
| (4) other | 1 | (c3-0533:2, single-line long block) |

**0b — blast radius of the candidate rule on the wild set** (upper bound:
first-line word count only, `first_line_x1` does not exist yet; requires
line_count ≥ 2, ≤6 words, no closing punctuation, text starts with first line):
**599 cards** would split (tag-restricted to P/LI/H\*: 492). Of the 599,
**479 are currently labelled non-heading** (439 tag-restricted), 30 heading,
90 unlabelled — the 479 are the re-judging upper bound, the future judge bill.
Two documents dominate: c3-0507 (219) and c3-0827 (167). Per-doc table:
`out/labels/s2wild-judges-r3/split-blast-radius.json`.

**0c — registered decision rule on F = 12:** raw view 32 − 12 = **20 > 15**;
R5 view 25 − 12 = **13 ≤ 15**. The conjunction does not hold, so the split is
NOT declared incapable — but plainly: **the raw gate cannot pass on this split
alone** (20 errors against the 15 allowed at n = 2,516); only under the
registered R5 view (bare enumerator → Lbl, which removes the 7
convention-correction FP) does 13 ≤ 15 leave the gate reachable, and only if
every run-in head is recovered AND answered correctly AND nothing else
regresses. **Recommendation: build it anyway.** Product value = misses
recoverable per re-judged card: 12 / 479 ≈ 0.025 at the word-count upper bound;
the width threshold will cut the bill sharply (validation will produce the real
ratio), and every recovered run-in heading is a real barrier the report
currently misses.

## Goal

Recover headings the auto-tagger merged with their first paragraph (shape 1:
12 of the 25 covered wild FN) by splitting such blocks into a head card and a
body card, with the rule designed, tested, and frozen on validation data, and
the wild gate re-measured once afterwards.

## Cut (YAGNI)

- No same-line run-in handling (shape 2, 9 misses): needs intra-line geometry,
  a different rule, its own evidence.
- No standalone-miss handling (shape 3): that is model behaviour, not card
  building.
- No changes to `--split-enumerated-heads`: its behaviour stays byte-identical.
- No re-judging in this phase; no wild sidecar rerun before the threshold is
  frozen; no test-split contact; no retraining.
- No new judge tooling: the page-sheet method and `opus-kimi-consensus`
  pipeline from 2026-09-20/21 are reused as-is.

## The Cards.java change

One new field, `first_line_x1`: the x-coordinate where the block's first
physical line ends, from the same glyph walk that computes `first_line`
(`firstLineOf`): the `x + w` of the last glyph before the first line change
(`firstEnd`), null when the block has no glyphs. The walk, the line-change test
(`dy > 0.5 em`), and every existing field are untouched; dumps without the
field behave exactly as today.

## The generalised rule in `labels/split_heads.py`

New opt-in flag `--split-run-in-heads` on `labels/suggest.py`, calling a new
`split_run_in_heads(blocks, width_frac)`: a P/LI/H\* block splits when

- `line_count` ≥ 2, and
- `first_line` has ≤ 6 words (`head_words`, punctuation-only tokens excluded),
  and
- `first_line` does not end in `.` `;` `:`, and
- `first_line_x1 − x0 < width_frac × (x1 − x0)` — the first line ends before
  the given fraction of the block width, and
- the block text starts with the first line (the existing precondition).

Head card `<locator>h`, `y1` cut at `y0 + 1.3 em`, body under the original
locator — the same mechanics as the enumerated split. The enumerated rule keeps
its own flag and its own tests; a block that matches both splits once.
`build_keys` never calls either: training keys byte-identical with the flag
off, verified by hash.

## Unit tests (written first)

Positive: a P block with a 2-word first line ending at 45% of the block width
splits; the head/body geometry and locators match the enumerated split's
contract; a block matching both rules splits once.

Negative (each its own test):

1. a paragraph whose first line is short because of a line break after a short
   word run (first line ends past the width fraction — no split);
2. a list item (LI) whose first line is short but ends in `:` — no split;
3. a table cell (`in_table_box` true / TH-tag block) — no split;
4. a two-line title (line_count 2, second line as short as the first, first
   line ends past the fraction) — no split;
5. a block ending in a colon / ending in `.` / ending in `;` — no split.

Plus: blocks lacking `first_line_x1` (old dumps) never split; the input block
list is not mutated; `--split-enumerated-heads` output is byte-identical with
the new flag present; `candidate_pool`/`document_cards` hashes unchanged with
both flags off.

## Validation protocol (freeze rule registered in advance)

Corpus: validation-split documents of the keys corpus (`out/keys-all-4`,
label sources `stripped-tree` / `word-outline` / `planted` — struct-tree
truth), excluding the 30 wild gate documents. For each document, dump the ODL
tagged blocks, run the split with the flag off and on, and compare against the
document's key headings (`key-headings.json`, from the original structure — not
from ODL).

Metrics per width threshold in {0.5, 0.6, 0.7}:

- **Heading recall**: of the struct-tree headings that are NOT their own card
  with the flag off (merged run-ins currently lost), the fraction that are
  their own head card with the flag on.
- **False-split rate**: split heads whose normalized text matches no key
  heading of the document, as a share of all blocks.

**Freeze rule (registered now): adopt the highest recall among thresholds whose
false-split rate is ≤ 0.5% of blocks; ties take the smaller threshold.** Then
confirm the training keys are byte-identical with the flag off
(`candidate_pool`/`document_cards` hashes unchanged, as in round 2).

## Wild measurement (run once, after the freeze)

Rerun `labels/suggest.py --split-run-in-heads` sidecars only for wild documents
where the split fires; diff the changed card ids reusing the round-2
changed-id tooling (`v2_prep.py` shape: new `…h` heads and same-id shortened
bodies). Predictions rerun through the registered adapter-r10 path; no
threshold moves.

## Judge-cost estimate

Re-judge the changed cards by the page-sheet two-seat method: Claude
Opus-medium seat 1 and Kimi K3 seat 2 on sheets (≤12 boxes, greyscale JPEG
q80), Claude Opus-quick per-card tie-break on heading-bit disagreements, label
source `opus-kimi-consensus`. Bill at the Step 0b upper bound: 479 changed
non-heading cards + their split heads and shortened bodies ≈ 1,000 cards ≈
17 sheet-chunks per seat + ~3% tie-breaks; the frozen width threshold reduces
this (validation table will carry the real count). Measured seat cost from the
production run: 15 chunks per seat for 586 cards.

## Stop point

**Judging needs the user's go-ahead.** Everything up to the frozen threshold,
the validation table, the changed-id diff and the exact judge bill is scripts
only.

## Known risks

- **Changed prev/next context for neighbours of split cards**: the cards around
  a split see a new predecessor/successor; their predictions may change even
  though their bytes did not. The changed-id diff must count neighbours as
  re-judge candidates, not only the split blocks.
- **`candidate_pool` deduping before container drop**: a head card whose text
  duplicates another card's may be deduped away; the split order must not let
  dedupe silently drop heads.
- **Heads produced from LI blocks**: an LI head keeps `existing_tag: LI`; the
  model and the eval must read the card, not the tag — the enumerated split
  already ships this shape, but the wild judging convention for it is recorded
  in PROTOCOL (a head card split from a list item is judged on its own line).
- Sheet-format bias toward H (coordinator caveat in the 2026-09-21 addendum)
  is unresolved and bounds shared seat error at ≈2%; it applies unchanged to
  the re-judged cards.
