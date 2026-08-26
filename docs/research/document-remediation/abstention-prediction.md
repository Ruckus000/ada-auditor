# Registered prediction — global abstention

**Written and committed before the code was changed.** This spike's record is
that every reported figure flattered until the instrument got stronger, so the
claim goes on the record first and the run either meets it or does not.

Baseline: **16 assertions across 13 of 28 development documents, 29 omissions,
5 DELIVERABLE** — corpus 12 plus holdout 1, the latter a development corpus
since both its checkpoints were spent.

## What the diagnosis found

The plan's first draft invented a justification rule and claimed it reached four
named documents. It reached none of them. So every rule below comes from a dump
of all 82 detected headings, all 7 detected tables and all 7 detected lists in
the development corpus, with the surrounding structure — not from `compare.mjs`'s
assertion strings.

**Headings — 3 changes.**

| | evidence |
|---|---|
| **R4 applied to stripped text** | `CaptionPattern` is matched against raw extracted text, which reads `"P l a t e 1 :"` because `PDFMarkedContentExtractor` yields glyph positions. R1 and R3 already strip whitespace; R4 does not, so `h03`'s two captions escape a rule written to catch them. A bug, not a new rule. |
| **R6 short following paragraph** | A heading followed by a paragraph of fewer than 24 non-whitespace characters. Across 61 legitimate headings followed by a paragraph the shortest is **32**; the wrong ones sit at **3, 10 and 16**. Threshold placed in the gap. |
| **R7 nothing follows** | Exactly one heading in 28 documents has no following block, and it is wrong. A heading that introduces nothing introduces nothing. |

**Lists — one rule.** An `L` with fewer than two `LI` children is not a list.
All five spurious lists in the corpus have exactly one item — four running page
footers and a figure caption. Both legitimate lists have three and five.
*A list-marker test was considered and rejected*: the item count is unanimous on
the evidence, needs no assumption about how bullet glyphs survive extraction,
and is less code.

**Tables — one rule.** A table in which no cell carries a glyph is not a data
table. `doc 06`'s photo grid has **0 of 7** cells bearing text; every legitimate
table in the corpus is at **100%** (21, 21, 9, 42, 116, 132).

**Figures — nothing.** Abstention has no safe direction here: leaving a
decorative graphic as an undescribed `Figure` asserts it is content, artifacting
a meaningful one asserts it is decoration. Same class of lie either way.

## The prediction

**Assertions: 16 → 8.**

| | now | predicted | why |
|---|---:|---:|---|
| headings | 10 | **5** | R4-fix clears `h03`; R6 clears `07`, `12`, `h11`; R7 clears `h08` |
| lists | 2 | **0** | `doc 12` drops to one list of five items, under ground truth's two of eight — both become omissions |
| invented table | 1 | **0** | `doc 06`'s photo grid untagged |
| figure counts | 2 | **2** | `h04`, `h15` — no rule, and none should be invented |
| table fragmentation | 1 | **1** | `h08` needs merging, which is not abstaining |

**The five surviving heading assertions are named in advance**, because a
different five would mean the rules did something other than what is claimed:

- `05` and `h16` — levels wrong at the right count.
- `h01` "SUPERSEDED", `h13` "DRAFT" and "COMMERCIAL IN CONFIDENCE" — status
  stamps sitting above ordinary prose.
- `h12` "Prepared for the Estates Committee, August 2026" — a byline.

These are structurally indistinguishable from headings. `h01`'s own next
paragraph reads "The stamp above is a status marker applied to the whole
document" — the document says so in prose, and no geometry rule can read it.
**An all-caps rule would catch three of them and destroy `h16`'s legitimate
`STORAGE` and `RECORDS` headings, which is the document authored to punish
exactly that move.** This residue is Finding 3 in the data.

**DELIVERABLE: 5/28, unchanged.** None of the five clean documents is touched —
their headings are followed by paragraphs of 33 to 77 characters, their tables
all bear text, and none carries a list. The narrowest margin is `h09` at 33
against a threshold of 24, roughly 1.4×. **A drop below 5 is a predicted risk,
not a regression**, and it would sharpen Finding 3. **A rise above 5 falsifies
Finding 3, and the write-up must say so.**

**Omissions rise from 29.** That is the trade, not a side effect.

**Zero assertions is not expected.** A reported zero should be treated as a
harness bug until independently shown otherwise.

## Gate

Both fail either way, and neither gate moves toward passing:

| Gate | Requirement | Predicted |
|---|---|---|
| 1 | Zero false assertions | 8 — **FAIL** |
| 2 | ≥80% of the reachable subset | 5/20 = 25% — **FAIL** |

Holdout 2 is not run. Both checkpoints stay unspent.
