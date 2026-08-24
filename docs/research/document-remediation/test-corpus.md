# Test corpus

The corpus documentation lives with the corpus, at
[`experiments/document-remediation/corpus/README.md`](../../../experiments/document-remediation/corpus/README.md),
and is canonical.

It is not duplicated here. Two copies of a document describing twelve files
would disagree within a week, and the copy under `docs/` would be the one nobody
regenerating the corpus thinks to update.

## What it covers

Twelve synthetic documents authored as semantic HTML and rendered through
Chromium, each with a `<name>.ground-truth.json` sidecar recording the intended
structure, so remediation is graded against what we authored rather than
against the tool's own output.

Two points from that README worth surfacing here, because they bear on how the
results should be read:

- **`page.pdf()` output is untagged** — verified against veraPDF. The HTML
  semantics do not reach the PDF; they are ground truth, not structure.
  OpenDataLoader must re-derive everything from geometry.
- **A clean HTML generator biases optimistic.** Real client documents carry
  generator quirks this corpus does not reproduce. A PROCEED result from it is
  an upper bound, not a prediction.
