# Experiment 2 — results and verdict

**Date:** 2026-08-23 · Final holdout checkpoint spent. Both permitted runs used.

## Verdict

# GATE FAILED

Deterministic and extractive techniques, with no vision model and no frontier
API, did not clear either half of the gate.

| Gate | Requirement | Result | |
|---|---|---|---|
| 1 | Zero false assertions on the holdout | **37** across 9/16 | **FAIL** |
| 2 | ≥80% of the deterministically reachable subset DELIVERABLE | **3/12 — 25%** | **FAIL** |

Gate 1 fails even after setting aside the disputed measurement below: 9
assertions is not zero.

## Development corpus — the techniques worked

| | Baseline | Final |
|---|---:|---:|
| False assertions | 26 | **3** |
| Documents with ≥1 assertion | 9/12 | 3/12 |
| Omissions | 14 | 16 |
| DELIVERABLE | 1/12 | **3/12** |

Assertions by kind: placeholder alt 17 → **0**, extra Figure elements 3 → **0**,
table headers missing 2 → **0**, heading over-detection 6 → 1, heading levels
disagree 0 → 2.

An 88% reduction. On the corpus the techniques were built against.

## Holdout — the techniques did not survive contact

| | Baseline | Midpoint | Final |
|---|---:|---:|---:|
| DELIVERABLE | 2 | 2 | 3 |
| NEEDS_REVIEW | 12 | 8 | 7 |
| INCONCLUSIVE | 2 | 6 | 6 |
| **False assertions** | **25** | **10** | **37** |
| Omissions | 12 | 16 | 10 |

Assertions **rose above baseline** between the midpoint and the final run. The
two techniques added in between were table headers and decorative-figure
artifacting.

### What generalised

| Assertion kind | Holdout baseline | Final |
|---|---:|---:|
| placeholder alt | 14 | **0** |
| heading over-detection | 7 | 5 |
| extra Figure elements | 3 | 2 |
| **table: header wrongly promoted** | 0 | **28** |

Caption extraction plus the clear-Alt policy eliminated the largest class
completely on documents built to attack it. That result is real and it
transferred.

At the midpoint — before tables — the holdout stood at 10 assertions against a
baseline of 25, a 60% reduction. **The table technique is what reversed it.**

## The disputed 28, and why the fixture was not amended

All 28 table assertions come from one document, `h08-table-spans-pages`, and
name its registration column (`NW-1001`, `NW-1002`, …) as cells wrongly promoted
to headers.

They are probably not wrong. That document's ground truth records
`"rowHeaders": "registration column, 60 values NW-1001 to NW-1060"` — **prose,
where every other fixture in both corpora uses an array.** `compare.mjs` only
treats a list as naming cells, so it cannot recognise those as legitimate row
headers. It is the same class of fixture inconsistency already found and
corrected in the development corpus for `12-kitchen-sink`.

**The fixture has not been amended.** Correcting a holdout after seeing that it
costs 28 assertions is precisely the goalpost-moving the freeze rule exists to
prevent, and the correction would move the headline number a long way in our
favour. It is recorded here for a human decision instead.

It does not change the verdict. Excluding all 28 leaves 9 assertions against a
required zero, and gate 2 is unaffected at 25%.

### A real defect the comparator only partly sees

`h08`'s table was detected as **two tables** (th 32/84 and 36/96) where ground
truth records `expectedTableCount: 1, spansPages: true`. `compare.mjs` matches
ground-truth tables to detected tables positionally, so the second detected
table has no counterpart and is skipped entirely. Per-page table detection
across a page break is a genuine failure, and the harness is currently blind to
roughly half of it.

## What this says about the product

Deterministic and extractive remediation took the development corpus from 26
false assertions to 3, and eliminated the single worst behaviour — `"image 1"`
presented as a description — on both corpora. That is worth keeping.

It did not reach a state where output can be delivered unreviewed. On unseen
adversarial documents, 3 of 12 reachable documents are deliverable. The
remaining barriers are the ones predicted before any code was written: figures
with no discoverable description, chart internals with no containing region,
scanned pages needing OCR that lives in a service nobody has stood up, and
heading structures that no single threshold orders correctly.

**A model tier is now justified by evidence rather than by anticipation.** The
deterministic system was built first and its ceiling has been measured.

## Method notes worth carrying forward

- **The comparator found what the validator could not.** veraPDF reported
  `ua1=pass` on a document where every data cell had been marked a header.
  Machine conformance and correctness are different questions and only one of
  them is automatable by the validator.
- **Strengthening the comparator mid-experiment changed the answer.** The table
  test was originally `th === 0`, which detects absent headers and not wrong
  ones. Without that change the 28 assertions above would have been invisible
  and the table technique would have been recorded as a clean success on the
  holdout.
- **Hand verification by the party that wrote the pass is not measurement.** The
  table technique was reported as correct cell-by-cell against ground truth, and
  on the development corpus it was. The holdout is where that claim broke.
