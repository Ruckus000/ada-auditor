# Holdout corpus — FROZEN

**Do not tune against these documents.** Generated and committed with a recorded
baseline *before* any Experiment 2 remediation code exists.

16 documents, each attacking a specific deterministic rule the remediation work
is likely to reach for. Regenerate with `node ../generate-holdout.mjs`.

## Rules of use

1. The development corpus (`../corpus/`) is where tuning happens. Run it freely.
2. **The holdout runs at predefined checkpoints only** — the baseline recorded
   here, and one final evaluation. Not iteratively.
3. **Do not inspect per-document holdout failures while developing.** Report the
   aggregate. Looking at which document failed and why turns the holdout into a
   second development corpus, and then it measures nothing.
4. **Do not alter these documents or their ground truth after seeing results**
   unless the fixture is demonstrably wrong. If that happens, the correction is
   documented explicitly in the commit and in `results.md`.

## Design

Each document targets a rule and, where possible, is **paired with another that
punishes the same rule applied naively**:

| Doc | Attacks | Paired with |
|---|---|---|
| h01 | large-bold-is-a-heading — a status stamp, two display figures, a pull quote | h02 |
| h02 | size-based heading detection — every heading is body size and weight | h01 |
| h03 | caption-is-below-the-image — captions sit above, distractor notes below | — |
| h04 | nearest-caption — one caption governs three images, a fourth follows | — |
| h05 | position-based repeat detection — one logo, four positions, two sizes | — |
| h06 | border-based table detection — ruled, half-ruled and bare tables in one file | — |
| h07 | single-header-row assumption — three levels of column header | — |
| h08 | per-page table detection — one 60-row table across three pages | — |
| h09 | two-column reading order — three columns plus a spanning banner | — |
| h10 | geometric interleaving — three sidebars beside a main column | — |
| h11 | relative-font-size headings — chart internals larger than real headings | — |
| h12 | title extraction where it *should* succeed — obvious visible title | h13 |
| h13 | title extraction where it must *not* fire — a DRAFT watermark is largest | h12 |
| h14 | whole-document OCR decisions — pages 1 and 3 have text, page 2 does not | — |
| h15 | size-based decorative classification — the large image is decoration, the small one is the subject | — |
| h16 | size-clustered heading levels — two H2s smaller than their own H3s | — |

The pairs matter more than the individual documents. **h12 cannot be passed by a
largest-text-wins rule without failing h13**, and h01/h02 are the same trap in
both directions. A technique that satisfies one and breaks its pair has not
worked.

## Generation

Same pipeline as the development corpus: semantic HTML rendered through Chromium,
which emits untagged PDFs. Images are reused from `../corpus/img/`.

`h14-mixed-scan` is the exception. Pages 1 and 3 render natively; the exhibit
renders from `h14-mixed-scan.scan.html` to PNG, becomes a one-page PDF via
`pdfbox fromimage`, and the three are assembled with `pdfbox split` and
`pdfbox merge`. Verified at 297 / 1 / 308 extractable characters per page.

## Baseline — recorded before any remediation

| | |
|---|---|
| DELIVERABLE | **2/16 — 13%** |
| NEEDS_REVIEW | 12/16 |
| INCONCLUSIVE | 2/16 |
| **False assertions** | **25 across 11/16 documents** |
| Omissions | 12 |

Raw: `../../../docs/research/document-remediation/evidence/holdout-baseline.comparison.json`
