# How we lost the thread, and what stops it happening again

**Date:** 2026-08-24 · Written after the legal research showed the whole project
had been measuring the wrong thing.

## Root cause

**We selected tools before establishing the buyer's requirement.**

The first research memo scoped OpenDataLoader, veraPDF and software licensing
without once asking what standard a client is legally obliged to meet. Every
gate, every corpus and every decision downstream inherited that choice, and the
instrument silently became the goal.

It is not "we had no definition of done." It is one level deeper: we had no
*external* definition of done, so an internal one grew to fill the space, and it
looked rigorous enough that nobody questioned it for two experiments.

**It happened twice, the same way.** First our own synthetic corpus defined what
reality looked like. Then veraPDF defined what success looked like. Both times
the proxy was measured with real care and the thing behind it was never checked.

## The five failure modes, and the mechanism for each

**No customer-terms definition of done.** "40% deliverable" landed with no target
to compare it to, so it could not be interpreted, so an engineering standard with
a defined pass mark got substituted.
→ *A one-page brief stating the claim as a testable sentence, written before
work starts.*

**Metric drift.** The goal moved from "a service at $50/month tooling" to
"machine-verifiable PDF/UA" to "zero false assertions" without anyone deciding it
should. Each move was locally reasonable.
→ *One north-star metric fixed up front — currently human minutes per page.
Everything else is a diagnostic and is never reported as the answer.*

**Validating against a proxy we controlled.** 44 documents we wrote ourselves.
Condition 6 said to run real client documents and was written when Experiment 1
closed; we deferred it through the whole of Experiment 2. Nine real documents
then broke two techniques in a single run.
→ *No product claim comes from synthetic data. Synthetic corpora test the
harness. Real documents test the product.*

**No stopping rule tied to value.** There was a kill criterion for the technology
and none for "we have learned enough, go and sell something." Work continued
because there were interesting questions, and there are always interesting
questions.
→ *Timebox each step and force a decision at the end: ship, pivot, or stop.*

**Scope expansion.** Every narrow instruction became a programme. "Run the
holdout checkpoint" became documents. "Address the findings" became a subsystem.
"Pull real PDFs" became a full pipeline run and four commits. 3,270 lines of code
the plan itself called throwaway.
→ *Scope stated before starting. Anything interesting found mid-task goes on a
list, not into the build. If the scope looks wrong, say so before starting rather
than by quietly doing more.*

## What actually caught things, and should be kept

Three practices found real defects that nothing else did.

**The assertion / omission split.** Separating a wrong claim already in the bytes
from an honest gap is what made every real finding here findable. veraPDF
reported `ua1=pass` on a document where every data cell had been marked a header.

**Registered predictions.** Twice a written-in-advance, specific prediction caught
a failure nothing else would have. R6 and R7 were silently inert for an entire
run — the build compiled, no stage failed, no validator complained, and the
assertion total still fell, because other rules worked. A general expectation
that "assertions should fall" was satisfied by the broken build. Only the
specificity caught it.

**Strengthening the instrument mid-flight.** Seven times a better measurement
made the number worse and the picture truer. The previously reported figure was
flattering every single time.

## The standing rule

Establish the external standard first. Then choose instruments that measure it.
Then build.
