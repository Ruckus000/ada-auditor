# Evidence

Per-phase `summary.json` from `experiments/document-remediation/validate.mjs`:
one row per document, carrying page count, byte size, and for each of the two
veraPDF flavours (`ua1`, `wt1a`) the compliance verdict, passed and failed check
counts, wall time, and every failing rule with its clause-test id and failure
count.

Every number in `results.md` traces to a row here.

The full veraPDF reports these summarise — roughly 1.2 MB per phase — are not
committed. They are regenerable: `node validate.mjs <pdfDir> <outDir>`. The
summaries carry the rule ids and counts, which is the evidence; the raw reports
carry per-node detail that no conclusion rests on.
