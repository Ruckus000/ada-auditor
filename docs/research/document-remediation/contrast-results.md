# Contrast — built, validated, and finding real failures

**Date:** 2026-08-24 · `Contrast.java` + `run-contrast.mjs`. PDFBox only, no new
dependency. **Reports, never fixes.**

Closes the first of the three blocking conditions in
[decision-2026-08-24.md](decision-2026-08-24.md): we could not see WCAG 1.4.3 at
all, and would have shipped a document with a real violation as remediated.

## Validated against planted defects

The synthetic corpora are the right instrument here for the same reason they are
for tagger comparison: **ground truth says which defects were deliberately
planted.** Both were found, and neither was known to the detector.

| document | found | ground truth says |
|---|---|---|
| `11-deliberately-inaccessible` | `#B4B4B4` on white, **2.07:1**, 138 glyphs | *"a paragraph below the contrast threshold carrying real content (application deadline)"* |
| `h13-first-big-text-not-title` | `#E6E0D8` on white, **1.31:1**, 5 glyphs, "DRAFT" | *"largest text is a watermark"* |

**No false positives on the other 26 development documents**, except one
ambiguous case discussed below.

## What it finds on real documents

**3 of 9 fail 1.4.3**, and every finding is substantial:

| document | finding |
|---|---|
| `fordcity-fee-schedule` | `#FF0000` on white, **4.00:1**, **314 glyphs** |
| `ct-legal-notice` | `#FF0000` on white, 4.00:1, 36 glyphs |
| `sturgis-agenda` | `#C0C0C0` on white, **1.82:1**, **497 glyphs** (a disclaimer block); `#C7C7C7` on white, 1.69:1, 63 glyphs |

The Ford City red is the one [human-effort.md](human-effort.md) estimated by eye
at "roughly 4.0:1". It is now measured at 4.00:1 against a 4.5:1 minimum, across
314 glyphs — and the red appears to mark changed values, which raises 1.4.1 Use
of Color as well.

## The design decision that mattered most

The first working version produced **eleven findings that were artifacts** —
mostly a single glyph against an implausible dark grey, on documents whose text
is plainly black on white. A glyph sitting against a rule, an image or dense
neighbouring text has no single background, and the modal colour there is
whatever ink happened to be nearest.

**The pass now abstains.** If the most common sampled colour is not at least
half of the sampled pixels, no background is claimed and no ratio is reported —
the pair is counted as `undetermined` instead. That removed all eleven artifacts
and kept every substantial finding. `tml-statutes-table` went from ten findings
to zero.

Reporting a ratio from an unreliable sample invents a failure, which is the same
class of error as inventing a heading. Undetermined pairs are now 1, 3 and 1 on
three of the nine real documents, and zero everywhere else.

## Two things worth carrying forward

**Large text is 3:1, not 4.5:1** — 18pt, or 14pt bold. The probe ignored this.
Left uncorrected it would have manufactured a failure on every heading in the
corpus.

**The trap, recorded in the file's header.** `PDFTextStripper` does not register
the colour operators, so without the six `SetNonStroking*` operators the graphics
state stays at its default and **every glyph reports `#000000` however it
renders**. Two runs reported a completely clean document before the cause was
found.

## The limitation, stated plainly

`08-slide-layout` produces three single-glyph findings — ornamental slide
numerals at ~2.5:1 on tinted cards. The sampler is behaving correctly; those are
the real colours. Whether they are *failures* depends on whether the numerals are
decorative, and 1.4.3 applies to text that conveys meaning.

**We cannot tell decorative from meaningful**, which is the same wall the figures
work hit. Under a human-in-the-loop model this is a finding for review. **Under
the zero-human constraint it is unresolved**, and it is smaller than the alt-text
version of the same problem but it is the same problem.

## Scope

Detection only. Changing a client's colours is changing their design, and 1.4.1
is a judgement about authorial intent that nothing here can make. Output is a
finding for `manifest.mjs`.
