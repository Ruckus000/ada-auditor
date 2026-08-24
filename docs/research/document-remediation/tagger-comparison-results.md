# Four taggers against ground truth — results

**Date:** 2026-08-24 · Measured against
[tagger-comparison-prediction.md](tagger-comparison-prediction.md), committed
before anything was installed. 28 development documents, `compare.mjs` unchanged.

# The prediction missed, in the opposite direction on both counts

| arm | assertions | DELIVERABLE | omissions |
|---|---:|---:|---:|
| **A** current pipeline | **8** | **8/28** | 32 |
| **B** `--hybrid=docling-fast` (auto triage) | 19 | 2/28 | 33 |
| **B** `--hybrid=docling-fast` (`hybridMode: full`) | **26** | 2/28 | 28 |
| **D** `--use-struct-tree` | 8 | 8/28 | 32 |

I predicted docling would **reduce** assertions below 8 by under-detecting, and
leave `DELIVERABLE` near 8. It more than **doubled** assertions and cut
`DELIVERABLE` to a quarter.

The stated win condition — assertions fall **and** `DELIVERABLE` rises — did not
occur in any arm. **The layout model made the pipeline worse.**

## Why, precisely

The regression is one thing, and it scales with how much the model is used:

| assertion kind | A current | B auto | B full |
|---|---:|---:|---:|
| **heading LEVELS wrong** | **2** | **9** | **16** |
| heading over-detection | 3 | 3 | 3 |
| extra Figures | 2 | 2 | 2 |
| table fragmented | 1 | 2 | 2 |
| table headers invented | 0 | 2 | 2 |
| list | 0 | 1 | 1 |

**Docling finds headings and assigns the wrong level to them.** Omissions barely
move (32 → 33 → 28), so it is not under-detecting at all — which is exactly what
the published reports said its weakness was, and exactly what I predicted from
them.

That is a hierarchy-depth failure, not a detection failure. A layout model
classifies a region as "section header" from its appearance; **inferring whether
it is H2 or H3 requires understanding the document's nesting**, which is a
different problem and one the model does not solve.

**The dose-response settles it.** Auto triage sent 16 of 28 documents to the
model and produced 19 assertions. `hybridMode: full` sent all 28 and produced
26. More model, more wrong levels, monotonically. This was run specifically to
foreclose the objection that triage had not given the model a fair test.

## The other arms

**C `--hybrid=hancom-ai` — could not be tested.** `opendataloader-pdf[hybrid]`
ships only the Docling Fast Server; the Hancom backend needs a separate server
that is not in the package. Recorded as untested, not as failed. It is also the
backend whose 0.83 heading accuracy Hancom published about their own product.

**D `--use-struct-tree` — no effect, and open question 3 is closed.** Identical
to the baseline on the development corpus, which is expected: those documents are
deliberately stripped of tags, so there is no structure tree to use. That is a
methodological catch worth stating — **the synthetic corpus is the right
instrument for arm B and the wrong one for arm D.**

Run against the nine real documents, five of which arrive tagged, it changes
almost nothing: **51 → 52** ua1 failures on the tagged five, 129 → 130 overall.
`orono` gets worse by two, `sturgis` better by one.

The reason is consistent with everything else we know: what arrives tagged is
P-soup — five documents carrying thousands of elements and **six headings
between them**. Telling the tagger to use that structure hands it nothing.

## Operational facts, since they decide deployability

| | |
|---|---|
| install size | **1.9 GB** (I predicted 5–8) |
| first run | 63 s — **model download, not inference** |
| steady state | **~516 ms/document**; 12 docs in 17 s, 16 in 9 s |
| accelerator | MPS (Apple GPU) available and used |
| **default bind** | **`0.0.0.0` — every interface, not loopback** |

**Two things a deployment must do**, both found by checking rather than reading:

1. **Force `--host 127.0.0.1`.** The default exposes the backend on every
   interface.
2. **Pre-seed the model cache and set `HF_HUB_OFFLINE=1`.** On first use the
   server fetches weights from `huggingface.co`. That is model data, not document
   data — but with the flag set, startup makes **zero** network calls and
   documents still process. **Locality is now `[V]`, not the vendor's `[R]`.**

## A correction to my own plan

The plan stated: *"the hybrid backend has no alt-text capability — it is layout
analysis, not image description."*

**That is wrong.** The server exposes `--enrich-picture-description` and
`--picture-description-prompt`, plus seven OCR engines and formula enrichment. I
had grepped the npm wrapper's TypeScript options rather than the Python server's
CLI, and concluded from the absence.

So the alt-text capability that blocks five of nine real documents **exists in a
component we have now installed** and has not been tested. That does not change
this result — picture description does not fix heading levels — but it is the
obvious next question and it was written off on a false premise.

## What this means

**Heading promotion remains unsolved**, and the leading candidate is now
eliminated on evidence rather than on reasoning:

- Typographic scoring — built, tested on three documents, promotes an address
  and a column header.
- Layout model — installed, tested on 28 documents with ground truth, triples
  the wrong-level assertions.

**Keep arm A.** The current pipeline is the best of the four measured, and
nothing in `Headings.java`, `Tables.java` or `Lists.java` should change on the
strength of this.

The afternoon cost of running this is the point. A migration decided on the
vendor's 0.83 benchmark would have cost considerably more and moved the numbers
the wrong way.
