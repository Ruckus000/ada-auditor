# Heading-type labels from keys — Stage 0 results

**Roadmap:** `docs/superpowers/plans/2026-09-13-staged-autonomy-roadmap.md` (Stage 0). **Plan:** `2026-09-13-key-dataset-pass.md`. **Definition:** `heading-definition-2026-09-13.md` (frozen). **Branch/head:** `claude/heading-labelling-pass` @ head at record time f94ca0e.

## Population
- Tagged originals: 70 total — 44 real PDFs (staging `original`) and 26 Word
  conversions (LibreOffice via the product's filter string; converted 26,
  untagged 0, failed 0). ODL-tagged PDFs excluded by design: 8 (n09, n11,
  n12, n14, n31, r08, r16, r20).
- Hygiene (fixed before scoring: 7.1-3, 7.4.2 and 7.4.4 clean; heading
  sentence share < 0.30; checker failure excludes): 47 usable, 23 excluded
  (33 %). Kill threshold (> 50 %) not fired.
  - By reason, recounted from the report JSON (`out/keys/report.json`,
    quoted in the plan's progress file): untagged-content (7.1-3) **19**
    documents — n05, n06, n15, n21, n22, n23, n24, n28, n29, n30, n33, r06,
    r09, r10, r11, r13, r14, r15, r17; level-skip (7.4.2) 7 — n05, n15, n37,
    n50, r17, r19, r21; prose-headings (≥ 0.30 sentence share) 1 — n50;
    checker-failed 0. (n05, n15, n17 [r17] each carry two reasons, so the
    per-reason counts sum to more than 23 excluded documents.)
- Candidates on stripped copies: 1,669 cards over 44 of 47 usable documents
  (n02, n18 and n43 produced none); 38 hosts carry rows. (The build's own
  `report.json` states 40 hosts because it counts hygiene-usable documents
  rather than documents with rows; that counting bug is fixed in code, and
  the dataset was not rebuilt against the fix.) Per-document cap (150
  non-random cards) binds on r05, r04 and r12.
- Matching (final build): exact 943, contains 87, box 24, unmatched 615 —
  of 1,669 cards, match rate 0.632.
  - Unmatched cards are not written as Artifact (see "How the matcher
    changed" below); they go to `out/keys/unmatched.jsonl` as ids and facts
    only.
  - By-eye checks on card ids: build 1, five `none` rows — 5 of 5 were body
    content (4 tagger-merged lines, 1 split word), 0 furniture; this
    falsified the plan's original "no match → Artifact" rule. Build 2, five
    `box` rows — 2 true, 3 a merged card over a smaller key. Final build:
    5 of 5 `box` true, 3 of 3 `contains` true; five unmatched checked —
    0 furniture, 4 merged, 1 split. Among 8 true matches checked, 3
    (n04:0, n19:41, n03:252) are headings the original tags as P.
- Types: H 231 (H1 35, H2 106, H3 79, H4 11), P 680, Other 139, Caption 4.
  Artifact, TH, TOCI, Lbl and BlockQuote: 0 — see "What a key cannot say".
- Label sources: stripped-tree 650, word-outline 404.
- Usable documents whose key carries **zero** headings: 24 of 47 (14
  stripped-tree, 10 word-outline).

## How the matcher changed, and why
- Unmatched cards are not labelled as Artifact (ruling K14): the plan's
  `none → Artifact` rule was falsified by the build-1 eyeball above (5 of 5
  `none` rows were body content), so unmatched cards are written to
  `out/keys/unmatched.jsonl` as ids and facts only, not scored as a type.
- Containment works one way: the card must lie inside the key, not the
  reverse (ruling K15).
- A box match requires the card inside the key at intersection / card area
  ≥ 0.9 (ruling K17).
- The build ran three times. The first two splits were discarded before any
  evaluation because the labels changed under them (ruling K16). The final
  split was drawn once and kept (ruling K18).

## Tagging was reused (ruling K20)
Fix rounds 1 and 2 matched against build 1's tagger output because the
output folder was never cleared between runs. That output is byte-identical
to a fresh tagger run, so the labels produced against it hold; the build
code now clears the folder before tagging.

## Split
- Salt `1789352483-c15bc8bc`; train/validation/test = 892/86/76 rows;
  documents 30/6/8; hosts 26/6/6; H 209/16/6; non-H 683/70/70. Leakage
  check: none. `test.spent` absent.
- Test split against the evaluator's floors: documents 8 (< 30, no); clients
  6 (≥ 5, yes); templates 6 (< 10, no); non-headings 70 (< 299, no). No salt
  can meet the documents floor on this corpus — only 44 documents produced
  any rows at all.

## Reproduction (ruling K21)
The salt alone does not reproduce the split, because row groups are named
by random `answer_id`s. The untracked `out/keys/labels.jsonl`, whose sha256
is recorded in `labels/split-keys-2026-09-13.json`, is the only
reproduction path and must be archived. The evaluator's component naming
must drop `answer_id` before Stage 1 draws a split.

## Stage 0 gate (roadmap)
Not met, on all three counts:
- cards 1,054 (labelled) vs ≥ 20,000;
- hosts 38 vs ≥ 60;
- match rate 0.632 vs ≥ 95 %.

The harvest round is registered separately, per the plan. No harvesting was
done here.

## What a key cannot say
Stripped tagged PDFs skew toward better producers; transfer to untagged
documents in the wild is measured at the Stage 2→3 audit (~400 blind cards,
`labels.serve`), never here.

- Cards.java's block set means keys never produce TH, TOCI, Lbl,
  BlockQuote or Artifact; table cells and list items arrive as Other
  (rulings K7, K13).
- Word keys are soffice's direct tagged export. They skip the product's
  flat-ODF repair and heading renumbering, so levels are the author's raw
  outline (ruling K11).
- Stripped copies keep heading-named marked content (18 of 47) and
  `/Outlines` (22 of 47). Renaming and dropping these on n41, r12 and n36
  left the tagger's headings identical (21/21, 95/95, 14/14) — that is no
  leak found on 3 documents, not a proof (ruling K22).
- Keys undercount headings: 3 of 8 sampled true matches are headings tagged
  P in the original, and 24 of 47 keys carry zero headings. Hygiene
  (7.1-3, 7.4.2, 7.4.4, sentence share) does not detect a missing heading,
  so the Stage 0 premise that hygiene makes keys trustworthy is weakened
  for the heading class specifically (ruling K19).

## Stop decision
Stage 0's gate is not met. Nothing here evaluates a model. Before Stage 1
round 1 (fine-tune on train, evaluate on validation) can be registered,
three things must be settled — stated here as open questions, not
decisions:
- a many-to-one matcher (or a line-level candidate unit) to raise the match
  rate;
- a key-trust step for headings (for example, keys with zero H excluded or
  down-weighted, or a human-audited subset anchoring them — the roadmap's
  own kill remedy);
- the harvest round, to reach the card and host floors.
