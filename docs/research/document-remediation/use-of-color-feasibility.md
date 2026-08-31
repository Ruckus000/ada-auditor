# 1.4.1 Use of Color — measured, and deliberately not built

**Decision: do not ship a 1.4.1 detector.** Measured on the 23 real documents in
the blind corpus before any product code was written, which is the order
`contrast-results.md` established.

1.4.1 is the criterion the record kept pointing at. `human-effort.md:57` raised
it against a fee schedule that sets changed values in red; `contrast-results.md`
closed 1.4.3 on that same document and explicitly did **not** close this one.
So the question was whether the remaining half is buildable.

## Why it is a different kind of problem

The four criteria closed before this one are *provenance* questions — is there a
title, is there a language, is this `/Alt` string a filename, what is the
measured ratio between two colours. Each has an answer in the bytes.

1.4.1 asks whether colour is *the only* means of conveying information. That is
a question about what the colour **means**, and Matterhorn's one colour
condition, **04-001**, is marked human-testing-required for exactly this reason.
PDF/UA-1 does not cover 1.4.1 at all.

## Measurement 1 — the general signal is ~75% noise

The signature the record describes is a minority colour inside otherwise-uniform
text. Counting per-document text runs in a colour used for under 5% of that
document's runs:

| narrowing | documents firing (of 23) |
|---|---:|
| any minority colour | 19 |
| minority **and** saturated (drop greys, whites, blacks) | **17** |

Even at the tightest honest narrowing, 17 of 23 fire. What they are is the
finding:

| what the accent actually is | example values | roughly |
|---|---|---:|
| hyperlinks | `0000FF`, `0563C1`, `1155CC`, `1E3BFF`, `416AFF` | 11 docs |
| Word theme heading colours | `1F3763`, `365F91`, `4F81BD`, `764491` | several |
| chart and infographic fills | `FFCC3B`, `3CDA85`, `FF4E57` | 2 docs |
| **colour marking a distinction in running text** | `FF0000`, `C00000` | **~4 docs** |

Confirmed rather than assumed: seven of eight spot-checked blue-accent documents
carry `/Link` annotations (r17 84, r33 26, r03 9, r10 6, r34 6, r04 2, r05 2).

A detector that fires on 17 documents to be right about 4 is a **~76%
false-positive rate**. Under the five promises a finding we cannot stand behind
is an invented claim, and that is the one failure class with no tolerance.

## Measurement 2 — the narrow published subset is real, and still not shippable

**WCAG F73** — "links that are not visually evident without color vision" — is a
published failure condition, the same kind of anchor `isPlaceholderAlt` gets from
F30. It is narrow and non-semantic: a `/Link` annotation, coloured differently
from body text, with no underline.

Underline in PDF is drawn, not an attribute, so it is geometry: a thin rule under
the annotation rect spanning most of its width.

```
23 documents · 269 link annotations · 83 with no detectable underline (7 documents)
```

`all bare`: r06 3/3, r12 1/1, r15 21/21, r34 6/6. Partial: r23 43/70, r30 6/8,
r03 3/9.

**But "bare" is not F73 unless the link is also colour-distinguished**, and
**r30's 6 bare links sit in a document with no saturated accent at all** — they
are not distinguished by colour, they are not distinguished at all, which is a
different (and arguably worse) problem F73 does not name. Intersecting per
document leaves roughly **6 documents / ~77 links** as plausible.

Plausible is not shippable. Proving it needs per-link glyph colour compared
against body colour — `Contrast.java`'s machinery, not a regex — and the probe
above has a known bias worth stating: it matches rules against link rects
**file-wide, ignoring the page**, so a rule on page 1 can "underline" a link on
page 5. That biases toward *underlined*, so 83 is a floor. A delicate detector
producing a public claim about a client's document is the precise shape of the
four defects the last four changes fixed.

## Three reasons it is not built anyway

1. **The fix is not ours to make.** Adding an underline is a design change, and
   `position-2026-08-25.md:153` already settled that changing a client's design
   is out of scope. F73 would be detect-and-flag only, like contrast.
2. **It is not on the pass mark.** `legal-standard.md`'s seven-criterion pass
   mark (1.1.1, 1.3.1, 1.3.2, 1.4.3, 2.4.2, 3.1.1, 4.1.2) does not include
   1.4.1, and neither does its blocker table — 2.4.2 ×6, 1.1.1 ×5, 2.4.3 ×2,
   1.3.1 ×1. That table is a mapping from veraPDF failures to criteria and the
   pass mark is independently authored, so 1.4.1's absence is not circular.
3. **Nothing today is lying.** 1.4.1 is already in `NOT_CHECKED_CRITERIA`, and
   the scope sentence puts that in front of the client. This is a disclosed gap,
   not a false claim — the difference between it and the four defects just
   closed.

## What this changed

One comment. `NOT_CHECKED_CRITERIA` said "these four" (three since 1.4.3
graduated) and justified the list as the pass-mark criteria the pipeline does not
reach — true of 1.3.2 and 4.1.2, **false of 1.4.1**, which the pass mark does not
require. Re-deriving the list from that rule would silently drop the disclosure.

## What to do instead

The two pass-mark criteria still unreached are **1.3.2 Meaningful Sequence** and
**4.1.2 Name, Role, Value**. 4.1.2 has a named real document behind it — one of
the nine is an AcroForm and the pipeline does not touch form fields at all.

## Spent

Colour-signal blindness on this corpus is **spent** by the two measurements
above; both ran over all 23 real documents. What survives is that the numbers are
exact and falsifiable.
