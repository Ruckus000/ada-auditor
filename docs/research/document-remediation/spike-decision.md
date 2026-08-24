# Document remediation — closing decision

**Date:** 2026-08-24 · Supersedes the running commentary in
[experiment-2-decision.md](experiment-2-decision.md) and
[abstention-results.md](abstention-results.md). Experiment 1's
[decision.md](decision.md) is the record of what came before, not a live
recommendation.

# STOP

**On the product as specified: a client sends a PDF, we return a remediated
file, automatically, at $50/month for 1,000 documents.**

That product does not exist on this evidence. Zero of nine real municipal
documents come back deliverable. Three could, if the client supplies a title.
The other six are blocked by two things this architecture does not address and
was never scoped to.

## The criterion the user set, before any code was written

> if clearing remaining failures needs ANY category C work — structure-tree
> surgery, re-parenting, synthesising table header relationships — recommend
> **STOP**. Not "STOP unless the pass rate looks good."

It fires. `nyc-notice-form` needs its Form XObject content re-parented into the
structure tree ([real-failure-classification.md](real-failure-classification.md)).

The criterion is not carrying this decision alone, and it should not have to.

## What the numbers say

**Real documents — nine municipal and state PDFs, the first non-synthetic input
this project has ever seen:**

| | |
|---|---:|
| processed without error | 9 / 9 |
| veraPDF failures, before → after | 6,946 → **129** (98.1% removed) |
| **machine-conformant** | **0 / 9** |
| reachable with deterministic work alone | **3 / 9** — all needing a client-supplied title |
| remaining failures we introduced ourselves | 7 of 20 |

**Synthetic corpus — 28 documents we authored:**

| | |
|---|---:|
| false assertions | 8 |
| DELIVERABLE | 8 / 28 — 40% of the reachable subset |
| gate 1, zero assertions | **FAIL** |
| gate 2, ≥80% reachable | **FAIL** |
| reachable by human review | 19 / 28, for 22 answers |

98% of machine failures removed and nothing deliverable is not a near miss. It
is the shape of a system that fixes what is cheap and stops at what matters.

## What blocks the six

Both are outside the architecture, and neither is a tuning problem.

**Figure descriptions (category B).** Caption extraction found **zero captions
in nine real documents**. On the synthetic corpus it was the single largest win
of Experiment 2 — placeholder alt 17→0 and 14→0. On real municipal documents its
entire contribution is clearing bad alt text, none of the describing. Closing
this needs a human or a model. That was always the expectation; what is new is
that the deterministic half contributes nothing here on real input.

**File-level defects (category E).** Unembedded font programs, incomplete
`CIDSet`, inconsistent glyph widths. Deterministic, well-specified, and nothing
to do with the structure tree — our finishing pass writes four catalog keys and
has no font machinery. **The synthetic corpus contains none of these**, because
Chromium emits clean files. Real municipal PDFs come from Word, from scanners
and from form designers, and arrive already broken below the layer we work at.

## Why the direction was wrong, not just the result

Condition 6 of `decision.md` — *run real client documents* — was written when
Experiment 1 closed. We then built five techniques, an abstention pass, a
review manifest, a second holdout and 32 more fixtures **against a corpus we
wrote ourselves**, and deferred condition 6 through all of it. 3,270 lines of
code the plan called throwaway.

Nine real documents then broke two of those techniques inside a single run, and
exposed a defect in `Headings.java` that had been sitting in the development
corpus since the file was written — one instance, in `h01`, whose verdict I had
attributed to something else. Twenty-eight synthetic documents produced one case
I misread; nine real ones produced three that were impossible to misread.

This is a YAGNI failure at the level of which experiment to run. The cheapest
and most decisive test was available first and was run last. That is the most
useful thing this spike learned about how to work, and it cost more than any of
the code.

## What is worth keeping

The negative result is about the product, not about the work.

- **The comparator and its two-defect model.** Separating an assertion — a wrong
  claim already in the bytes, invisible to a reviewer — from an omission, a gap a
  reviewer can see, is what made every real finding here findable. veraPDF said
  `ua1=pass` on a document where every data cell had been marked a header.
- **Abstention.** Removing claims the document does not justify beat every
  detector: 16 assertions to 8, and it *raised* deliverables rather than trading
  them, which falsified our own stated finding.
- **Registered predictions.** Twice, a specific prediction caught a failure
  nothing else would have. R6 and R7 were silently inert for a whole run — the
  build compiled, no stage failed, no validator complained, and the assertion
  total still fell.
- **The pipeline's robustness.** Nine real documents including a 90-page 8 MB
  packet and a 3.5 MB scanner output, no errors.

## What this does not say

- It does not say document remediation is impossible, or that these techniques
  are worthless. 98.1% of machine failures removed on real input is real.
- It does not say a review-assisted service cannot work. 19 of 28 synthetic
  documents are reachable for 22 answers. **That is a different product with
  different economics, and it has not been costed on real documents.**
- It does not evaluate a model tier. The deterministic ceiling has now been
  measured, which is the precondition for judging one — but no such evaluation
  has been run.

## Open, and deliberately not answered here

Holdout 2 is untouched; **both checkpoints remain unspent.** The 40% figure is
measured on documents the rules were fitted to. Nine real documents have no
ground truth and 195 `/TH` cells were asserted into them unverified.

Those are the questions a next attempt would start from. They are not
prerequisites for this decision, because no answer to any of them turns 0 of 9
into a product at $50 a month.
