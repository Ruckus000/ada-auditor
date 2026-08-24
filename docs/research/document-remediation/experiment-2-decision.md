# Experiment 2 — conclusion and decision

**Date:** 2026-08-24 · Written after the gate failed, against the pipeline and
comparator as they stand at commit `5009d8a`.

# STOP — on deterministic-only remediation

Not a stop on the product. Experiment 1's **PROCEED WITH CONDITIONS**
([decision.md](decision.md)) stands unchanged. What stops is the line of work
Experiment 2 opened: raising straight-through remediation by adding further
deterministic and extractive techniques. Its ceiling has now been measured from
three directions and the gate is not reachable from here.

**Holdout 2 is untouched. Both of its permitted checkpoints remain unspent.**

## The question Experiment 2 asked

> Can deterministic and extractive techniques — no vision model, no frontier
> API, no per-document tuning — raise the fraction of documents that can be
> delivered without human review?

Five techniques were built: caption extraction with a clear-Alt policy, heading
demotion, table header promotion with `/Scope`, decorative-figure artifacting,
and the catalog finishing pass.

## What was measured

Three corpora, one instrument, one pipeline, all measured on 2026-08-24:

| | docs | DELIVERABLE | NEEDS_REVIEW | INCONCLUSIVE | assertions | omissions |
|---|---:|---:|---:|---:|---:|---:|
| corpus — development | 12 | 2 | 3 | 7 | 6 across 4 | 18 |
| holdout 1 — now development | 16 | 3 | 7 | 6 | 10 across 9 | 11 |
| **development total** | **28** | **5** | **10** | **13** | **16 across 13** | **29** |
| holdout 2 — frozen | 16 | 0 | 12 | 4 | 23 across 12 | 20 |

Against the deterministically reachable subset, which is the denominator gate 2
is written against:

| corpus | DELIVERABLE / reachable | |
|---|---:|---:|
| corpus | 2 / 8 | **25%** |
| holdout 1 | 3 / 12 | **25%** |
| holdout 2 | 0 / 14 | **0%** |

The two development corpora land on the same number independently. Holdout 2,
which was authored to be harder, lands below both. Gate 2 requires 80%.

Holdout 1 was re-run through the current pipeline for this write-up. That is
legitimate — it is a development corpus now, both of its checkpoints having been
spent during Experiment 2. It reproduced the recorded post-hoc rescore of **10
assertions** exactly.

## Finding 1 — the techniques worked, and the ceiling is 25%

The reductions Experiment 2 achieved are real and they transferred to unseen
documents. Placeholder alt text — `"image 1"` presented to a screen reader as a
description, on a document veraPDF certifies as conformant — went to **zero on
every corpus**. That was the worst behaviour in the system and it is gone.

But 25% is where three independent corpora put the ceiling, and the increments
still available are small. The last two techniques added — table headers and
decorative-figure artifacting — moved holdout 1 from 2 deliverable documents to
3. Gate 2 wants 80%.

## Finding 2 — the residue is over-detection, not under-detection

All 16 development assertions, verbatim, from
[`evidence/holdout1-as-development.comparison.json`](evidence/holdout1-as-development.comparison.json)
and [`evidence/e2-all.comparison.json`](evidence/e2-all.comparison.json):

| what the pipeline stated | count |
|---|---:|
| headings tagged that ground truth does not record | 6 |
| heading levels wrong at the correct count | 4 |
| Figure elements for decorative or repeated graphics | 2 |
| list structure over content that has none, and 10 items where 8 exist | 2 |
| a data table over a grid of photographs | 1 |
| one logical table reported as two | 1 |

**Twelve of sixteen are the pipeline claiming structure that is not in the
document.** The other four claim the right structure at the wrong level. Not one
is a failure to find something — by the comparator's design, under-detection is
an omission, and omissions do not fail gate 1.

Ten of the sixteen are headings. `Headings.java` is already demotion-only and
was built specifically for this class; the residue that survives it is
semantic — a chart axis label that is typographically indistinguishable from a
section heading, a hierarchy the author applied inconsistently.

## Finding 3 — the two gates pull in opposite directions [V]

This is the finding that decides the question, and it is a property of the
system rather than a measurement that better code could improve.

[compare.mjs:335](../../../experiments/document-remediation/compare.mjs):

```js
const verdict = !compliant ? 'INCONCLUSIVE' : defects.length ? 'NEEDS_REVIEW' : 'DELIVERABLE';
```

An omission blocks `DELIVERABLE` exactly as an assertion does. So:

- **Gate 1 (zero assertions) is passable by abstention.** Where a technique is
  not confident, remove the claim instead of making it. Every assertion becomes
  an omission and the safety gate goes green.
- **Gate 2 (80% deliverable) is unreachable by abstention.** Converting an
  assertion to an omission does not remove a defect. Pure abstention leaves
  development `DELIVERABLE` at exactly **5/28** and holdout 2 at **0/16**, while
  driving assertions to zero.

We have already run this experiment once without naming it. The clear-Alt
policy — *"clear the Alt where no caption is found"* — is abstention, and it
produced the single largest assertion reduction of the whole experiment: 17 to
0 on the development corpus, 14 to 0 on holdout 1. No detector improvement came
within an order of magnitude of it. It also moved every one of those documents
out of `DELIVERABLE` and into review.

That is the trade in miniature. Deterministic techniques can be made safe or
they can be made productive. They cannot be made both, because the information
needed to decide the residual cases is not present in the geometry.

## Why another technique is not the answer

Lists are the largest single cluster on holdout 2. We are not building a list
technique on that basis, and the reason is the freeze rule: choosing what to
build by reading the holdout's defect profile is tuning against the holdout, and
it is exactly the move the two-corpus design exists to prevent. The development
evidence for lists is two assertions in one document.

Headings have the honest evidence — 10 of 16 — and by Finding 3 a better heading
detector converts assertions into omissions at best. That raises gate 1 and
leaves gate 2 where it is.

## Method note — the instrument changed the answer again

`experiment-2-results.md` records the development corpus at 3 assertions, then 4
after the invented-table fix. The current comparator reads **6**. The difference
is the reading-order and list checks added in `#88`; those two defect classes
were recorded in ground truth and scored by nothing.

That is the sixth time in this spike that strengthening the harness made the
number worse and the picture truer — hand classification 2/12 to a measured
1/12, `th === 0` to per-cell checks, positional to content-based table matching,
the prose `rowHeaders` fixture, the missing `captionPresent` keys, and now this.
**The previously reported figure was flattering every single time.** No number
in this spike should be trusted further than the instrument that produced it,
and the development table in `experiment-2-results.md` is stale by exactly this
amount.

## Determinism

The full pipeline was rebuilt from a clean checkout in a fresh worktree — new
`node_modules`, freshly downloaded veraPDF and PDFBox, recompiled classes,
regenerated PDFs — and reproduced both the development corpus and the holdout 2
baseline **exactly**, across verdicts, assertion totals, affected documents,
omissions, and every assertion kind.

The holdout 2 reproduction was **not counted as a checkpoint**, by explicit
decision. It tested the toolchain against a baseline it already had, no
remediation code had changed since that baseline was recorded, and only
aggregates were read. A differing result would have undermined every number in
this directory. It did not differ.

## What this does not say

- It does not say the deterministic layer should be removed. It eliminated the
  worst failure class on every corpus and it is the cheapest correct work in the
  system. It stays.
- It does not say 25% is the product's ceiling. It is the ceiling of *this
  approach on synthetic documents*, and synthetic documents remain an upper
  bound — condition 6 of `decision.md`, running real client documents, is still
  unmet and still the highest-value unspent experiment.
- It does not say a model tier will clear the gate. It says the deterministic
  system was built first and its ceiling has been measured, which is the
  precondition for judging whether a model tier earns its cost.

## The decision

**STOP** adding deterministic techniques. The next thing built should be aimed
at Finding 3 — the residual cases need information the geometry does not carry —
or at condition 6, real client documents, which would tell us whether the
synthetic 25% survives contact at all.

Whichever comes next, holdout 2 is the instrument for measuring it, and it is
still sealed.

## Evidence index

| file | what it is |
|---|---|
| [`evidence/e2-all.comparison.json`](evidence/e2-all.comparison.json) | development corpus, 12 documents |
| [`evidence/holdout1-as-development.comparison.json`](evidence/holdout1-as-development.comparison.json) | holdout 1 re-run as development, 16 documents |
| [`evidence/holdout2-baseline.comparison.json`](evidence/holdout2-baseline.comparison.json) | holdout 2 frozen baseline, 16 documents |
| [`experiment-2-results.md`](experiment-2-results.md) | the checkpoint record, including the disputed 28 |
| [`holdout2.md`](holdout2.md) | freeze rules and checkpoint accounting |

Reproduce any row:

```bash
cd experiments/document-remediation && node compare.mjs <pdfDir> <validatedDir>/summary.json
```
