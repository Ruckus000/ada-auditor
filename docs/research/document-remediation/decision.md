# Decision

**Date:** 2026-08-23 · Based on [`results.md`](results.md), evidence in [`evidence/`](evidence/)

## The question

Can OpenDataLoader's free Tagged PDF output, followed by a modest deterministic
finishing pass using PDFBox, reliably get representative PDFs through the
machine-verifiable PDF/UA checks performed by veraPDF?

## The answer

**The cheap PDF machinery works. The remediation product is unproven.**

Those are two findings and the second is the important one. Leading with the
first — as an earlier draft of this document did — makes the spike read as a
success when what it actually produced is a much sharper question.

**Machine validation: yes, and it is not close.** 15,167 ua1 failures fell to 3,
across twelve documents, using 97 lines of Java that write four
document-catalog entries.

**Genuine accessibility: no.** Straight-through remediation was 2 of 12. The
distance between those two results is the whole finding: getting a PDF to pass
veraPDF turns out to be easy, and getting it to be accessible turns out to be
the hard part that remains untouched.

**The kill criterion did not fire.** No category C work — no structure-tree
surgery, no re-parenting, no synthesised header relationships — was required or
attempted. Every failure surviving OpenDataLoader was a catalog-level entry:
`MarkInfo`, `Lang`, `ViewerPreferences`, and an XMP metadata stream.

The three remaining failures are all `7.1-9` (`dc:title` absent) on the three
documents authored without a title. That was classified category B **before**
implementation and deliberately left unfixed. It is not a limitation of the
approach; it is a value a client supplies.

## Recommendation

# PROCEED WITH CONDITIONS

The technical premise holds. What does not hold is the assumption that machine
conformance is the product.

**Straight-through remediation was 2 of 12 — 17%** — against a machine pass rate
of 75%. The gap between those two numbers is the entire finding of this spike.

17% is the product. 75% is a property of the validator.

## Why not PROCEED

Because a pipeline shipping on this evidence alone would deliver certified
inaccessible documents, and we would have measured it doing so and shipped
anyway.

OpenDataLoader writes `image 1`, `image 2`, `image 3`, `image 4` as the alt text
for every figure — including in `05-images-captioned`, where a human-written
caption sits directly beneath each image. **That document passes veraPDF ua1
with zero failures.** A blind screen-reader user gets "image 1" where the
document says "the western quay at low tide, viewed from the depot apron."

That is a WCAG 1.1.1 failure with a conformance certificate attached, generated
by our own pipeline, on our own corpus, and it is not an edge case — it is every
figure in every document.

Two further defects passed ua1 silently: the ruled table in document 03 produced
**zero `/TH`**, losing every header relationship, and the borderless table in
document 04 **was not detected as a table at all**. Document 11, carrying eleven
authored barriers, fails only on a missing title — supply one and it reaches a
clean machine pass while remaining unusable.

## Why not STOP

Because the thing that would have justified STOP did not happen. The hypothesis
under test was that the free-to-PDF/UA gap might require reproducing proprietary
remediation logic. It required four catalog writes. The Apache 2.0 tier plus 97
lines of our own code clears the machine-verifiable bar on 9 of 12 documents,
and on 12 of 12 once a title is supplied.

Cost also lands well inside budget: ~1.1 s median per document, two JVM spawns
included. Nothing here threatens the $50/month envelope.

## The conditions

Each is measured, not anticipated.

1. **Caption extraction is mandatory, not an optimisation.** The engine does not
   extract captions even when adjacent. Every figure ships as `image N` without
   it. This was the tier-one proposal in the research review; the spike promotes
   it from good idea to precondition.
2. **A veraPDF pass must never, on its own, produce a DELIVERABLE verdict.**
   Placeholder alt text, missing `/TH`, and undetected tables all pass. The
   verdict has to combine machine validation with checks the validator cannot
   make. `NEEDS_REVIEW` must be the default, and `DELIVERABLE` must be earned.
3. **Table header recovery is unsolved and unscoped.** No `/TH` was produced
   anywhere. `tableMethod: cluster` was deliberately not tried — tuning to
   improve the result is the failure mode this spike avoided — so it is an open
   question, not a dead end. Measure it before designing around it.
4. **OCR requires the hybrid server.** It never fired; document 09 has zero
   extractable text before and after. The 80+ language OCR lives in a separate
   Python service (`opendataloader-pdf[hybrid]`). It is self-hosted, so it does
   not threaten the PII constraint, but it is infrastructure nobody has costed.
   Until it exists, scanned documents are `INCONCLUSIVE` — which is the correct
   answer, and the pipeline must actually give it rather than certifying an
   empty document.
5. **Document language and title are client-supplied inputs.** Writing them is
   deterministic; deciding them is not. Intake has to collect both.
6. **Everything above is an upper bound.** The corpus is twelve synthetic
   documents rendered from clean HTML through Chromium. Six are adversarial,
   which does not remove the bias. **Before committing to a product, run this
   same pipeline over real client documents.** That is the next experiment, and
   it is cheap now that the harness exists.

## What this changes about the product claim

The research review already narrowed the claim from "PDF/UA conformant" to
"passes machine-verifiable PDF/UA checks". This spike shows even that is too
generous as a standalone promise, because we can now name three defect classes
that pass it.

The defensible claim is narrower and matches the evidence:

> Passes all machine-verifiable PDF/UA-1 checks, with figures, tables, and
> language listed for human review.

Which is the same shape as the existing web product: deterministic findings
gate, undecidable ones queue for a human, and nothing is reported as passing
that the system could not actually decide.
