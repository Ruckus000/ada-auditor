# Classification — what nine real documents still fail

**Date:** 2026-08-24 · Path A output, after the R8 hierarchy fix.
Same method as [failure-classification.md](failure-classification.md):
**category and reasoning are fixed before counting what each choice rescues**,
so the boundaries are not drawn to flatter the result.

Twenty (rule, document) pairs remain across nine documents, from eight distinct
rules. **Seven of the twenty were introduced by our own pipeline.**

## The categories no longer fit, and that is the finding

Experiment 1 cut the axis A/B/C/D along *how much structure-tree work* a fix
needs. Every failure it saw was a structure failure, so the axis held.

Real documents fail PDF/UA in ways that have nothing to do with the structure
tree. Unembedded fonts, an incomplete `CIDSet`, inconsistent glyph widths — these
are deterministic, well-specified, and completely outside the axis. Forcing them
into A would say "deterministic finishing, we can do this", which is false: our
finishing pass writes four catalog keys and has no font machinery at all.

So a category is added rather than stretched, and it is named here rather than
assumed:

| | |
|---|---|
| **A** | deterministic finishing, no new input needed |
| **A\*** | deterministic, but needs a value only the client has |
| **B** | semantic inference — what does this image show? |
| **C** | substantial structure manipulation — **the kill criterion** |
| **E** | file-level and non-structural — font programs, encodings, page dictionaries |

## Every remaining failure

| rule | n | category | reasoning |
|---|---:|---|---|
| `7.1-9` dc:title | 6 | **A\*** | `Finish.java` copies DocInfo `/Title` into XMP. Six real documents have no title to copy. Writing one is trivial; *deciding* one is not ours to do — condition 5 of `decision.md` already said intake must collect it. **2 of the 6 are ours**: the pass creates an XMP stream where none existed, so a document that previously failed a different metadata rule now fails this one. |
| `7.3-1` figure alt | 5 | **B** | **4 of the 5 are ours.** Caption extraction found zero captions in nine documents, so the clear-Alt policy cleared all 43 figures. Clearing is still correct — `"image 1"` as a description is worse than none — but closing this needs a human or a model. |
| `7.21.4.1-1` font not embedded | 2 | **E** | The source file references a font it does not carry. Fixing it means locating, subsetting and embedding the program. Deterministic, entirely outside this architecture. |
| `7.21.4.2-2` CIDSet incomplete | 2 | **E** | The embedded CID font's `CIDSet` does not list every CID present. A correct fix rewrites the font descriptor. |
| `7.18.3-1` `/Tabs S` | 2 | **A** | One name in the page dictionary of every page carrying an annotation. Genuinely trivial — and non-structural, which is why it never appeared in Experiment 1. |
| `7.21.5-1` glyph widths | 1 | **E** | Widths in the font dictionary disagree with the embedded program. Requires reading the font program. |
| `7.10-1` optional content `Name` | 1 | **A** | One string in the optional-content configuration dictionary. |
| `7.20-2` Form XObject content | 1 | **C** | `nyc-notice-form` is an AcroForm. Its Form XObjects' content is not referenced from the structure tree, and incorporating it means re-parenting content into that tree. **Introduced by us** — OpenDataLoader re-tagged the page and left the XObject content outside. |

## The kill criterion fires

Experiment 1's criterion, set by the user before any code was written:

> if clearing remaining failures needs ANY category C work — structure-tree
> surgery, re-parenting, synthesising table header relationships — recommend
> **STOP**. Not "STOP unless the pass rate looks good."

Clearing `nyc-notice-form` needs category C work. **The criterion fires.**

The honest qualification, recorded because it cuts the other way and should not
be buried: `7.20-2` did not arrive with the document. Our re-tagging created it.
On that reading it is an OpenDataLoader limitation rather than work we would
choose to take on, and the response could be "do not break it" rather than
"re-parent content." That is a real distinction and it does not rescue the
criterion, because the document is blocked by **B** and **E** as well. No
reading of `7.20-2` makes `nyc-notice-form` deliverable.

## How many are reachable

Assigned above, counted here.

| document | remaining | reachable with category A alone? |
|---|---|---|
| `fordcity-fee-schedule` | `7.1-9` | **yes** |
| `newcastle-pc-hearing` | `7.1-9` | **yes** |
| `nola-cpc-notice` | `7.1-9` | **yes** |
| `orono-fee-schedule` | `7.1-9`, `7.3-1` | no — B |
| `lacity-clerk-misc` | `7.18.3-1`, `7.3-1` | no — B |
| `sturgis-agenda` | `7.3-1`, `7.21.4.2-2` | no — B, E |
| `tml-statutes-table` | `7.18.3-1`, `7.21.4.1-1`, `7.1-9` | no — E |
| `ct-legal-notice` | `7.21.5-1`, `7.3-1`, `7.21.4.1-1` | no — B, E |
| `nyc-notice-form` | five rules | no — B, E, C |

# 3 of 9

Three real municipal documents can reach machine conformance with deterministic
work we already know how to do, and all three need the client to supply a title.
They are the 4-page, 1-page and 2-page documents.

**Every document over four pages is blocked**, and blocked by two things this
architecture does not address: figure descriptions (B) and file-level defects
that predate us (E).

## What the classification cannot see

The same caveat as Experiment 1, and it has grown teeth. These nine documents
have **no ground truth**, so this counts only what veraPDF can check. The
pipeline asserted 195 `/TH` cells into them and nothing has verified one. A
document listed above as reachable is reachable *to machine conformance* — which
this spike has demonstrated four times is not the same as being correct.
