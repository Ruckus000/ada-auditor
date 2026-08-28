# PDF repair, Phase 0: what I expect before measuring

**Date:** 2026-08-28. Registered before the harvest runs, same discipline as
the 120-document test. The point of writing these down is that a number I
cannot be wrong about teaches nothing.

## Why this measurement exists

Arm B of the 120-document test answered "can we repair PDFs" by *inference* —
auto-tag from visual layout, then finish — and measured 62 false assertions
across 20 documents. That result is sound about inference and says nothing
about **transcription**: writing back only what the PDF already states.

Every repair entry point in the product is `accept: isWordDocument`. A
client's PDF gets a diagnosis and never a fix. This phase measures whether
transcription-only repair reaches enough real municipal PDFs to be worth
building, and it is allowed to conclude that it does not.

## Population

The nine PDFs in `real-sources.md` (URLs and hashes recorded 2026-08-24) plus
the Ford City inventory discovered by our own crawl — ~21 documents, all
public municipal or state sites. Bytes stay local under `real-pdf/`, which is
gitignored **before** the first fetch, per the rule that directory's comment
records.

## Predictions

1. **Tagged/untagged split.** The nine-document manifest already records 5
   tagged, 4 untagged. On the wider sample I expect **45–70% tagged**. This
   is the number that decides Phase 2's reach: transcription-only repair can
   only touch a document that already has a structure tree.
2. **Where a title comes from.** Most tagged municipal PDFs in the manifest
   carry **zero headings**, so the first-heading rule will rarely fire. I
   expect the chain to be dominated by the **filename**, and to produce a
   title for **≥ 80%** of documents — with the junk-refusal firing on at
   least one (`sturgis-agenda`'s source path is a 32-character hex blob).
3. **The punch list already fires for PDFs.** Asserted from the code path —
   `document-inspection.ts` calls the same `summarise()` as conversion — but
   never observed. I expect `needs` to be populated on inspected PDFs with
   undescribed figures, with **no new code**. If it is not, that is a finding
   and Phase 2 grows.
4. **Documents that claim what they are not.** `Inspect` now reports `marked`
   separately from `isTagged()`. I expect **at least one** document in this
   sample asserting `Marked true` with an empty structure tree — a producer
   stating an accessibility property the file does not have. Zero would
   surprise me; it is the defect our own `Finish` had until this week.
5. **Fonts and pairing.** For every font-blocked document I expect **fewer
   than 40%** to have a Word source in the same inventory — municipal sites
   mostly publish PDF only, unlike the CDN municipality that motivated
   pairing. If that holds, pairing does *not* absorb the font problem and
   Phase 3 tier 2 stays on the table; if it fails, Phase 3 is cut.

## What would stop the work

If the tagged share is very low — say under 30% — then transcription-only
repair is a feature for a minority of a client's inventory, and the honest
recommendation is to say so plainly rather than ship it as "PDFs work now".
That outcome gets written up with the same weight as a success.
