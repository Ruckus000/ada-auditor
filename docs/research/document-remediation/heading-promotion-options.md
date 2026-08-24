# Heading promotion — options, one of them tested to death

**Date:** 2026-08-24 · Written under a new constraint: **no human input at any
stage.** That changes which options are viable, and it retires an argument we
made in Experiment 1.

## The one I built and then killed

Multi-signal typographic scoring. Six signals per line, none of which we had
ever measured: **gap above** the line, **bold**, **centred**, **Title Case**,
**no terminal punctuation**, and **short relative to the page median**.

On `newcastle-pc-hearing` it looked excellent. "Public Comment" scored 5 and was
the only line on the page to do so; everything else scored 4 or below. One true
positive, no false positives.

**Then it was tested on two more documents and broke on both.**

| document | scored ≥5 | actually a heading? |
|---|---|---|
| `nola-cpc-notice` | "CITY PLANNING COMMISSION PUBLIC HEARING NOTICE" | yes |
| | "PUBLIC HEARING" | yes |
| | **"CITY HALL, 1300 PERDIDO STREET"** | **no — an address** |
| `orono-fee-schedule` | **"Fee"** | **no — a table column header** |

`nola` is set entirely in bold, centred text, so two of the six signals carry no
information at all. `orono` is a fee table, where cells are naturally short,
title-case and preceded by gaps.

**Why it fails, and the reason generalises:** every one of those signals
measures *visual prominence*. A date, a venue address and a column header are
all visually prominent and none is a heading. **What makes something a heading
is semantic — it introduces a section — and no typographic signal reaches that.**

Recall was never good either: 1 of 3 on `newcastle`. The document title is
typographically identical to body text, and the ordinance heading is a bold
**run inside** a longer line rather than a bold line.

This option is dead. It is recorded because it looked convincing on one document,
which is precisely the trap this project keeps walking into.

## What is actually available

**Author-supplied structure — free, correct where present, absent more often
than not.** Four of the nine real documents carry a PDF outline. `orono`'s is
excellent — ten real section headings, where our pipeline invented forty junk
ones. `sturgis`'s is real navigational structure. But `fordcity`'s is two file
assembly artifacts, and **`newcastle`'s is the same six bad masthead lines as its
tags** — generated from the same broken styles, so it would reinforce the error
rather than correct it. Use as corroboration, never alone.

**`--use-struct-tree`** — an OpenDataLoader option we have never tried, which
uses the structure tree that arrived. Free, and untested.

**Source-document remediation.** Most of these are Word exports. If the client
supplies the `.docx`, headings are explicit and there is no inference at all —
100% accurate, and the fix is permanent rather than per-export. The Title II
exceptions mean the documents that legally must be fixed are the
**actively-used** ones, and those almost always still have a live source.
Strategically this is the strongest play and it barely involves PDF at all.

**Cross-document template learning.** A municipality's five hundred documents
come from perhaps ten templates. If a short bold line appears in the same
position across two hundred of their agendas, that is overwhelming evidence.
Zero marginal cost after the first document, and nothing in this market does it.
Needs volume, so it fits batch engagements and not one-off files.

## The option we rejected on an assumption that no longer holds

**A local layout model, via OpenDataLoader's own `--hybrid` backend.**

Experiment 1 excluded it because it requires a local Python server beside the
JVM. That was the right call **when a human was in the loop** — a second runtime
was not worth it to save review time that a person was going to spend anyway.

**With no human in the loop, the calculus inverts.** A Python server is a far
smaller price than the thing it replaces, because the thing it replaces no
longer exists.

What makes it the leading candidate:

- **Already integrated.** `--hybrid=docling-fast` and `--hybrid=hancom-ai` are
  options on the tool we already run. No new pipeline, no new vendor.
- **Licence-clean.** OpenDataLoader Apache-2.0, Docling MIT.
- **Local.** `pip install "opendataloader-pdf[hybrid]"` and a server on
  `localhost:5002`. **No bytes leave our infrastructure**, which is the
  non-negotiable constraint — and it is why a hosted frontier API is not an
  option here regardless of quality.
- **It reads the page semantically**, which is the only thing that separates a
  heading from an address, and it is the specific gap the typographic approach
  cannot cross.

It is still promotion, and promotion is still assertion. A model that invents a
heading is the same class of error as a rule that does. What changes is the
precision ceiling, not the kind of risk — so it needs the same comparator, the
same registered prediction, and the same per-document verification.

## Recommendation

1. **Test `--hybrid=docling-fast`** on the nine real documents and score it with
   the comparator we already have. It is the only option that can plausibly
   reach unattended quality, it costs an afternoon, and the integration exists.
2. **Add the outline and `--use-struct-tree` as corroboration**, not as sources
   of truth. Free, and `orono` alone shows the upside.
3. **Raise source-document remediation as a commercial option.** For the
   actively-used subset that Title II actually covers, fixing the `.docx` is
   cheaper, permanent, and needs no inference.
4. **Do not build the typographic scorer.** It is tested and it does not work.
