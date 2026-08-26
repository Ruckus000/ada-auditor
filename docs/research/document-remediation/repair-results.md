# Two repairs, measured — 21 assertions to 7, and the first clean document

**Date:** 2026-08-25 · Prediction registered in
[repair-prediction.md](repair-prediction.md) at `212b3b6`, **before** either
repair was built. Scored with the corrected comparator (`c951e3a`). Raw output in
[evidence/armS-repaired.comparison.json](evidence/armS-repaired.comparison.json).

## Result

| | Arm C (pipeline) | Arm R+UA (Brief C, corrected) | **Arm S (repaired)** |
|---|:--:|:--:|:--:|
| **assertions** | 1 | 21 | **7** |
| omissions | 17 | 13 | 25 |
| **DELIVERABLE** | 2 | 0 | **1** |

`[V]` **`03-simple-table` comes out with zero defects and UA-1 compliant** — the
first document this project has delivered clean from a source:

```
TH Depot           scope=Column  row=0     TH Northern   scope=Row  row=2
TH Review period   scope=Column  row=0     TH Southern   scope=Row  row=3
TH Q1..Q4          scope=Column  row=1     TH Coastal    scope=Row  row=4
```

A two-row group header scoped to columns, three row labels scoped to rows, title
present, language present. Nothing invented.

## What the scope repair does, and what it refuses to do

`[V]` 13 cells across `03`, `04` and `12`. **All 13 scope assertions gone.**

**The obvious repair was rejected on two measurements taken first.** Restyling
the offending cells in the source so they emit `/TD` would have worked, and:

- `[V]` `Table_20_Heading` carries `fo:font-weight="bold"`. Restyling strips bold
  from the client's row labels. **Changing how a document looks is not
  remediating it.**
- `[V]` Those cells are genuinely `<th>` upstream. **HTML can express a row
  header; ODF cannot.** Restyling discards true information to avoid a false
  claim, when the false claim can be corrected on its own.

So the scope is corrected after export by a rule that reads **what the table is,
not what it looks like**: a `/TH` sharing a row with any `/TD` heads that row. A
row of nothing but `/TH` keeps `Scope=Column`.

`[V]` That handles the two-row group header in `03` correctly — rows 0 and 1 are
entirely `/TH`, rows 2–4 are one `/TH` among `/TD`s — which a "row 0 only" rule
would get wrong. `[V]` It is necessary because the export writes **no `/THead`**.

**Every heading heuristic this project has killed inferred meaning from
appearance. This one reads structure**, and it never creates or removes a `/TH` —
the author already decided that in the source. Only the direction is corrected.

## What the image repair does: nothing, deliberately

`[V]` The `alt=""` → decorative repair is **deleted, not replaced.** It caused
all four image-deletion assertions, and on `06-images-uncaptioned` it removed all
four meaningful images while eight were still drawn on the page.

**No rule can replace it.** An author who left `alt` empty because the image is
decorative and one who never filled it in are byte-identical in the source. The
images now export as `/Figure` with no `/Alt` — a visible `7.3-1` failure.

**A gap a reviewer can see beats a deletion nobody can.**

## Prediction, checked line by line

**1. All 13 scope assertions removed — HIT `[V]`.** `03` 3→0, `04` 5→1, `12` 7→1.

**2. Deletions removed, over-tagging appears on `06` — HIT, and wider than
predicted.** The over-tagging appears on `05`, `06`, `11` **and** `12`, not `06`
alone. Same mechanism, three more documents.

**3. `06` cannot reach zero by any deterministic repair — HIT `[V]`.** It trades
one assertion for another, and the source cannot say which images are decorative.

**4. Net 21 → between 4 and 8 — HIT `[V]`.** Seven.

**5. Omissions rise — HIT `[V]`.** 13 → 25, which is the honest half of the
trade: figures with no alt are now visible gaps instead of silent deletions.

**6. DELIVERABLE stays 0 — MISS.** It is 1. `03-simple-table` came out with no
defects at all, which I did not expect from any document on this path.

**Score: 5 hits, 1 miss.**

## The 7 that remain

| document | assertion | class |
|---|---|---|
| `04-difficult-table` | a data cell marked as a header | exporter derives `/TH` from a style the author applied to a data cell |
| `05`, `06`, `11`, `12` | 1, 1, 1 and 4 extra `/Figure` | **the `alt=""` ambiguity — no deterministic fix exists** |
| `08-slide-layout` | reading order out of sequence | untriaged |
| `11-deliberately-inaccessible` | layout table tagged as data | `[V]` ODF cannot mark a table presentational |

**`[V]` Five of the seven are one ceiling**, and it is a property of the source
format rather than of the exporter or the repair. Two are single, separate
defects.

## A temptation refused, recorded so it stays refused

The five over-tagging assertions read *"decorative or repeated graphics described
as content"*, and nothing is being described — these are `/Figure` elements with
no `/Alt` at all. It would be easy to soften that check and report a better
number.

**The check is right and stays.** A screen reader still announces a graphic where
there is nothing meaningful, which is a false claim, merely a milder one than
deleting a real image. The registered prediction said *"do not tune the
comparator to make either repair look better"*, and this is what that meant.
