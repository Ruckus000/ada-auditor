# Global abstention — results


> **CORRECTED, 2026-08-25.** Numbers here were produced by a comparator that could not see figure under-tagging. Assertions across the 28 development documents are **13, not 8**, and DELIVERABLE is **6, not 8**. See [instrument-correction.md](instrument-correction.md).

**Date:** 2026-08-24 · 28 development documents: corpus (12) and holdout 1 (16).
**Holdout 2 was not run. Both of its checkpoints remain unspent.**

Measured against [abstention-prediction.md](abstention-prediction.md), which was
committed before the code was changed.

## The prediction was half right, and the half it got wrong matters more

| | Baseline | Predicted | **Actual** | |
|---|---:|---:|---:|---|
| False assertions | 16 | 8 | **8** | hit |
| Omissions | 29 | "rises" | **32** | hit |
| **DELIVERABLE** | **5/28** | **≤ 5** | **8/28** | **MISSED** |

The assertion prediction was exact, down to naming which five heading assertions
would survive: `05`, `h01`, `h12`, `h13`, `h16`. Those are the five that did.

The `DELIVERABLE` prediction was wrong, and it was wrong in the direction the
prediction itself named as falsifying:

> **A rise above 5 falsifies Finding 3, and the write-up must say so.**

It rose to 8. So: **Finding 3, as stated, is false.**

## Why it is false

Finding 3 claimed that gate 1 and gate 2 pull in opposite directions, because
`compare.mjs` derives the verdict from the whole defect list and an omission
blocks `DELIVERABLE` exactly as an assertion does. That part is still true. The
error was the step after it — the assumption that **abstention converts an
assertion into an omission**.

It does when the correct structure is genuinely missing. Document 12 lost five
spurious lists and was left with one where ground truth records two: an
assertion became an omission, exactly as predicted, and the document stayed
non-deliverable.

But where the over-detection *is* the whole discrepancy, removing it does not
leave a gap — it leaves a correct document. Three documents had exactly one
defect each, an invented heading, and deleting the invention satisfied ground
truth outright:

| | was | now |
|---|---|---|
| `07-complex-chart` | chart title tagged H2 | DELIVERABLE |
| `h03-captions-above` | two captions tagged H2 | DELIVERABLE |
| `h11-chart-labels-as-headings` | chart title tagged H1 | DELIVERABLE |

**Corrected finding: abstention cures over-detection but cannot cure omission.**
The gates oppose each other only for documents whose residue is missing
information — no alt text, no OCR, no title. For documents whose residue is
invented structure, both gates improve together, because the invention was never
information the document lacked. It was information it did not have and claimed
anyway.

## Finding 1 is also falsified on the development corpora

The 25% ceiling was measured three ways and held: corpus 2/8, holdout 1 3/12,
holdout 2 0/14. Against the deterministically reachable subset it is now:

| | before | after |
|---|---:|---:|
| corpus | 2/8 | **3/8** |
| holdout 1 | 3/12 | **5/12** |
| **development** | **5/20 — 25%** | **8/20 — 40%** |

Over-detection was not a floor. It was removable, and removing it moved the
number the "ceiling" was measured on by 15 points.

**This is measured on documents the rules were derived from.** R6's 24-character
threshold was set from this corpus, and holdout 1 has been development since its
checkpoints were spent. Whether 40% survives unseen adversarial documents is
exactly what holdout 2 exists to answer, and it has not been asked.

## Gates

Both still fail, and no gate was changed.

| Gate | Requirement | Result | |
|---|---|---|---|
| 1 | Zero false assertions | 8 | **FAIL** |
| 2 | ≥80% of the reachable subset | 8/20 — 40% | **FAIL** |

## What changed, per document

Six documents moved. Nothing regressed, on any measure.

```
06-images-uncaptioned    assert 1->0  omit 4->4   INCONCLUSIVE
07-complex-chart         assert 1->0  omit 0->0   NEEDS_REVIEW -> DELIVERABLE
12-kitchen-sink          assert 3->0  omit 2->5   INCONCLUSIVE
h03-captions-above       assert 1->0  omit 0->0   NEEDS_REVIEW -> DELIVERABLE
h08-table-spans-pages    assert 2->1  omit 0->0   NEEDS_REVIEW
h11-chart-labels...      assert 1->0  omit 0->0   NEEDS_REVIEW -> DELIVERABLE
```

veraPDF: one failure fixed (`12-kitchen-sink`, ua1 2→1) and **none introduced**
on any of the 28 documents, so the `Div`/`Span` retyping and the table removal
cost nothing at the machine-checkable layer.

### The eight that survive

| kind | n | why |
|---|---:|---|
| heading levels wrong at the right count | 3 | `05`, `h01`, `h16` |
| status stamps and bylines read as headings | 2 | `h12`, `h13` |
| decorative graphics tagged as Figures | 2 | `h04`, `h15` |
| one table found as two across a page break | 1 | `h08` |

`h01`'s "SUPERSEDED", `h13`'s "DRAFT" and "COMMERCIAL IN CONFIDENCE" and `h12`'s
byline all sit above ordinary prose and are structurally indistinguishable from
headings. `h01`'s own next paragraph reads *"The stamp above is a status marker
applied to the whole document"* — the document says so, in prose, and no
geometry rule reads prose. An all-caps rule would catch three of them and
destroy `h16`'s legitimate `STORAGE` and `RECORDS` headings, which is the
document authored to punish exactly that move.

## What review costs — the manifest

`manifest.mjs` turns every omission into the question a reviewer must answer. It
changes no verdict and reads the JSON `compare.mjs` already writes.

| | documents |
|---|---:|
| deliverable now | **8** |
| deliverable after N answers | **11** |
| blocked — needs OCR | 1 |
| unreviewable — carries an assertion | 8 |

**19 of 28 documents are reachable for 22 answers between them** — median 1
question per document, maximum 5. That is the number the business question needs:
not "40% deliverable" but "40% deliverable, and another 39% for about two
questions each".

Documents carrying an assertion are counted as unreviewable rather than as
expensive, and that is the point of separating the two defect kinds. A reviewer
can see and close an omission. An assertion is a wrong claim already in the
bytes with nothing to signal it is wrong, so a reviewer never knows to ask.
**The eight unreviewable documents are the constraint on this product — not the
22 questions.**

## Method note — the prediction caught a silently inert pass

The first run reported 3 assertions on the corpus, not the predicted 1, because
R6 and R7 never fired. Their lookup was keyed by `PDStructureElement`, and
PDFBox's `getKids()` builds fresh wrappers around the same underlying object on
every call, so two walks of one tree produce two sets of instances that never
compare equal. Every lookup missed, both rules were dead, and the pass reported a
clean run with a plausible-looking count.

Nothing in the pipeline would have caught that. `javac` was happy, no stage
failed, no validator complained, and the assertion total still fell — because
the caption fix, the list rule and the table rule all worked. **Only the
specificity of the registered prediction exposed it**: a general expectation
that "assertions should fall" was satisfied by the broken build.

That is now the seventh instance in this spike of a measurement problem
masquerading as a result, and the second where writing the claim down in advance
is what found it.
