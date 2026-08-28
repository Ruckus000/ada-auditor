# PDF repair, Phase 0 results: what a real municipal PDF population contains

**Date:** 2026-08-28. Predictions registered first in
[`pdf-repair-2026-08-28-predictions.md`](pdf-repair-2026-08-28-predictions.md)
and scored below, including the part that went untested.

**Population:** 20 PDFs — the nine in `real-sources.md` plus eleven from the
Ford City inventory our own crawl discovered. Public municipal and state
sites. Bytes local under `real-pdf/` (gitignored before the first fetch);
`measure-pdf-population.mts` reproduces every number from the manifests.

Structure only below: counts, clause identifiers and provenance kinds. No
document text, no titles, no paths.

## The headline

| | |
|---|---|
| tagged (`isTagged`, i.e. `structureElements > 0`) | **11 / 20 (55%)** |
| a title is derivable without inventing one | **20 / 20 (100%)** |
| punch-list items populated, with no new code | **5 documents** |
| documents asserting `Marked true` with no structure tree | **1** |
| blocked on font embedding (7.21.4.1) | **5** |
| tagged *and* not font-blocked — reachable to fully green by Phase 2 alone | **4** |

## The finding that decides the work

The failing UA-1 clauses across the whole population, most common first:

| clause | documents | what it is | fixable by transcription? |
|---|---:|---|---|
| 7.1-10 | 14 | ViewerPreferences/DisplayDocTitle | **yes** — `Finish` writes it |
| 7.1-3 | 13 | XMP metadata stream | **yes** — `Finish` writes it |
| 5-1 | 13 | PDF/UA identification in XMP | **yes** — `Finish` writes it |
| 7.1-11 | 9 | metadata/document consistency | **yes** |
| 6.2-1 | 9 | MarkInfo/Marked | **only when tagged** (Phase 1's guard) |
| 7.1-9 | 8 | document title | **yes** — the title chain |
| 7.18.1-2 / 7.18.5-2 | 7 each | link tab order and alternate description | **yes** — `Finish` transcribes the URI |
| 7.2-34 | 6 | natural language | **only when the document declares one** |
| 7.21.4.1-1 | 5 | fonts not embedded | **no** |

**The dominant failures in a real municipal population are exactly the
catalog-level facts the existing `Finish` stage already writes.** That is the
whole case for Phase 2, and it was not knowable from Arm B, whose grader
never named a clause (it read veraPDF's text format, which carries no
per-clause detail).

## Predictions, scored

1. **Tagged share — HELD.** 55%, inside the registered 45–70% and well above
   the 30% floor that would have stopped the work. Transcription-only repair
   reaches the majority of this inventory.
2. **Title chain — HELD, and exceeded.** 100% against a registered ≥ 80%,
   dominated by the filename (11) over docinfo (8), with the first-heading
   rule firing exactly once — as predicted, because tagged municipal PDFs
   here carry almost no heading structure (nine of eleven have zero
   headings). **The junk-refusal half of this prediction went untested:** the
   hex-named document I expected it to catch turned out to carry a real
   docinfo title, so the chain never reached the filename rule. Recorded as
   untested rather than passed.
   *Cosmetic artifact, not a defect:* one derived title ends in the token
   "PDF" because the author's own URL segment does. Transcription keeps what
   the author wrote; stripping it would be an editorial judgement, so the
   policy is unchanged and the artifact noted.
3. **The punch list already fires for PDFs — HELD.** Five documents carry
   items with **no new code**, because PDF inspection already flows through
   the same `summarise()` as conversion. Both item kinds appear: undescribed
   figures on four documents, and a heading-level decision on the one
   document that has headings at all.
4. **A document claiming what it is not — HELD.** One state-legislature PDF
   asserts `Marked true` over an empty structure tree. This is the defect our
   own `Finish` had until this week, found in the wild on the first sample —
   and the reason `Inspect` now reports `marked` separately from `isTagged`.
5. **Pairing does not absorb the font problem — HELD, decisively.** The Ford
   City crawl returned **twelve documents, none of them Word**. For that
   municipality pairing covers zero font-blocked PDFs, against a registered
   "fewer than 40%". Font embedding stays a real, unsolved population.

## What this authorises, and what it does not

**Phase 2 proceeds.** A tagged PDF gets a genuine repair addressing the seven
most common failing clauses; an untagged one gets an honest refusal plus its
punch list. Both halves are real work on a 55/45 split.

**Phase 3 is not cut.** Seven of the eleven tagged documents are font-blocked,
and pairing demonstrably rescues none of them. But the honest scope statement
for Phase 2 on its own is: **≈ 4 of 20 documents reach fully green on both
instruments; the rest improve by several clauses each and carry a named,
actionable blocker.** Removing five failing clauses from a document and
naming the one that remains is worth shipping — it is not the same as
"PDFs work now", and this document exists so that sentence is never written.
