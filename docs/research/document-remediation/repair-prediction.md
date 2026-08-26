# Prediction, registered before building the two repairs

**Date:** 2026-08-25 · Written and committed **before** any repair code runs, per
[briefs/README.md](briefs/README.md) rule 5.

## Baseline, on the corrected instrument

Arm R+UA, 11 documents: **21 assertions, 13 omissions, 0 DELIVERABLE**
([instrument-correction.md](instrument-correction.md)). The 21 break down as
**13 wrong table scope · 4 meaningful images deleted · 1 data cell as header ·
1 reading order · 1 layout table as data · 1 extra figure**.

## Repair 1 — drop `alt=""` → decorative

`[V]` It caused all four image-deletion assertions. It is removed, not replaced.

**Why nothing replaces it.** An author who left `alt` empty because the image is
decorative and one who never filled it in are **byte-identical in the source**.
There is no deterministic rule that separates them, so the honest behaviour is to
do nothing and let the image export as a `/Figure` with no `/Alt` — a visible
`7.3-1` failure a reviewer can see.

## Repair 2 — fix the scope after export, do not destroy the header before it

The obvious repair was to restyle header-styled cells outside the header row so
they emit `/TD`. **Rejected**, on two measurements taken first:

- `[V]` `Table_20_Heading` carries `fo:font-weight="bold"`, so restyling strips
  bold from the client's row labels. Changing how a client's document looks is
  not remediation.
- `[V]` The row labels are genuinely `<th>` in the HTML source. **HTML can express
  a row header; ODF cannot.** Restyling throws away true information to avoid a
  false claim, when the false claim can be removed on its own.

So instead, after export: **a `/TH` that shares a row with any `/TD` heads that
row, and gets `Scope=Row`.** A row of nothing but `/TH` is a header row and keeps
`Scope=Column`.

`[V]` This is structural, not typographic, and it handles the two-row header in
`03-simple-table` correctly — rows 0 and 1 are all `/TH`, rows 2–4 are one `/TH`
among `/TD`s. `[V]` It is needed because the export emits **no `/THead`**, so
there is nothing else to distinguish a header row by.

**Note on stripping versus setting.** Removing `Scope` entirely is the purer
deletion, but ground truth records these cells as `Scope=Row`, so a stripped
scope still mismatches and still scores as an assertion. Setting `Row` is also
what a screen reader needs. The judgement involved is only *which direction a
header points*, not *whether a cell is a header* — LibreOffice already decided
that from the author's own explicit style.

## The prediction

1. `[H]` The scope repair removes **all 13** scope assertions on `03`, `04` and
   `12`, because ground truth records exactly `Scope=Row` for those cells.
2. `[H]` Dropping the alt repair removes the **4 deletion assertions** and
   introduces an **over-tagging assertion on `06`** — its five images carry
   `alt=""` and only four are meaningful, so with no repair all five become
   `/Figure` and one is extra. **Net on `06` is zero; the harm is not.** Deleting
   four meaningful images is far worse than tagging one decorative one.
3. `[H]` **`06-images-uncaptioned` cannot reach zero assertions by any
   deterministic repair.** The source is genuinely ambiguous. This is a real
   ceiling and it should be recorded rather than engineered around.
4. `[H]` Net: **21 → between 4 and 8**. The remaining floor is the data cell
   marked as a header, the reading order, the layout table, and whatever `06`
   settles at.
5. `[H]` Omissions **rise**, because `/Figure` with no `/Alt` is an honest gap
   and there will now be more of them.
6. `[H]` **DELIVERABLE stays 0.** Every document still fails something.

**Win:** assertions fall below Arm C's 1 — no. **Realistic win:** assertions fall
by more than half and every remaining one is explainable.

**Do not tune the comparator to make either repair look better.** If a repair
leaves an assertion, that is the result.
