# The answers pilot — predictions, registered before a person answers

**Date:** 2026-09-02. **Instrument:** the declared-answers channel at the
tree that adds `Finish --alt-file` and answer consumption in both lanes
(`claude/answers-channel-b`). **Baseline:** 31/78 real documents conformant
(`mechanical-wave-results.md`); blind run of 2026-09-02 over 150 rows: every
promise held, invented claims 0, silent gaps 0, drift 0.

## What the run says a person can close

From the run's per-document results, the real PDFs whose punch list is
ONLY operator-answerable and whose failing clauses are only `5-1` (the
identifier, earned automatically once nothing else fails) and `7.3-1`
(figures without descriptions):

| document | descriptions needed | other clauses |
|---|---:|---|
| n07 | 5 | none |
| n35 | 1 | none |
| n50 | 1 | none |
| r27 | 1 | none |

Eight descriptions across four documents. Every other non-conformant real
document carries at least one clause a description or a language cannot
close — a `PDF/UA` catch-all item, untagged content (`7.1-3`), fonts, a
signature — and stays where it is whatever a person answers.

The seven language-floor documents (n05, n22, n23, n30, r06, r10, r14) each
also fail `7.1-3` or a font clause: a declared language removes their
`7.2-24/33/34` clauses and greens none of them.

## Registered predictions

1. **Conformance:** with the eight descriptions supplied through the
   workbench and each document re-run, **≥ 3 of the 4** reach a compliant
   veraPDF verdict and earn the identifier: **31/78 → ≥ 34/78**. Falsified
   below 3.
2. **Invented claims 0, drift 0** on every re-run: each delivered `/Alt` is
   exactly the person's text (an independent qpdf read agrees), nothing
   else on any file moves.
3. **The language declarations** on the seven language-floor documents
   remove every `7.2-24`, `7.2-33` and `7.2-34` clause and no other clause;
   conformance on those seven does not change.
4. **Answer cost:** the eight descriptions take one person under fifteen
   minutes in the workbench, measured wall-clock from opening the first
   document to the fourth re-run — the number that decides whether the
   deferred crop step is worth building.

## How to run it (a person's part)

Inspect the four documents through the inventory, open each from its
"Answer N items" link, write the descriptions (the context line shows the
heading and neighbouring text; "open at page" opens the file at the
figure), Save, "Apply answers and run". For the seven language documents:
choose the language, Save, run. Record the four verdicts and the wall
clock in `answers-pilot-results.md`, corrections by kind.

The descriptions themselves must be a person's: nothing in this repository
composes one, and the harness's `invented-alt` facet is what would say so.
