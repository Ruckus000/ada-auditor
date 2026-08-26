# What a human still has to do

**Date:** 2026-08-24 · Two real documents finished by hand against the
definition in [legal-standard.md](legal-standard.md):
`newcastle-pc-hearing` (1 page, no tables, no figures) and
`fordcity-fee-schedule` (4 pages, one logical fee table).

**Result: the estimate straddles the threshold, which is the least useful place
it could have landed. Roughly 3–4 minutes per page for the simple document and
~6 for the table-heavy one, against a target of under 5.**

## A correction to the headline number, first

The real-document run reported **98.1% of veraPDF failures removed**. Doing the
remaining work by hand shows what that number does and does not mean.

On these two documents the pipeline delivered: tagged content, a reading order,
and a language. That is all.

| | shipped | actually in the document |
|---|---:|---:|
| `newcastle-pc-hearing` headings | **0** | 3 |
| `fordcity-fee-schedule` headings | **0** | 12 section labels |
| `fordcity-fee-schedule` table headers | **0** | a header row + 12 section rows |

**98% of machine-checkable failures removed is not 98% of the work done.** Both
documents come out of the pipeline with no heading structure and no table header
relationships at all — the two things WCAG 1.3.1 is mostly about.

## Why zero headings, on a document that has three

`newcastle-pc-hearing` arrived with six tagged headings and we demoted all six.
That looked like damage until the page was read.

The six were a centred masthead: the document title, the word "Minutes", the
venue, the street address, the date, and a rescheduling note — five of them
metadata, all tagged `H1`, and the sequence started at `H2`, which is itself the
7.4.2-1 failure the file arrived with. **Demoting them was right.**

But the document's two real body headings — the ordinance number and the public
comment section, both bold and both plainly section headings — were tagged by
neither the source nor OpenDataLoader. **`Headings.java` is demotion-only by
design**, so it can never supply them. A document whose real headings were never
tagged gets zero headings from us, correctly and uselessly.

This is the structural limit, made concrete: our safest design decision is also
the one that caps how much of 1.3.1 we can ever deliver.

## A WCAG failure in plain sight that the pipeline cannot see

`fordcity-fee-schedule` sets a subset of its fee values in **red text on white** —
the fire-insurance fees, the street-excavation fees, the coin-operated device
fee, the solicitation permit fee.

Saturated red on white is approximately **4.0:1**, below the **4.5:1** that
**1.4.3 Contrast (Minimum)** requires for normal text. And the red appears to
mark recently changed values, which raises **1.4.1 Use of Color** — meaning
carried by colour alone.

Neither is detectable by anything we have built or measured. veraPDF's `ua1`
profile does not check contrast. Our comparator does not check contrast. Every
number in this project's history is silent about it. **We would have shipped this
document as remediated.**

The exact ratio is an estimate from the rendering rather than a measurement,
because we have no tool that reads colour from the content stream. That gap is
the finding, not the decimal place.

## The work items

For `fordcity-fee-schedule` — four pages, one logical fee table split across
them, twelve section-label rows spanning both columns:

| item | who does it | estimate |
|---|---|---:|
| supply the title | human, reads row 1 | 0.5 min |
| mark the header row `TH scope=Column` | mechanical once decided | 1 min |
| decide how 12 section rows are marked — sub-header rows, or split into 12 tables with captions | **human judgement, skilled** | 10–15 min |
| reconcile one logical table fragmented across 4 pages | human | ~5 min |
| check red values for contrast, flag rather than fix | human + a tool we lack | ~3 min |
| verify reading order | human | ~3 min |

**≈ 25 minutes for 4 pages — about 6 minutes per page.**

For `newcastle-pc-hearing` — one page, no tables, no figures: supply the title
(~0.5 min), decide and apply three headings (~2 min), verify the two-column
"members present" block reads correctly (~1 min), eyeball contrast (~0.2 min).
**≈ 3–4 minutes for 1 page.**

The expensive item is the same in both: **deciding structure the pipeline could
not.** Not typing, not alt text — judgement about what the document means.

## What this is, and what it is not

**These are estimates, not measurements.** Wall-clock time for an AI reading a
PDF is not a proxy for a human remediating one, and pretending otherwise would
be the same proxy-substitution error this project has already made twice. What
is measured is the *work items* — those are enumerated from real documents and
are solid. The minutes attached to them are judgement.

**Two documents is not a sample.** Neither has a figure, so **alt text — the
category blocking five of the nine real documents — is not represented here at
all.** The number would go up, not down, with a figure-bearing document.

**The plan said** at 3 or at 30 minutes per page the decision is obvious, and
near 6 it is not. **We landed near 6.** That is stated rather than resolved by
picking the friendlier of the two documents.

## What it means for the economics

At market rates of $5–25/page and a $50/hr loaded remediator, ~6 min/page is
about **$5/page in labour**. That is inside the market range but at the bottom
of it, and it leaves little margin at the low prices ($4–8) that the published
vendor rates suggest are competitive.

The lever is not faster typing. It is **the judgement step** — deciding
structure — which is 10–15 of the 25 minutes on the table-heavy document. That
is the part a model tier would plausibly assist with, and it is a different
question from the alt-text generation that the model tier was previously assumed
to be for.
