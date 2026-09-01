# 2.4.6 Headings and Labels — measured, and deliberately not built

**Decision: do not ship a prose-heading detector.** Measured on the 118
delivered documents from the blind run — what a client actually receives —
with the decline criteria registered in `ec2e60a` **before the script was run
once**, following the order `contrast-results.md` set and
`use-of-color-feasibility.md` and `meaningful-sequence-feasibility.md` kept.

The refusal reason is new, and it is not the reason the other two were refused.

## The problem is real, and it is in the source

A township's minutes (`n50`) declared its entire outline with direct
`w:outlineLvl` on 84 paragraphs of ordinary body text. `removeEmptyHeadings`
strips the 35 blank ones and the converter carries the other 49 faithfully, so
the delivered PDF has **49 headings that are sentences** — the longest is 77
words. A screen-reader user navigating that document by heading has it read to
them twice.

The author did that, not the pipeline. Carrying it is correct; the question was
only whether we could NAME it.

## Length is the obvious signal and the wrong one

| narrowing | documents (of 27 with 3+ headings) |
|---|---:|
| any heading of 20+ words | 11 |
| median heading of 8+ words | 3 |
| median heading of 12+ words | **1** |

Length cannot separate a **verbose** heading from a sentence. `n29` carries 83
headings with a median of 11 words and a maximum of 34, and **not one of them
ends a sentence** — they are long section titles, correctly marked up. Any
length rule loose enough to catch `n50` calls `n29` broken.

## Sentence punctuation is a fact, and it separates cleanly

A heading ending in a full stop is a sentence somebody marked as a heading.
Measured as a SHARE of the document's own headings, because one in ninety is a
typo and thirty in forty-nine is how the document was written.

| document | headings ending a sentence | share |
|---|---:|---:|
| n50 | 30 of 49 | **61%** |
| n37 | 5 of 19 | 26% |
| n15 | 10 of 91 | 11% |
| n40 | 2 of 21 | 10% |
| n32 | 3 of 40 | 8% |
| n38, n36, r12, n05 | 1–2 each | ≤6% |

| threshold | documents firing |
|---|---:|
| ≥ 30% | **1** — n50 |
| ≥ 25% | 2 — n50, n37 |
| ≥ 10% | 3 — n50, n37, n15 |

At **≥30% the rule fires on exactly one document, and that document is the true
positive.** No exemptions, no stack, no false positives. `n50` also has 3
headings that start in lower case — mid-sentence continuations — which is as
unambiguous as this gets.

## Against the registered criteria

| # | criterion | verdict |
|---|---|---|
| 1 | a single threshold, no exemption stack | **pass** — one comparison |
| 2 | false positives ≤ 1 in 10 firing | **pass** — 0 of 1 |
| 3 | at least three true positives | **FAIL — exactly one** |
| 4 | states a fact, not a judgement | **pass** — "30 of 49 headings end in a full stop" |

**Refused on criterion 3, and only criterion 3.**

This is a different refusal from the other two, and the difference is worth
keeping straight:

- `1.4.1` fired on 17 of 23 documents to be right about 4 — refused for
  **imprecision**.
- `1.3.2` fired on 7 with **zero** true positives — refused for being wrong.
- `2.4.6` fires on 1 and is right about 1 — refused for **insufficient
  evidence**. The rule looks good. One document cannot tell a rule that works
  from a rule fitted to the document it was written against, and I wrote this
  one already knowing what `n50` looked like.

Shipping it would mean adding a criterion to `CHECKED_CRITERIA`, bumping
`INSTRUMENT_VERSION`, and telling every client we check something we have seen
work once.

## What was NOT done, and why it would have been the trap

The first pass narrowed on length **and** sentence punctuation **and** a single
heading level **and** a heading-to-block ratio — four conditions, 13 documents
down to 1. That is the shape `heading-promotion-options.md` warned about and the
`/Artifact` contrast mistake in miniature: **getting from thirteen to one with a
stack of conditions is the danger, not the achievement.** It was discarded for
the single comparison above, which does the same work honestly.

`heading-promotion-options.md` measured six typographic signals for the inverse
problem, scored 5/6 on one document, then promoted an address and a table column
header on the next two. Its last line is "Do not build the typographic scorer."
That prior held.

## What to do instead

`2.4.6 Headings and Labels` joins `NOT_CHECKED_CRITERIA`, which is the third
entry and the third measured refusal rather than an unexamined gap. Every
surface already renders that list through
`services/presentation/document-verdict.ts`, so a client reading a clean
document verdict is told this was not among the things checked.

**The threshold is measured and waiting.** If a later corpus puts two more
documents above 30%, criterion 3 is met and the rule is already written down —
`experiments/document-remediation/prose-headings.mjs`, one comparison, no
exemptions.

## Spent

The blindness on this question is spent: `n50` has been read, and the numbers
above are exact and falsifiable. A future run of the script on a NEW corpus is
the only evidence that can move this.
