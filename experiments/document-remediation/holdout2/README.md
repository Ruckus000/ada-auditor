# Holdout 2 — FROZEN

**Do not tune against these documents.** Generated, baselined and committed
before any experiment-3 work exists.

16 documents, a different subject domain from every earlier corpus so nothing
can pass by keying on incidental patterns. Regenerate with
`node ../generate-holdout.mjs holdout2 out/holdout2`.

## Why a second holdout

Holdout 1 is spent. Both its permitted checkpoints were used, its per-document
detail is known, and accept/reject decisions were taken against it. It is now a
**second development corpus** — free to tune against, worth nothing as evidence
of generalisation.

The corpus ladder is therefore:

| Corpus | Role |
|---|---|
| `corpus/` (12) | development |
| `holdout/` (16) | development — formerly holdout 1, spent |
| `holdout2/` (16) | **the holdout** |

## Rules of use

1. Tune on `corpus/` and `holdout/`. Run those freely.
2. **This runs at predefined checkpoints only** — the baseline below, and at
   most one midpoint plus one final evaluation.
3. **Do not inspect per-document failures here while developing.** Report the
   aggregate. Looking at which document failed and why turns a holdout into a
   development corpus.
4. **Do not alter these documents or their ground truth after seeing results**
   unless a fixture is demonstrably wrong — and then the correction, its cause
   and its effect on the numbers are documented in the fixture itself under
   `groundTruthCorrections`, and the decision belongs to someone other than the
   party who benefits from it.

Rule 4 is not theoretical. Two fixture defects distorted experiment 2's
headline: `h08`'s `rowHeaders` written as prose scored 28 correct promotions as
invented headers, and a missing `captionPresent` key inflated the gate
denominator. `validate-fixtures.mjs` now enforces the shape those defects
violated, and every fixture here passes it.

## The documents

| # | Document | Attacks |
|---|---|---|
| k01 | vector-chart-titles | Containment geometry — chart title, subtitle and axis labels are vector text larger than real headings, with no Figure or Table anywhere to contain them |
| k02 | nested-table | A table inside a table cell, each with its own headers |
| k03 | header-not-first-row | A note row above the header row, and a bold totals row below the body |
| k04 | caption-below-and-adjacent-tables | Two abutting tables, captions below both, caption 2 naming Table 1 |
| k05 | nested-lists | Three levels of nesting; the innermost has no list marker |
| k06 | footnotes | Superscript markers and a footnote block that resembles a footer |
| k07 | rotated-headers | Column headers set vertically, bottom-to-top, at body size |
| k08 | heading-is-a-link | Headings that are hyperlinks, plus version lines that look like subheadings |
| k09 | table-spans-pages | One 70-row table across several pages with the header repeated |
| k10 | hierarchy-inverted | The H1 is the smallest heading; H3s are larger than their H2 parents |
| k11 | same-image-two-meanings | Byte-identical photo used twice with different meanings; a logo that is both page furniture and content |
| k12 | definition-list | Bold terms that look like headings; two terms with contradictory second definitions |
| k13 | visual-form | A form with no form fields — labels and drawn boxes only |
| k14 | column-spanning-figure | A figure wider than its own caption, interrupting a two-column flow |
| k15 | vector-decoration | Size inversely related to significance, with the meaningful graphic drawn as vector |
| k16 | kitchen-sink | Three pages combining most of the above in a document that looks ordinary |

Four are deliberate carry-forwards of classes that survived experiment 2 —
k01 and k15 (no region to contain), k09 (page-spanning tables), k10 (heading
levels) — so a future technique is measured against problems already known to
be unsolved rather than only against new ones.

## Frozen baseline — current pipeline, recorded before any experiment-3 work

| | |
|---|---|
| DELIVERABLE | **3/16** |
| NEEDS_REVIEW | 9/16 |
| INCONCLUSIVE | 4/16 |
| **False assertions** | **11 across 8/16** |
| Omissions | 14 |
| Deterministically reachable | **14/16** (k01 and k15 blocked on uncaptioned figures) |
| Gate 1 — zero assertions | **FAIL** |
| Gate 2 — ≥80% of reachable | **3/14 = 21% — FAIL** |

Assertions: heading over-detection 4, table headers wrongly promoted 4, table
fragmented 1, table invented 1, heading levels disagree 1.

Raw: `../../docs/research/document-remediation/evidence/holdout2-baseline.comparison.json`
