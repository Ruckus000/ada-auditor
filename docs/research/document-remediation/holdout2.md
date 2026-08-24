# Holdout 2

Canonical documentation lives with the corpus, at
[`experiments/document-remediation/holdout2/README.md`](../../../experiments/document-remediation/holdout2/README.md).
It is not duplicated here.

## Why it exists

Holdout 1 is spent — both permitted checkpoints used, per-document detail known,
accept/reject decisions taken against it. It is now a second development corpus.
Holdout 2 is the holdout.

## Frozen baseline

0/16 DELIVERABLE · 23 false assertions across 12/16 · 20 omissions ·
14/16 deterministically reachable · both gates FAIL.

Re-recorded after the comparator gained reading-order and list checks: a baseline
taken with one instrument cannot be compared against a checkpoint taken with
another. The earlier 3/16 and 11 assertions were blind to both classes.

Recorded against the pipeline as it stands at the end of experiment 2, so any
future technique is measured from here.

## The rule that matters most

Two fixture shape defects distorted experiment 2's headline — prose `rowHeaders`
scoring 28 correct promotions as invented, and a missing `captionPresent` key
inflating the gate denominator. Neither was visible by reading the fixture.
`validate-fixtures.mjs` now enforces that shape and every fixture in all three
corpora passes it.

## Checkpoint accounting

**Both permitted checkpoints are unspent as of 2026-08-24.**

The pipeline was re-run against holdout 2 on 2026-08-24 and reproduced the
frozen baseline exactly. It was **not** counted as a checkpoint, by explicit
decision: no remediation code had changed since the baseline was recorded, so
the run could only confirm the toolchain, and only aggregates were read. A
checkpoint is spent when the holdout is used to evaluate a change, not when it
is used to verify the instrument.
