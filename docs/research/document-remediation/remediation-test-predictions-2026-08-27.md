# Predictions: the 120-document remediation test

**Registered 2026-08-27, before any real-document or Arm B run.** The
generated Arm A run has already happened (its findings are in
[PR #140](https://github.com/Ruckus000/ada-auditor/pull/140)); everything
below is prediction, committed so the results cannot be quietly
reinterpreted after being seen. The method is
[`repair-prediction.md`](repair-prediction.md)'s: hits and misses get counted
either way.

## Arm A — real municipal Word documents (target 30)

- **Delivered** (conversion completes): **≥ 90%**. LibreOffice's Word import
  is its maturest path; failures expected only from exotic legacy `.doc`
  producers.
- **Both instruments green**: **40–60%** (12–18 of 30). The dominant honest
  gaps, in order: **2.4.2** (untitled documents — municipal staff rarely set
  document properties) and **1.1.1** (figures without alt). Predicting the
  order matters more than the rate.
- **Fidelity**: headings preserved exactly in **≥ 95%** of delivered
  documents — the transcription thesis at scale. Where it fails, the source
  will show direct formatting rather than styles (which is honest zero-count,
  not loss).
- **Invented claims: 0** — the import-inflation fix just landed and the four
  language strata now pass; a real document reintroducing an invention would
  be a new bug class, not a recurrence.
- **Legacy `.doc`**: delivered rate lower, **~70%**, and fidelity ungraded
  (no XML to read) by documented limitation.

## Parity subset (10 documents, production)

- Local and production `Inspect` summaries **identical 10/10**. Hashes will
  differ (PDF timestamps); summaries may not. A summary mismatch would be a
  runtime-environment finding of the LibreOffice-bundle class, not noise.

## Arm B — the reopened PDF-repair question

Prior: **0 of 9** real documents reachable (`position-2026-08-25.md`).

- **Real PDFs (target 30)**: deliverable under the seven legal criteria
  **0–2 of 30 (≤ 7%)**. Blockers dominated by **2.4.2 title** and **1.1.1
  alt**, jointly **≥ 80%** of failing documents — same distribution as the
  nine, now powered.
- **Generated PDFs (30)**: deliverable **15–25%** — the corpus is
  adversarial by design; the deliverables will be the baseline-shaped strata.
- **The verdict this arm exists to produce**: either the STOP is confirmed at
  n=60 with a failure-class table, or a niche emerges (documents blocked
  *only* by the automatable subset). Prediction: **the STOP is confirmed**;
  the niche, if any, is under 10% of real documents.

## Adjudications pre-registered

- **a15-empty** (frozen key predicted refusal; it delivered): the delivery is
  defensible — an empty paragraph is structure — and the key was wrong. Will
  be recorded as a prediction miss against the key author, not a system
  defect, unless the delivered artifact fails veraPDF in a way an empty
  document should not.
- **a22 heading-skip instrument split** (Inspect clean, veraPDF fails):
  expected to persist; it is a true statement about the two instruments'
  different scopes, and transcription means the skip *should* survive.

## What would falsify the test itself

- The truth extractor disagreeing with delivered structure on documents whose
  conversion is visually correct (extractor bug, not system bug).
- veraPDF verdict instability across identical inputs.
- Any harvest document whose bytes change between truth extraction and
  conversion (hash-checked per run).
