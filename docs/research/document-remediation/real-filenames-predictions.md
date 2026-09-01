# Restoring the real filenames — predictions, registered first

The finding in [`title-gap-is-the-corpus.md`](title-gap-is-the-corpus.md): the
corpus posts every real document as a generated id (`n02.pdf`), the id matches
`JUNK_FILENAMES`, and the title chain's filename rung has therefore **never
fired on a real document** in any campaign. 22 of the 23 documents failing
`7.1-9` would have carried a title in production. The measurement recorded the
bias; the decision now taken is to remove it.

## The change

`scripts/doc-blind-test/run.ts` posts each **real** document under the basename
of its harvest URL — last path segment, query stripped, percent-decoded, which
is what a browser download and an operator upload both produce. The mapping
comes from the tracked provenance manifests
(`blind-corpus/real-names.txt`, `new-names.txt`); a real document with no row
falls back to its id, exactly as today. Planted rows are untouched — their
names are ours and part of their design.

**Nothing else moves.** Bytes on disk keep their id names, the hash lock
verifies the same bytes, keys are not edited, no product code changes,
`INSTRUMENT_VERSION` stays 11. This is the harness stating a fact about the
document it was hiding — not a synthetic name, which the recorded decision
forbids and keeps forbidding.

## Why the run cannot fatal on the improvement — checked before running

- The scorer's `invented-title` fires only when a key plants `titleText: null`
  or claims `already-titled` against `titleDeclared: false`. Real keys carry
  neither a `titleText` nor an `expected.title`; `filename-derived` against
  `titleDeclared: false` trips nothing, and `titleDeclared` stays honest — the
  documents still declare no title; the filename supplied one.
- `[V]` No real key requires `2.4.2` in `needs` or `gapCriteria`, so the title
  punch item disappearing breaks nothing.
- A key expecting `compliant: false` that receives a compliant document fires
  `unexpectedly-compliant`, which is **non-fatal by design** (`score.ts:394`).
- `[V]` All ten sole-blocker keys are `weight: probe` with empty `mustVoice`.

## Predictions

| | registered |
|---|---|
| real documents whose title provenance becomes `filename-derived` | **22** — exactly the 22 of `title-from-real-filenames.mts`; the 23rd stays `no-heading-to-copy` |
| documents with an existing title | unchanged, every one |
| newly conformant | **+10, exactly** {n02, n17, n42, n43, n44, n45, n46, n48, n49, r03} → 26/68 delivered |
| lane split | Word 14/26 → **21/26**; PDF 2/52 → **5/52** (3 pdf + 7 word in the ten) |
| clause-list change | the titled documents lose `7.1-9` and nothing else; no other document's clauses move |
| scorer | 10 non-fatal `unexpectedly-compliant` notes; **0 fatal findings**; all five promises hold; drift 0; invented claims 0 |
| key corrections owed after | 10 `conformance` rows, kind `scope-change`, evidenced by the independent checker |
| `INSTRUMENT_VERSION` | 11, untouched — no product code in this change |

If any document not in the ten becomes conformant, or any clause other than
`7.1-9` leaves a clause list, the change has done something it was not supposed
to do and stops for review.

## What stays true

The blind test measures a *harder* case than production in every other way, and
this change does not soften the instrument — it stops the instrument from
manufacturing a failure the product never made. A document whose real filename
is junk still gets no title: the junk table is the product's judgement and it
still runs. Derived titles appear only in gitignored run output; tracked files
keep carrying counts and hashes, never text.
