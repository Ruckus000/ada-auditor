# Holdout 2

Canonical documentation lives with the corpus, at
[`experiments/document-remediation/holdout2/README.md`](../../../experiments/document-remediation/holdout2/README.md).
It is not duplicated here.

## Why it exists

Holdout 1 is spent — both permitted checkpoints used, per-document detail known,
accept/reject decisions taken against it. It is now a second development corpus.
Holdout 2 is the holdout.

## Frozen baseline

3/16 DELIVERABLE · 11 false assertions across 8/16 · 14 omissions ·
14/16 deterministically reachable · both gates FAIL.

Recorded against the pipeline as it stands at the end of experiment 2, so any
future technique is measured from here.

## The rule that matters most

Two fixture shape defects distorted experiment 2's headline — prose `rowHeaders`
scoring 28 correct promotions as invented, and a missing `captionPresent` key
inflating the gate denominator. Neither was visible by reading the fixture.
`validate-fixtures.mjs` now enforces that shape and every fixture in all three
corpora passes it.
