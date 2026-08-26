# Real municipal documents — first contact

**Date:** 2026-08-24 · Nine PDFs from public municipal and state government
sites, listed with URLs and SHA-256 in
[`real-sources.md`](../../../experiments/document-remediation/real-sources.md).
The files themselves are gitignored.

This is condition 6 of [decision.md](decision.md) — *"before committing to a
product, run this same pipeline over real client documents"* — begun. It is
**not** the full experiment: nothing here has ground truth, so no assertion rate
was measured. What is measured is what needs no ground truth: does the pipeline
survive, and does machine conformance improve.

## Headline

| | |
|---|---:|
| Documents processed without error | **9 / 9** |
| veraPDF ua1 failures, before | 6,946 |
| veraPDF ua1 failures, after | **132** — 98.1% removed |
| **Documents reaching conformance** | **0 / 9** |
| Remaining failures **introduced by our own pipeline** | **10** |

98% of the failures are gone and not one document is deliverable. The
development corpus never produced that shape.

## Three things the synthetic corpus could not have told us

### 1. Demotion breaks the heading hierarchy — a defect in today's abstention pass

Three documents fail **7.4.2-1**, *"if any heading tags are used, H1 shall be
the first"* and levels shall not skip. All three are our doing:

| | before demotion | after |
|---|---|---|
| `nyc-notice-form` | `H1, H2, H3` | **`H3`** |
| `lacity-clerk-misc` | `H1, H1, H1, H2, H3, H2` | **`H1, H1, H1, H3, …`** |
| `newcastle-pc-hearing` | `H1` | *(none)* |

`Headings.java` argues that demotion is the safe direction because "demoting a
real heading costs an omission — a reader loses navigation and a reviewer can
see the gap." **That is incomplete.** Demoting a heading that sits *between*
two levels leaves the survivors skipping a level: remove the `H2` and the `H3`
now follows an `H1` directly. That is not an omission. It is a machine-detectable
conformance failure and a broken navigation hierarchy — a defect the pass
created, in a document that did not have it.

The 28 development documents never exposed this. Not one of their demotions
happened to sit between two levels. **One run of nine real documents found it.**

### 2. Caption extraction transferred at zero

| | development | real |
|---|---:|---:|
| figures seen | — | 43 |
| captions found | many | **0** |
| Alt cleared for want of one | — | **43** |

Caption extraction plus the clear-Alt policy was the largest single win of
Experiment 2 — placeholder alt text went 17→0 and 14→0. Across nine real
documents it found **no captions at all**, so all 43 figures had their Alt
cleared and four documents now fail **7.3-1** for undescribed figures.

The clearing is still right: `"image 1"` presented as a description is worse
than nothing. But the technique's contribution on real municipal documents is
so far entirely the clearing, and none of the describing.

### 3. Real PDFs fail PDF/UA in ways structure remediation cannot reach

Roughly half the surviving failures are nothing to do with the structure tree:

| rule | what it wants | docs |
|---|---|---:|
| 7.21.4.1-1 | fonts embedded | 2 |
| 7.21.4.2-2 | CIDSet identifies all CIDs | 2 |
| 7.18.3-1 | `/Tabs S` on pages carrying annotations | 2 |
| 7.21.5-1 | glyph widths consistent | 1 |
| 7.10-1 | optional content config has a `Name` | 1 |
| 7.20-2 | Form XObject content inside structure | 1 |

Our entire approach — tag, describe, finish — touches none of these. The
synthetic corpus has none of them either, because Chromium emits clean files.
**Real municipal PDFs come from Word, from scanners, and from form designers,
and they arrive already broken at the file level.** A product promising
"machine-verifiable PDF/UA" has to fix these too, or say plainly that it does
not.

## The document that got worse

`sturgis-agenda`, a 90-page council packet, was **already tagged** — 8,504
structure elements — and had exactly **4** ua1 failures, all font-level. After
our pipeline it has **28**.

The pipeline re-tags unconditionally. OpenDataLoader replaced a tree of 8,504
elements with one carrying 100 headings, 43 figures, 28 tables and 91 lists,
and the result is less conformant than what arrived. Nothing in the pipeline
asks whether the input is already tagged, because Experiment 1's corpus was
deliberately stripped to untagged and the case could not arise.

Five of the nine real documents arrived tagged. **This is not an edge case.**

## What the pipeline claimed, unverified

With no ground truth, these are counts of assertions nobody has checked:

| | |
|---|---:|
| `/TH` cells promoted | **195** (46 column, 149 row) |
| headings kept | 121 of 173 |
| tables untagged as not-tables | 24 of 60 |
| lists untagged | 34 of 152 |
| figures artifacted as decorative | 9 of 43 |

195 header relationships were asserted into nine documents and not one has been
checked against anything. On the holdout, per-cell checking of exactly this
technique is what turned a reported clean pass into 28 assertions. **These
numbers are not evidence that it worked. They are the size of the claim.**

## What this does not measure

No assertion rate, no `DELIVERABLE` count, no gate. Those need ground truth, and
hand-authoring it for real documents is both expensive and the conflict of
interest the comparator exists to remove — the party being graded writing the
answer key. The SHA-256 record in `real-sources.md` exists so that ordering can
at least be proven when it is written.

The 40% reachable rate from [abstention-results.md](abstention-results.md)
remains a development-corpus number, and nothing here confirms or refutes it.

## What it does establish

- The pipeline is **robust**: nine real documents, one of them 90 pages and
  8 MB, one a 3.5 MB scanner output, all processed without error.
- Machine conformance improves **enormously and insufficiently**: 98.1% of
  failures removed, zero documents delivered.
- Two of today's techniques have defects that 28 synthetic documents did not
  reveal and nine real ones did in a single run.

Condition 6 was the right condition.
