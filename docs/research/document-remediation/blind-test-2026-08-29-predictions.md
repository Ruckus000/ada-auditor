# Document blind test — predictions, registered before the first run

Written before any document in `experiments/document-remediation/blind-corpus/`
reached the pipeline. The corpus and every key are hash-locked in the same
commit as this file. Counts and clause identifiers only — no document titles,
text, or URLs.

## Why this test exists

Every number the document pipeline has produced — 2/20 PDFs fully green, 23/31
Word documents green on both instruments, drift 0, local/production parity
10/10 — was measured on corpora the pipeline was **tuned against**. Those are a
training set now. They can confirm that nothing regressed; they cannot tell us
whether the thing works.

## The standard being measured against

A delivered document is **at baseline** when all five hold:

1. **Accurate disposition** — delivered where delivery is honest, refused where
   it is not (`signed`, `not-tagged`, `content-changed`, conversion failure).
2. **Zero invented claims** — no guessed language, title, structure, or alt text.
3. **Zero silent gaps** — every machine-detectable failure is fixed or voiced.
4. **Zero drift** — the product's conformance verdict matches an independent
   veraPDF reading of the same delivered bytes.
5. **A complete punch list** — every remaining human-judgment item named.

**Baseline is the success metric, and conformance is not.** The Matterhorn
Protocol 1.1 decomposes PDF/UA-1 into 136 failure conditions, of which **87 are
machine-checkable and 47 require human judgment**. No automated pipeline can
certify a PDF accessible, and the liability record is unambiguous about what
happens to vendors who claim otherwise: the FTC's $1M order against accessiBe
in 2025 was for claiming compliance its product did not deliver, and businesses
using that overlay were sued anyway. The disclosed shortfall is safe; the
overstated claim is not.

## The corpus

92 rows, in three strata.

| stratum | rows | ground truth |
|---|---|---|
| planted — door | 11 | by construction |
| planted — PDF | 35 | by construction |
| planted — Word | 18 | by construction |
| real — PDF | 19 | qpdf 12.4.1 + veraPDF 1.30.2 |
| real — Word | 9 | unzip + xmllint |

The 28 real documents were harvested from 25 hosts, **none of which appears in
the training manifests**, across four genres deliberately distant from the
municipal training set: university policy, court self-help forms, foundation
annual reports, and federal agency publications. Every one was checked by
SHA-256 against `prior-hashes.txt`, which holds all 430 documents any prior
campaign used.

## Registered predictions

### Dispositions

- **Refusals among real PDFs: 16 of 19.** Fourteen carry no structure tree at
  all; two are digitally signed. This is the single most important number in
  the run — it says the wild is mostly untagged, and the honest product refuses
  most of what it is handed.
- **Deliveries among real PDFs: 3 of 19.**
- **Deliveries among real Word documents: 9 of 9.** Conversion authors the
  structure, so the Word path should refuse nothing here.
- **Planted refusals: 8** — untagged (2), empty tree (1), marked-lie (1),
  signed (3), OLE-not-Word (1) — plus two probe rows (encrypted, no-pages) that
  must refuse but whose refusal kind is an open question.

### The five promises

- **Invented claims: 0.** Anything above zero stops the campaign.
- **Silent gaps: 0.**
- **Drift: 0.** Measured 11/11 agreement on the last corpus; the prediction is
  that it holds across 92.
- **Door leaks: 0.**
- **Missing punch items on core rows: 0.**

### Conformance, reported beside the metric and not as it

- **Fully conformant deliveries: 3 to 6 of the ~21 expected deliveries.** One
  real PDF (r01) is already UA-1 compliant on input and must stay that way.
- **Real PDFs failing 7.21.4 (fonts never embedded): at least 2.**

### What I expect to be wrong

Registered because a prediction that only lists successes is not a prediction.

1. **The junk-title rows.** Whether a docinfo title like an exporter's leftover
   is refused the way a junk *filename* is has never been decided. Both are
   probe rows.
2. **The heading-level vocabulary on real documents.** The 2.4.10 items are
   derived here from a qpdf walk of the structure tree; PDFBox may count
   differently, and a disagreement is a finding either way.
3. **The portfolio row.** Nothing in the pipeline reads inside an attachment. I
   expect a silent delivery, which would be the first genuine silent gap this
   corpus finds — the punch-list vocabulary has no word for "this document
   carries other documents nobody remediated".
4. **Suppressed-but-quiet clauses.** The suppression regex assumes one of our
   own items is saying the same thing. On real documents that assumption will
   not always hold.

## What this test cannot do

Stated here rather than discovered later.

- **One person authored both the pipeline and the keys.** The mechanisms —
  third-party-only key authoring, enforced by a test; hash-locking; corrections
  as scored overlays — bound the leak. Nothing proves it is zero.
- **The planted corpus is bounded by one imagination.** The 28 real documents
  are the only guard against unknown-unknowns, and 28 is thin.
- **Some Word keys transcribe LibreOffice's behaviour** rather than predicting
  it, because the converter is a pipeline component. Those rows are marked
  probe.
- **The harvest could be unconsciously steered** away from genres known to
  fail. The domain-disjointness rule cuts both ways and is the only defence.
