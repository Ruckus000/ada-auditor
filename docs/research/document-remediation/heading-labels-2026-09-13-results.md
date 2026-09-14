# Heading-type labels over the real corpus — results

**Branch:** `claude/heading-labelling-pass`, working checkout
`/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor`.

**Definition:** `heading-definition-2026-09-13.md` (frozen). **Plan:**
`docs/superpowers/plans/2026-09-13-heading-labelling-pass.md`.

## Population (filled from the scripts' own output)
- Manifest: 78 documents, 69 hosts (`labels.manifest`); PDF 52, Word 26.
  (`{"documents": 78, "hosts": 69, "pdf": 52, "docx": 26}`)
- Staging: 44 tagged originals, 8 tagged by OpenDataLoader 2.5.0 defaults
  (n09, n11, n12, n14, n31, r08, r16, r20), failed: none.
  (`{"original": 44, "tagged_by_odl": 8, "failed": []}`)
- Candidates: PDF 4,453 of 31,320 blocks, over 51 of 52 PDFs — `n22`'s
  structure tree reaches only 2 blocks, so it contributes no cards. Word
  1,007 of 2,514 paragraphs over 26 documents
  (`{"paragraphs": 2514, "candidates": 1007}`), rebuilt after table-cell
  paragraphs were marked `in_table_box` and given the PDF containment policy
  (enter only as source H* or random); the earlier 1,455 showed 557 cell
  paragraphs as "in table: False". Changed before any label existed.
- Images: 4,453 PDF cards carry a box, so 4,453 marked images are expected
  and 0 have no box — expected from the cards file; the render job's own
  count is confirmed below.
  Render confirmation: the render re-run printed
  `{"rendered": 4453, "no_box": 0, "failed": 0, "failed_card_ids": []}`; the
  decode check found 4,453 of 4,453 marked images complete PNGs; all 4,453
  PDF cards have a valid image.
- The labelling tool does not show a PDF card whose marked image is missing;
  it prints and displays how many it left out. Any such card is therefore not
  labelled, and the count left out is recorded with the labelling session.
- Filter as fixed 2026-09-13 (`pdf_cards.py`: source H*, ≤15 words
  unterminated, ≥1.15× page median or bold on a regular page, 5% random,
  seed 20260913; Table/TOC/List-contained blocks only as source H* or
  random; ≤150 non-random cards per document, source_h > outlier > short).
  Both bounds were set from counts measured before the first label (18,035 →
  3,839 PDF cards), not from any card's content. Those figures were measured
  on the 43 tagged originals before staging; this run's 4,453 covers all 52
  staged PDFs. Changes after labelling began: none (labelling has not begun).

## Registered before labelling
- Host is the split unit and the proxy for client AND template.
- Second reviewer labels a 200-card sample; if type agreement < 99%,
  disagreeing cases are adjudicated by adding §5 rows, then the sample is
  re-labelled. The disagreeing classes are reported, never dropped.
- Unsure rows are excluded from the split and counted here. Rows written by
  "skip document" carry `skipped: true` (and `unsure: true`, so they are also
  excluded); skipped rows are counted apart from unsure rows, and the unsure
  count reports only real "cannot decide" answers.
- Capped documents: 13 PDF and 1 Word document reach the 150 non-random card
  cap, which drops cards at random within a reason class. Their approved
  heading stacks may miss dropped headings, so the one-level-deeper rule can
  force a level there. Level accuracy on capped documents is reported
  separately from uncapped documents; eligibility (heading or not) is
  unaffected. The filter and cap are not changed.
- Test split is sealed by `eligibility_eval.py split --salt <salt>`; the
  salt is recorded below only after the split is drawn.
- Second reviewer's sample (`--sample`): cards are re-sorted into reading
  order, and heading levels 1–6 are allowed because a random sample cannot
  carry the document's full approved stack; so sample **level** agreement is
  measured without the skip rule and is reported as such. Type and heading
  agreement are unaffected.
- The labelling tool refuses an answer whose card id is not the card on
  screen, so a double key-press cannot label an unseen card.
- Stop after this record: the next step is a person labelling (Task 9 of
  the plan); no model call, split, or evaluation happens before that.

## Labelling
- Reviewer A: <actor>, <n> rows, <hours>; documents completed <n>/<N>. Unsure <n>.
- Reviewer B (sample): <actor>, <n> rows. Agreement: type <x>, heading <x>, level <x>. Disagreements: <list with §5 ruling applied>.

## Split
- Salt `<salt>`; train/validation/test = <n>/<n>/<n> rows; hosts <n>/<n>/<n>; leakage check: none.
- Type counts per split (H / P / Artifact / Caption / TH / TOCI / Lbl / BlockQuote).

## Stop decision
Baseline evaluation on validation only, registered separately, after labels
and the sealed split exist.
