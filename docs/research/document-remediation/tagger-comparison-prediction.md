# Registered prediction — four taggers against ground truth

**Written and committed before the backends were installed.** This discipline has
already caught two silent failures in this project: R6 and R7 were inert for an
entire run while the build compiled, no stage failed, no validator complained,
and the assertion total still fell. A general expectation would have been
satisfied by the broken build. Only a specific one was not.

## The question

Heading promotion is the one blocking condition with no working solution. The
typographic approach was built and killed — six signals scored cleanly on one
document, then promoted a venue address and a table column header on the next
two ([heading-promotion-options.md](heading-promotion-options.md)).

The remaining candidate is a local layout model, via OpenDataLoader's own
`--hybrid` backend. **Does it produce correct structure, or merely less of it?**

## The arms

| | |
|---|---|
| **A** | current pipeline — baseline **8 assertions, 8 DELIVERABLE** across 28 |
| **B** | `--hybrid=docling-fast` |
| **C** | `--hybrid=hancom-ai` |
| **D** | `--use-struct-tree` |

Scored on the **28 development documents** with `compare.mjs` unchanged.

**On using the synthetic corpus for this.** We learned not to make *product*
claims from documents we wrote ourselves. Comparing two taggers is a different
question, and for it the synthetic corpus is the only instrument that exists:
ground truth is the only way to measure precision, and the nine real documents
have none. The distinction being drawn is between "how good is the product"
(real documents only) and "which tagger is better" (ground truth required).

## The prediction

**B reduces assertions below 8, and `DELIVERABLE` stays at or near 8/28.**

The reasoning is Docling's own documented weakness, which is the mirror image of
ours. Its known failure is that *"headings are often not recognised as such and
are extracted as paragraphs"*, plus over-segmentation of text regions. Our
pipeline over-detects — 100 headings on a 90-page packet, 40 on a fee schedule.

Under-detection produces **omissions**, which pass gate 1. So assertions should
fall. But omissions block `DELIVERABLE` exactly as assertions do, and under the
zero-human constraint a document with no headings fails just as surely as one
with wrong headings — it simply fails honestly.

**If that is what happens, B is not a solution.** It trades one failure mode for
a safer one and leaves us no closer to unattended output.

### The win condition, stated so it can be recognised

**Assertions fall AND `DELIVERABLE` rises.** That would mean the model produces
correct structure rather than less structure, and it is the only outcome that
changes the plan.

### C is unpredicted

No basis either way. Hancom publishes 0.83 heading accuracy for their hybrid
against 0.80 for docling — **their own benchmark, about their own product**, and
this project has been wrong every time it trusted a number it did not measure.
Saying "no prediction" beats inventing one.

Two things that figure hides, and that `compare.mjs` will not: **accuracy is not
precision**, and one wrong heading in six would be an assertion rate far above
the zero our gate requires.

### D is unpredicted

Never run. It is the third path [tagged-input.md](tagged-input.md) measured
around — re-tag blind, or skip the tagger entirely — without ever letting the
tagger *use* the structure that arrived. Most likely to matter on
`sturgis-agenda`, which came in four failures from conformance and left with
twenty-seven.

## What decides it

**Not accuracy. Assertions, and `DELIVERABLE`.**

A tagger that halves assertions by tagging less has not helped. That sentence is
the whole point of writing this down first, because "assertions fell" is exactly
the headline that would otherwise get reported as a success.

## Also recorded before the fact

- **Throughput and memory per arm.** A backend at a minute a page is a different
  product from one at a second, against a target of 1,000 documents a month.
- **Locality is a gate, not a nice-to-have.** The vendor says the hybrid engine
  "operates entirely in a local environment." That is `[R]`. It becomes `[V]`
  when we confirm it ourselves, and no real document is processed before then.
- **Disk before install: 35 GB free on a 96%-full volume.** PyTorch plus weights
  is plausibly 5–8 GB. The cost gets recorded.
