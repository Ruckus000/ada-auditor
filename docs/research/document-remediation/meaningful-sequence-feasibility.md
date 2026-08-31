# 1.3.2 Meaningful Sequence — measured, and deliberately not built

**Decision: do not ship a 1.3.2 detector.** Measured on the 23 real documents in
the blind corpus before any product code was written, the order
`contrast-results.md` established and `use-of-color-feasibility.md` followed.

1.3.2 was the last criterion on `legal-standard.md`'s seven-criterion pass mark
that the pipeline does not reach. It is now measured rather than merely unbuilt.

## The candidate signal

In a tagged PDF the reading sequence *is* the structure tree's order, so the
failure is a tree whose order does not match the document's. The semantic half —
what the author intended — is not in the bytes. The half that might be: walking
the tree and reading each element's `/Pg` should visit pages monotonically. A
tree that goes 1, 2, 3, 2, 5, 3 presents content from an earlier page after
content from a later one.

## What the measurement did to that idea

| narrowing | documents firing (of 23) |
|---|---:|
| any backward page jump | 7 |
| after not reading a **container's** `/Pg` as content | 6 |
| after excluding descents into a `/Note` (footnotes) | 4 |
| after excluding descents **at a container boundary** | **2** |
| after inspecting those two | **0** |

**Two of the seven were my own instrument.** The first probe recorded a
container's `/Pg` before descending into its children, so a `/Sect` whose hint
points at page 6 followed by children starting on page 1 counted as a defect.
r01's only descent was entirely that.

**Page monotonicity is the wrong yardstick, and this is the finding worth
keeping.** Every remaining descent in r09, r15, r33 and r34 fell exactly at a
container boundary — one story or section ending on a later page than the next
begins. These are InDesign exports (`/Story`, `/Article`, `/_2023_Body`), and
they are ordered **by story, not by page**: a reader should read story A
through, then story B, rather than zigzag across spreads. The tree is right and
the metric is wrong. Tested rather than assumed — every descent was classified
as inside-a-container or at-a-boundary, and the boundary cases are 5 of 7.

**Both survivors are decorative page furniture.** r22's two figures are 133×60pt
and 156×30pt on page 1 — letterhead banners. r10's are a 133×134pt mark and a
628×813pt full-page cover image, on a 612×792pt page. 1.3.2 governs content
"when the sequence in which content is presented affects its meaning". A logo's
position in the reading order does not.

**Zero true positives in 23 real documents.**

## Why the corpus is this clean, which is not luck

The pipeline **refuses untagged PDFs** rather than tagging them by inference —
13 of the corpus's documents come back `repair_refused`. So every PDF we deliver
was tagged by a real tagger, and real taggers get sequence right. The documents
whose reading order would actually be scrambled are the ones we never deliver.

This is a genuine limit on the evidence, not a claim that such documents do not
exist. It also means a 1.3.2 detector would spend its accuracy on the population
least likely to need it.

## The reason not to ship the narrow version

Getting from 7 to 2 took a stack of exemptions — container hints, footnotes,
container boundaries. The boundary exemption alone removes 5 of 7, and **that is
the danger, not the achievement**: a genuinely scrambled document whose scramble
coincided with a section boundary would be passed over in silence. That is the
`/Artifact` mistake from contrast, where a self-invented exemption swallowed a
real 4.0:1 failure across 82 glyphs, except here the exemption is doing most of
the work.

A single principled rule — *pages must not descend within one container* — is
available and needs no exemption stack, because footnotes and stories are
themselves containers. It fires on exactly r10 and r22. Both are false
positives. A rule with no true positives and two false ones on the only evidence
available is not a detector.

## What would be needed instead

Geometry: comparing tree order against the position of the content on the page.
That is `Contrast.java`-scale work, and it does not settle the question either —
a correctly tagged two-column page is geometrically out of order too, and
telling that from scrambled content is the same judgement a person has to make.
Matterhorn's reading-order checkpoints are human-testing-required for this
reason.

## Where this leaves the pass mark

`1.3.2` stays in `NOT_CHECKED_CRITERIA`, now as a measured decision rather than
an unexamined gap. With `1.4.1` also declined on its own measurement, **both
remaining unchecked criteria have been measured**, and the seven the pipeline
does reach are the seven it can reach honestly.

## Spent

Reading-order blindness on this corpus is **spent** by the measurements above;
all of them ran over all 23 real documents. The numbers are exact and
falsifiable, and the instrument was corrected twice before the answer was taken.
