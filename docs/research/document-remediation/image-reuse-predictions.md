# Does one description close more than one item? — criteria, registered first

Registered before the probe is written and before any fixture exists, so what
follows is a test rather than a fitting exercise. Counts and corpus ids only:
no image is decoded, saved or described, and no document text is read.

## The question, and why it is not the one I proposed

24 real delivered documents are blocked on `7.3-1` — figure descriptions a
person must write, 303 figures between them. The proposal on the table was a
per-client library so a description written once is reused across a client's
documents, and the stated blocker was "we need a client with repeat documents".

`[V]` Two facts measured while scoping say that framing is wrong:

- The corpus **already** holds six real multi-document organizations — 15
  documents across 6 hosts. Nine of them carry **zero figures** and are already
  conformant; two are signed and refused; one is refused-untagged. The only
  group with figures is the `r04`/`r05` pair, which does not fail `7.3-1` at all.
- **All 24 blocked documents come from 24 different hosts.** No organization
  contributes more than one. The corpus's sample of intra-organization image
  reuse is **zero**, and no amount of analysis will make it larger.

So the cross-document hypothesis cannot be tested against reality here. But a
cheaper question can, and it does not need a client at all: **within a single
document, how often is the same image drawn behind more than one undescribed
figure?** `r05` carries 101 figures whose alt is one repeated string. If those
are one image drawn 101 times, one description closes 101 items on one
document, today, with no client relationship in play.

## The measurement

A throwaway JVM probe over the 24 delivered blocked documents. Per document,
map each `/Figure` element to the image XObject it draws — via the element's
MCID and the page content stream's `Do` operator — and report:

1. figures, and of those, figures carrying a live `1.1.1` punch item;
2. distinct image XObjects behind that undescribed set;
3. how many of those figures **share** an image with another undescribed figure
   in the same document.

## Decline criteria, committed before the numbers are known

1. **Fewer than 3 of the 24 documents with ≥30% of undescribed figures sharing
   an image → decline and stop.** Without within-document reuse the feature
   depends entirely on cross-document reuse, for which the sample is zero, and
   a feature resting on an unmeasurable premise is not built.
2. **If figure→image mapping fails on more than a third of the documents**, the
   result is reported as the draw-level proxy (distinct XObjects vs total
   draws) and **labelled a proxy**. A number that cannot separate a figure from
   page furniture has not earned a conclusion — the rule
   `tree-coverage-declined.md` established, applied before the fact this time.
3. **Page furniture is not evidence.** An image drawn on all 40 pages as a
   header is an artifact candidate, not 40 descriptions saved. Only images
   behind elements carrying a live `1.1.1` item are counted, and any document
   whose "reuse" is a single all-pages image is reported separately rather than
   folded into the headline.

## Predictions

| | registered |
|---|---|
| documents where the probe can map figures to images | ≥ 16 of 24 |
| documents meeting the ≥30% shared-image bar | **unknown — this is the measurement.** No number is predicted, because I have no basis for one and inventing it is the failure this file exists to prevent |
| `r05` specifically | not in the population — it does not fail `7.3-1`. Its 101-figure shape is what motivated the question, not evidence for it |
| conformance change | **zero.** This measures; it changes no product code |

## What a positive result would and would not license

A positive result licenses **one description closing several items in the same
document**, with the person still writing that description. It licenses nothing
about a second document, and nothing automatic: whether the same image can be
reused across documents at all is a separate question with a separate hazard,
and that hazard is what the mock fixtures exist to test.

A negative result is recorded as a fourth decline alongside the artifacting,
the table-row collapse and the 7.1-3 policy, and the description gap stays what
it is: 303 sentences a person writes.
