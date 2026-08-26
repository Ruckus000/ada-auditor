# Building the three blocking conditions

**Date:** 2026-08-24 · Research for the three gaps in
[decision-2026-08-24.md](decision-2026-08-24.md). Every claim below was probed
against a real document rather than reasoned about.

**Summary: no new dependency is needed for any of the three.** One is solved and
proven, one is buildable but lower-yield than hoped, one is trivial.

## 1 · Contrast — solved, ~70 lines, PDFBox only

**Nothing open source does this for PDFs.** The tools that exist — BBC's
`color-contrast-checker`, `WCAG-Contrast-Checker-Ai` — compute the ratio between
two colours you already have. That is the easy half. TPGI's Colour Contrast
Analyser is a manual screen-picker. veraPDF 1.30.2 has **no WCAG flavour**: its
profiles are PDF/A, `ua1`, `ua2`, `wt1r`, `wt1a` and nothing else.

The hard half is getting the colours out of a PDF, and the published objections
are that PDFs use CMYK/Lab/Indexed/Separation colour and place text over
gradients and images. **PDFBox answers both:**

| need | PDFBox |
|---|---|
| exact text colour | `getGraphicsState().getNonStrokingColor()` at the glyph operator |
| any colour space → RGB | `PDColorSpace.toRGB(float[])` |
| background behind the text | `PDFRenderer.renderImageWithDPI()`, then sample pixels |
| the ratio | WCAG relative-luminance formula, ~10 lines |

Sampling the *rendered* page for the background is what handles gradients,
images and filled table cells: it reads what a user actually sees rather than
trying to reconstruct it.

**Proven, not asserted.** A probe measured `fordcity-fee-schedule`:

```
page 1   #000000  1766 glyphs  on #FFFFFF   21.00   pass
         #FF0000    50 glyphs  on #FFFFFF    4.00   FAIL
page 2   #FF0000   175 glyphs  on #FFFFFF    4.00   FAIL
```

**4.00:1 against a 4.5:1 minimum.** [human-effort.md](human-effort.md) estimated
"roughly 4.0:1" by eye; it is now measured.

**One trap, which cost two wrong runs.** `PDFTextStripper` does not register the
colour operators — it only needs glyph positions — so the graphics state stays at
its default and **every glyph reports `#000000` however it actually renders.**
The first two probes confidently reported a clean document. Registering
`SetNonStrokingColor`, `...ColorN`, `...ColorSpace`, `...DeviceRGBColor`,
`...DeviceGrayColor` and `...DeviceCMYKColor` fixes it. Anyone building this will
hit the same thing.

**Scope: detect and flag, never fix.** Changing a client's colours is changing
their design, and 1.4.1 use-of-colour is a judgement call about intent.

## 2 · Heading promotion — buildable, but recovers about a third

**Every off-the-shelf option was rejected on weight, not quality:**

| option | licence | why not |
|---|---|---|
| Docling | MIT | Python plus ML model weights. A second runtime beside the JVM. |
| huridocs/pdf-document-layout-analysis | — | Docker service. Heavier still. |
| OpenDataLoader `--hybrid` (docling-fast, hancom-ai) | Apache-2.0 | Needs a local Python server. Already excluded in Experiment 1. |
| OpenDataLoader itself | Apache-2.0 | No heading-detection knob exists. |

That leaves building it from font metrics, which we already have — `Tables.java`
walks per-MCID font data and extending that walk to size is the same code.

**Then the probe made the case much weaker.** Every line of
`newcastle-pc-hearing` page 1 is **12pt**. There is no size signal at all. Bold
is the only distinction, and it does not separate cleanly:

| bold line | length | actually a heading? |
|---|---:|---|
| "Public Comment" | 14 | **yes** |
| a motion sentence | 79 | no — emphasised body text |
| its continuation line | 65 | no |

Bold alone is **1 of 3** — an assertion machine wrong two times in three. Bold
plus a length cap gets 1 of 1 precision, but recovers only one of the document's
three real headings.

The other two are unreachable this way. The ordinance heading is a bold **run
inside** a longer line, not a bold line. And the document title is 12pt,
unbolded, typographically identical to body text — distinguished only by
position, being the first centred block on page 1, which is a different and
simpler rule.

> **Superseded the same day. This verdict was wrong and it was wrong for the
> usual reason — it was drawn from one document.**
>
> The bold-plus-short rule was extended into a six-signal score and tested on two
> more documents. It promotes a **venue address** on `nola-cpc-notice` and a
> **table column header** on `orono-fee-schedule`. Every signal it uses measures
> *visual prominence*, and a date, an address and a column header are all
> visually prominent. See
> [heading-promotion-options.md](heading-promotion-options.md).
>
> The original verdict is left below rather than deleted, because "small,
> defensible and recovers roughly a third" is exactly how a rule reads when it
> has only been tried once.

~~a bold-plus-short rule is small, defensible and recovers roughly a third.~~ It
is **promotion, which is assertion**, and promotion is where this project has
actually been hurt — the only wrong claims we ever found came from `Tables.java`
promoting. `Headings.java` was made demotion-only for that reason.

The alternatives that survive testing are in
[heading-promotion-options.md](heading-promotion-options.md): author-supplied
outlines as corroboration, `--use-struct-tree`, source-document remediation, and
a local layout model via OpenDataLoader's own hybrid backend.

## 3 · Table header inversion — no research needed

One rule, four cells: **a row of pure currency or numeric values is not a header
row.** `Tables.java` R1 anchors on the leading all-bold run; in a KPI summary
block the emphasised row is the values. Nothing to adopt, nothing to install.

## Unrelated but free, and it bears on an open question

OpenDataLoader has a **`--use-struct-tree`** option we have never used: *"use PDF
structure tree (tagged PDF) for reading order and semantic structure."*

Open question 3 in the index is that we re-tag unconditionally, and
[tagged-input.md](tagged-input.md) measured only two paths — re-tag blind, or
skip the tagger entirely. **This is a third path: let the tagger use the
structure that arrived.** Zero cost to test, and it is the option most likely to
fix `sturgis-agenda`, which arrived four failures from conformance and left with
twenty-seven.

Also noted so nobody reaches for it: `--sanitize` "replaces emails, phone
numbers, IPs, credit cards and URLs with placeholders." That **alters the
client's document** and has no place in remediation.
