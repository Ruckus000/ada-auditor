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
| **table: header wrongly promoted** | 0 | **28** → **0** after fixture correction |

Caption extraction plus the clear-Alt policy eliminated the largest class
completely on documents built to attack it. That result is real and it
transferred.

At the midpoint — before tables — the holdout stood at 10 assertions against a
baseline of 25. Rescored against the corrected fixture the final run is 9, so
the table technique did **not** reverse the trend; the fixture did. The
techniques hold a roughly 64% assertion reduction on unseen adversarial
documents.

## The disputed 28 — resolved, and the fixture corrected

**Update, same day, authorised explicitly by the user after the checkpoint.**

The h08 fixture has been corrected: `rowHeaders` now lists the 60 registration
values, taken verbatim from the document's own `th[scope=row]` cells, replacing
the prose summary. The correction is recorded inside the fixture under
`groundTruthCorrections`, including a disclosure that it was made after the
result was known.

Rescoring the **same output bytes** against the corrected fixture:

| | Recorded outcome | Post-hoc rescore |
|---|---:|---:|
| False assertions | 37 across 9/16 | **9 across 9/16** |
| Omissions | 10 | 11 |
| DELIVERABLE | 3/16 | 3/16 |
| Gate 1 — zero assertions | FAIL | **FAIL** |
| Gate 2 — ≥80% reachable | FAIL (25%) | **FAIL (25%)** |

The 28 were entirely a measurement artifact. **The table technique promoted no
wrong headers on the holdout at all** — after correction, h08 carries zero table
assertions. Its residue is one heading over-detection and one omission.

The rescore is not a fresh measurement. The pipeline was not re-run, no new
holdout checkpoint was spent, and the recorded outcome of the gate remains the
37. Both figures are reported because the honest reading needs both: the gate
was evaluated against a fixture we later found to be wrong, and it failed under
either.

The remaining h08 omission is informative: *"32 ground-truth headers still
tagged TD"*. Its table was split into two — 32 TH and 36 TH — and `compare.mjs`
matches ground truth to detected tables positionally, so the 36 in the second
table are invisible and counted as missing. The technique promoted 68 headers
across the split where 64 were expected; the excess is the header row repeated
on each continuation page.

## Why the fixture was originally left alone

All 28 table assertions come from one document, `h08-table-spans-pages`, and
name its registration column (`NW-1001`, `NW-1002`, …) as cells wrongly promoted
to headers.

They are probably not wrong. That document's ground truth records
`"rowHeaders": "registration column, 60 values NW-1001 to NW-1060"` — **prose,
where every other fixture in both corpora uses an array.** `compare.mjs` only
treats a list as naming cells, so it cannot recognise those as legitimate row
headers. It is the same class of fixture inconsistency already found and
corrected in the development corpus for `12-kitchen-sink`.

The fixture was **not** amended at checkpoint time. Correcting a holdout after
seeing that it costs 28 assertions is precisely the goalpost-moving the freeze
rule exists to prevent, and the correction moves the headline a long way in our
favour. It was recorded for a human decision, which is the process the freeze
rule is for — not a prohibition on ever fixing a fixture, but a requirement that
someone other than the party benefiting decides.

The user authorised the correction, and it is applied above. The verdict was
unchanged either way, which is what made the disclosure easy; had it flipped the
gate, the right answer would have been a fresh holdout rather than a rescore.

### The defect underneath — since fixed in the harness

`h08`'s table was detected as **two tables** (th 32/84 and 36/96) where ground
truth records `expectedTableCount: 1, spansPages: true`. `compare.mjs` matched
ground-truth tables to detected tables *positionally*, so the second had no
counterpart at index 1 and was skipped entirely — 36 promoted headers invisible,
while the 32 in the first fragment were scored against the whole ground truth
and reported as mostly missing.

Matching is now by content overlap: a detected table belongs to whichever
ground-truth table its cell texts overlap most. That allows one logical table to
be found in several pieces, reports the fragmentation as the structural
misstatement it is, and names a detected table matching nothing as invented
structure rather than ignoring it.

**Three numbers for the same output bytes**, and the differences are all
measurement rather than remediation:

| Measurement | Holdout assertions |
|---|---:|
| At the checkpoint — prose fixture, positional matching | **37** |
| Corrected fixture, positional matching | 9 |
| Corrected fixture, content matching | **10** |

The last is the most accurate. It is one *higher* than the middle because h08's
fragmentation now registers as an assertion instead of being half-invisible, and
its spurious "32 headers still tagged TD" omission correctly disappears once
both fragments are counted together.

**37 remains the recorded outcome of the gate**, because that is what the gate
was evaluated against. The gate fails on all three readings.

### The same fix found an invented table in the development corpus

Doc 06 records `"tables": []` in ground truth, and OpenDataLoader had tagged a
2-row, 7-cell **data table over a grid of photographs**. Announcing rows and
columns over content that has neither misleads exactly as much as a wrong header
does, and positional matching skipped it silently because there was no
ground-truth table at index 0 to compare against.

Development corpus assertions go 3 → 4. An honest increase: the defect was
always there and the harness could not see it.

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
