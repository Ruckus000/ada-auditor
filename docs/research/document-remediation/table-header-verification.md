# Verifying the 195 table headers

**Date:** 2026-08-24 · The liability test. Under WCAG **1.3.1 Info and
Relationships**, a wrong table header is not a missing fix — it is a
manufactured barrier, shipped with a confident report and invisible to every
machine check. veraPDF passes a document in which every data cell is marked a
header; we proved that on the synthetic corpus.

**Result: 4 of 195 headers are wrong. Two percent.**

## Where they were

Not where I expected. Two documents I planned to check carry **zero** headers —
`fordcity-fee-schedule` and `tml-statutes-table` have 4 and 15 detected tables
between them and `Tables.java` promoted nothing in either, which is the pass
correctly declining to guess.

| document | asserted `/TH` | verdict |
|---|---:|---|
| `ct-legal-notice` | **185** | correct |
| `sturgis-agenda` table 2 | 5 | correct |
| `orono-fee-schedule` | 1 | degenerate table, defensible |
| **`sturgis-agenda` table 1** | **4** | **wrong — inverted** |

185 of the 195 sit in a single document. That concentration is the h08 pattern
exactly, and it is worth noting as a property of the technique: it fires hard on
documents with consistent table typography and not at all elsewhere.

## `ct-legal-notice` — 185 correct

Nine tables sharing one template: a shaded header row reading *CGS § · Agency or
Official · Purpose · Frequency*, and a left column of statute citations.

Checked against the rendered page:

- **Header row → `TH scope=Column`.** The row is set in `ArialNarrow-BoldItalic`
  and shaded grey. Unambiguously a header row.
- **Statute column → `TH scope=Row`.** This is the case that deserved suspicion,
  because it is the same shape as h08's registration column. It is a textbook
  stub column: the row's unique identifier, leftmost, sitting under its own
  column header.
- **Counts reconcile.** Table 1: 4 column headers + 20 row headers = 24 `TH`,
  and 20 rows × 3 remaining cells = 60 `TD`. Inspect reports exactly 24 and 60.

**And R2 fired for the right reason, not by luck.** The statute citations render
blue and underlined because they are hyperlinks, which looked at first like they
would not be bold — in which case the stub rule should not have fired at all.
The font table for the page settles it: `ArialNarrow-Bold` covers 215 glyphs,
which is the table caption (~55) plus twenty citations averaging eight
characters (~160). The stub column genuinely is bold in the source. The rule
read the evidence it claims to read.

## `sturgis-agenda` table 1 — 4 wrong, and the mechanism is precise

```
row 0   [TH:Column] $582,277.70   $46,587.02   $582,337.70   $583,464.36
row 1   [TD]        Billing base  8% billing   A/R change    Payments
                                  fees                       reported
```

**The table is inverted.** The values are marked as column headers over their
own labels. A screen reader announces *"$582,277.70: Billing base"* — the number
heading the thing that names it.

Text extraction confirms the values precede the labels in reading order, so this
is a dashboard-style summary block — four KPI tiles with the figure on top and
its caption beneath — that OpenDataLoader tagged as a 2×4 table.

**Root cause in `Tables.java` R1:** *"the leading run of rows, from row 0, in
which every cell is bold"* is taken to be the header rows. In a KPI block the
emphasised row is the **values**. Bold marks emphasis, not header-ness, and
anchoring at row 0 converts that ambiguity into a confident wrong claim.

`Tables.java` already argues that bold alone is not enough and adds two
unanimity constraints for exactly this reason. Both constraints hold here — the
run is all-bold and there is a non-bold body row to contrast against — and the
answer is still wrong. **The missing constraint is semantic, not structural: a
row of pure currency figures is not a header row.** Recorded, not implemented;
no code changes until the decision.

Table 2 in the same document is the real data table — *Month · Billing Base ·
8% Billing Fee · A/R Change · Payment* over monthly rows — and is tagged
correctly. The technique got the actual table right and the summary box wrong.

## `orono-fee-schedule` — 1, degenerate

A two-row table whose header cell holds *"NEW DEVELOPMENT LAND USE / Per new
lot"* over a cell of four fee figures. The `TH` is header text over values, so
it is not wrong, but the "table" is an artifact of re-tagging collapsing 144
source tables into 4. Counted as defensible rather than correct.

## What this does and does not establish

**Does:** the header technique is substantially sound on real documents. 191 of
195 correct, and the four failures share one identifiable cause that is neither
random nor pervasive.

**Does not:** this is not an audit. `ct-legal-notice` table 1 was checked cell by
cell against the rendered page; tables 2–9 were checked structurally and share
an identical template, which is inference rather than inspection.

**And the standing caveat applies.** On holdout 1 this same technique was
hand-verified as correct by the party that wrote it, and per-cell checking later
turned that clean pass into 28 assertions. This check was run by that same party.
It is a signal, not proof.

## Consequence

The plan said: *if the headers are substantially wrong, `Tables.java` gets
disabled rather than fixed.* Two percent is not substantially wrong.
**`Tables.java` stays.** The inversion defect is recorded here and in the index
as an open item with a known fix.

The liability that gated a restart is measured, and it is smaller than feared.
