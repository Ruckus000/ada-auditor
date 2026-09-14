# Heading-type labels from keys — Stage 0 results

**Roadmap:** `docs/superpowers/plans/2026-09-13-staged-autonomy-roadmap.md` (Stage 0). **Plan:** `2026-09-13-key-dataset-pass.md`. **Definition:** `heading-definition-2026-09-13.md` (frozen). **Branch/head:** `claude/heading-labelling-pass` @ head at record time f94ca0e.

## Population
- Tagged originals: 70 total — 44 real PDFs (staging `original`) and 26 Word
  conversions (LibreOffice via the product's filter string; converted 26,
  untagged 0, failed 0). ODL-tagged PDFs excluded by design: 8 (n09, n11,
  n12, n14, n31, r08, r16, r20).
- Hygiene (fixed before scoring: 7.1-3, 7.4.2 and 7.4.4 clean; heading
  sentence share < 0.30; checker failure excludes): 47 usable, 23 excluded
  (33 %). Kill threshold (> 50 %) not fired (build 3; build 4 fires it, see
  below).
  - By reason, recounted from the report JSON (`out/keys/report.json`,
    quoted in the plan's progress file): untagged-content (7.1-3) **19**
    documents — n05, n06, n15, n21, n22, n23, n24, n28, n29, n30, n33, r06,
    r09, r10, r11, r13, r14, r15, r17; level-skip (7.4.2) 7 — n05, n15, n37,
    n50, r17, r19, r21; prose-headings (≥ 0.30 sentence share) 1 — n50;
    checker-failed 0. (n05, n15, n17 [r17] each carry two reasons, so the
    per-reason counts sum to more than 23 excluded documents.)
- Candidates on stripped copies: 1,669 cards over all 47 usable documents —
  n02, n18 and n43 each produced candidate cards (1, 8 and 4 respectively)
  but every one of theirs went unmatched, so 44 of 47 documents contribute
  labelled rows, covering 38 hosts. (The build's own `report.json` states
  40 hosts because it counts hygiene-usable documents rather than documents
  with labelled rows; that counting bug is fixed in code, and the dataset
  was not rebuilt against the fix.) Per-document cap (150 non-random cards)
  binds on r05, r04 and r12.
- Matching (final build): exact 943, contains 87, box 24, unmatched 615 —
  of 1,669 cards, match rate 0.632.
  - Unmatched cards are not written as Artifact (see "How the matcher
    changed" below); they go to `out/keys/unmatched.jsonl` as ids and facts
    only.
  - By-eye checks on card ids: build 1, five `none` rows — 5 of 5 were body
    content (4 tagger-merged lines, 1 split word), 0 furniture; this
    falsified the plan's original "no match → Artifact" rule. Build 2, five
    `box` rows — 2 true, 3 a merged card over a smaller key; build 2 also
    checked five unmatched rows — 0 furniture, 4 merged, 1 split. Final
    build: five `box` rows, 5 of 5 true; three `contains` rows, 3 of 3
    true. The final build's unmatched set was not itself checked by eye.
    Among 8 true matches checked, 3 (n04:0, n19:41, n03:252) are headings
    the original tags as P.
- (build 3) Types: H 231 (H1 35, H2 106, H3 79, H4 11), P 680, Other 139, Caption 4.
  Artifact, TH, TOCI, Lbl and BlockQuote: 0 — see "What a key cannot say".
- (build 3) Label sources: stripped-tree 650, word-outline 404.
- Usable documents whose key carries **zero** headings: 24 of 47 (13
  stripped-tree, 11 word-outline).

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
  evaluation because the labels changed under them (ruling K16). The build-3
  split was drawn once and kept (ruling K18) until build 4 discarded it
  before any evaluation.

## Tagging was reused (ruling K20)
Fix rounds 1 and 2 matched against build 1's tagger output because the
output folder was never cleared between runs. That output is byte-identical
to a fresh tagger run, so the labels produced against it hold; the build
code now clears the folder before tagging.

## Split
- (build 3) Salt `1789352483-c15bc8bc`; train/validation/test = 892/86/76 rows;
  documents 30/6/8; hosts 26/6/6; H 209/16/6; non-H 683/70/70. Leakage
  check: none. `test.spent` absent.
- Test split against the evaluator's floors: documents 8 (< 30, no); clients
  6 (≥ 5, yes); templates 6 (< 10, no); non-headings 70 (< 299, no). No salt
  can meet the documents floor on this corpus — only 44 documents contribute
  labelled rows.

## Reproduction (ruling K21)
(build 3) The salt alone does not reproduce the split, because row groups are named
by random `answer_id`s. The untracked `out/keys/labels.jsonl`, whose sha256
is recorded in `labels/split-keys-2026-09-13.json`, is the only
reproduction path and must be archived. The evaluator's component naming
must drop `answer_id` before Stage 1 draws a split.

## Stage 0 gate (roadmap)
(build 3) Not met, on all three counts:
- cards 1,054 (labelled) vs ≥ 20,000;
- hosts 38 vs ≥ 60;
- match rate 0.632 vs ≥ 95 %.

The harvest round is registered separately, per the plan. No harvesting was
done here.

## What a key cannot say
Stripped tagged PDFs skew toward better producers; transfer to untagged
documents in the wild is measured at the Stage 2→3 audit (~400 blind cards,
`labels.serve`), never here.

- (build 3) Cards.java's block set means keys never produce TH, TOCI, Lbl,
  BlockQuote or Artifact; table cells and list items arrive as Other
  (rulings K7, K13).
- Word keys are soffice's direct tagged export. They skip the product's
  flat-ODF repair and heading renumbering, so levels are the author's raw
  outline (ruling K11).
- (build 3) Stripped copies keep heading-named marked content (18 of 47) and
  `/Outlines` (22 of 47). Renaming and dropping these on n41, r12 and n36
  left the tagger's headings identical (21/21, 95/95, 14/14) — that is no
  leak found on 3 documents, not a proof (ruling K22).
- Keys undercount headings: 3 of 8 sampled true matches are headings tagged
  P in the original, and 24 of 47 keys carry zero headings. Hygiene
  (7.1-3, 7.4.2, 7.4.4, sentence share) does not detect a missing heading,
  so the Stage 0 premise that hygiene makes keys trustworthy is weakened
  for the heading class specifically (ruling K19). (build 3; build 4 excludes
  zero-H keys, though a heading tagged P in a key that has other headings
  still goes undetected.)

## Stop decision
Stage 0's gate is not met. Nothing here evaluates a model. Before Stage 1
round 1 (fine-tune on train, evaluate on validation) can be registered,
three things must be settled — stated here as open questions, not
decisions:
- a many-to-one matcher (or a line-level candidate unit) to raise the match
  rate;
- (build 3) a key-trust step for headings (for example, keys with zero H excluded or
  down-weighted, or a human-audited subset anchoring them — the roadmap's
  own kill remedy); build 4 decided the zero-H exclusion, and the audited
  subset remains open;
- the harvest round, to reach the card and host floors.

## Build 4 (review decisions)
Peer review accepted Stage 0 as measured and decided four recorded items.
Code commit 457fe6b; split commit fa91322. Nothing had been evaluated, so a
rebuild and a new split were allowed. The build ran once and one split was
drawn and kept.

### The four decisions
1. **Hygiene requires at least one heading (K19).** A key with no H block
   with text is excluded as `no-headings`. An author who wrote no headings
   has not made the heading/not-heading distinction the labels teach, so
   that key's P rows say nothing about headings.
2. **The split no longer groups by `answer_id` (K21).** Every key row has
   its own random `answer_id`, so the key linked no rows. It only made
   component names, and so the split, depend on random ids. `GROUP_KEYS` is
   now document, template, client. `answer_id` is still required on a row.
3. **Cards.java emits TH, TD, TOCI, Lbl and BlockQuote (K7, K13).** The key
   vocabulary had types the candidate universe could not represent.
   `StructText.find` recurses into every match, so cells and list labels
   inside Table / L / LI are reached. Artifact stays out. On one staged
   original, the change added Lbl 278, TH 360 and TD 464 blocks, and left
   every existing type's count unchanged.
4. **Strip.java also removes `/Outlines` (K22).** Bookmarks name headings,
   so a stripped copy that keeps them can leak the answer.

### Numbers
- Population: 70 tagged originals, as before.
- Hygiene: 23 usable, 47 excluded (67 %). **The kill threshold (> 50 %)
  fires on this build.**
  - Excluded by reason (a document can carry more than one): `no-headings`
    37, `untagged-content (7.1-3)` 19, `level-skip (7.4.2)` 7,
    `prose-headings (>=0.30)` 1, `checker-failed` 0.
  - The 24 newly excluded documents are the 24 build-3 usable keys that
    carried zero headings.
  - Two shares. The kill as written ("hygiene excludes more than half the
    tagged pool") counts every exclusion, so it fires at 47 of 70. It was
    written about trust, and the exclusions split into two kinds:
    - TRUST (7.1-3, 7.4.2, 7.4.4, prose-headings, checker-failed): 27
      exclusions over 70 = 39 %, counted as reason instances (19 + 7 + 1).
      Counted as distinct documents, it is 23 of 70 = 33 %, because n05,
      n15 and r17 each carry two trust reasons.
    - YIELD (no-headings): 37 of 70 = 53 %.
    - Both were recounted from `out/keys/report.json`'s `excluded` map. A
      document excluded for both kinds counts in both shares; 13 documents
      do, so the distinct shares sum to 23 + 37 − 13 = 47.
  - Because the kill fired, training on this pool is held (ruling B4). Round
    1 is skipped as a quality round, and a plumbing smoke runs in its place;
    its numbers are not a measurement.
- Report: `{"documents": 70, "usable": 23, "cards": 834, "unmatched": 489,
  "match_rate": 0.630, "match": {"exact": 727, "contains": 64, "box": 43,
  "none": 489}, "documents_with_rows": 23, "hosts": 20}`.
  - All 23 usable documents contribute labelled rows, across 20 hosts.
- Types: H 231 (H1 36, H2 102, H3 80, H4 13), P 364, Other 153, Lbl 40,
  TH 38, TOCI 4, Caption 4. BlockQuote 0, Artifact 0.
- Label sources: stripped-tree 487, word-outline 347.
- Stripped copies: 23 of 23 carry no `/Outlines`. This was checked on the
  raw bytes and on the catalog through qpdf.

### Split
- The **build-3 split is discarded before any evaluation.** `test.spent` is
  absent.
- Salt `1789354356-055bad5c`; labels sha256 `b5b1dbb6…85fdd7`; 20
  components. Leakage check: none.
- Train/validation/test:

  | | train | validation | test |
  |---|---|---|---|
  | rows | 368 | 146 | 320 |
  | documents | 15 | 3 | 5 |
  | hosts | 13 | 3 | 4 |
  | H | 115 | 59 | 57 |
  | non-H | 253 | 87 | 263 |

- Test split against the evaluator's floors: documents 5 (< 30, no); clients
  4 (< 5, no); templates 4 (< 10, no); non-headings 263 (< 299, no).
- **The split is reproducible from salt + labels sha, and that was
  verified.** Running `eligibility_eval.py split` again on the same
  `out/keys/labels.jsonl`, with the same salt and into a separate
  directory, gave identical ids for all three parts. The labels file stays
  untracked and must still be archived; only its sha is committed.

### What else this changes
- The Cards.java change also changes candidate cards for the manual
  labelling pass and for any re-run of the Qwen spike Parts 8–28. Those
  Parts dump through Cards.java, so their earlier results reproduce only
  from Cards.java at 201eb80.
- Heading-named marked content remains in content streams (not rewritten).
- The widened block set changes labels through the matcher's tie-break
  (`labels/match.py`, best by IoU, first block wins). A parent block (TD,
  TH) and its child (P, H2) can tie on exact text and box, and
  `StructText.find` emits the parent first, so the parent's type wins.
  - Re-matching the same 834 candidates against the old block set's keys,
    127 rows differ. They include P→Other 40 (a TD key over an inner P),
    P→TH 35, unmatched→Lbl 36, and H→non-H 3: `n41:20`, `n41:28` (H2 inside
    TD, now Other) and `n41:79` (H2 inside TH).
  - The remaining 13 are small moves (P→TOCI 3, P→Lbl 3, unmatched→Other 3,
    unmatched→TH 2, unmatched→TOCI 1, Other→Lbl 1).
  - Ruling K25 fixes the tie-break by the definition's §4 order (rule-3
    types, then H, then P, then Other, then IoU) in round 2's rebuild.
  - Build 4's labels and split are left as built.
- `run.py`'s `OUT_OF_FLOW` and `CONTAINERS` do not know TD, TH or Lbl. A
  re-run of spike Parts 8–28 against the widened Cards.java would therefore
  change which cards those arms can promote.
- The match-rate gate miss stands: 0.630 vs ≥ 95 %. The matcher was not
  tuned. The Stage 0 gate is still not met on all three counts: labelled
  cards 834 vs ≥ 20,000, hosts 20 vs ≥ 60, match rate 0.630 vs ≥ 95 %.
