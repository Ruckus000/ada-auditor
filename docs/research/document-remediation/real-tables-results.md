# Real tables, measured — and `FixScope` never fired

**Date:** 2026-08-25 · Prediction registered at `d9c900c`, **before** the first
conversion. Sources with hashes in
[`real-sources.md`](../../../experiments/document-remediation/real-sources.md),
gitignored. Structure only below.

## The headline, which is the thing I least wanted to be right about

**`[V]` `FixScope` fired 0 times. On every real document. All three.**

```
nj-audit-affidavit (Word)   {"scopeSetToRow":0,"keptColumn":0}
ks-city-budget (Excel)      {"scopeSetToRow":0,"keptColumn":0}
ks-township-budget (Excel)  {"scopeSetToRow":0,"keptColumn":0}
```

Every one of the 13 scope assertions it was built to remove came from an
**HTML-derived** corpus, where `<th>` imported as the bold `Table Heading`
paragraph style. **No real source produced that pattern**, because real Word
marks a header row with `<w:tblHeader>` and real Excel marks nothing at all.

**I built `FixScope` against a proxy.** The rule is correct and it is tested and
it removed 13 real assertions from our fixtures — and on real client documents so
far it has nothing to do. That is the third time this project has validated
against something it controlled, and the first time I did it myself after writing
the warning down.

It is not deleted. On a source that *does* mark header rows it is still the
difference between a right and a wrong claim, and it costs nothing when idle. But
it is **unproven on real input**, and it must be recorded that way rather than as
a win.

## What the real documents contain

`[V]` Read from the sources before converting anything:

| source | tables | `tblHeader` set | headings | title |
|---|---:|---:|---|---|
| `nj-audit-affidavit.doc` | 1 (5 rows) | **0** | — | yes |
| `nj-revenue-checklist.doc` | **0** | — | — | — |
| `nj-auditor-report.docx` | **0** | — | — | — |
| `nj-cola-ordinance.docx` | **0** | — | — | — |
| `nj-budget-cap-res.docx` | **0** | — | — | — |

**`[V]` Four of five real government Word documents contain no table at all**, and
**no publicly published municipal Word file with substantial tables could be
found.** Municipalities publish PDFs, not sources. That is a small finding with a
large commercial implication, and it bears directly on the unanswered question of
whether clients even hold the files this whole path depends on.

## Word, with a real table

`[V]` `.doc` → Writer → `repair-source.py` → tagged + `PDFUACompliance` →
`FixScope` → `Inspect`:

| | result |
|---|---|
| structure tree | yes, 73 elements, 2 pages |
| title / language | **yes** / **`en-US`** |
| headings | 2 × H1 |
| table | 1 table, 5 rows, **`/TH` = 0**, `/TD` = 10 |
| **veraPDF PDF/UA-1** | **COMPLIANT** |

**`[V]` It is conformant with a table that has zero header cells.** PDF/UA-1 does
not require them, so a data table with no header relationships passes clean.

**That is the assertion problem wearing a certificate.** "UA-1 conformant" is a
much weaker claim than it sounds, and if we ever put that phrase in front of a
client it will need this sentence next to it.

## Excel — the class that matters most

`[V]` `.xlsx` → Calc → same filter options:

| | `ks-city-budget` | `ks-township-budget` |
|---|---:|---:|
| structure tree | yes, 6,769 elements | yes, 6,989 elements |
| pages | 78 | 73 |
| tables | 78 | 73 |
| **`/TH`** | **0** | **0** |
| `/TD` | 2,566 | 2,669 |
| headings | 0 | 0 |
| title | yes | **no** |
| figures / with `/Alt` | 16 / **0** | 16 / **0** |
| UA-1 | fails `7.3-1`×16, `7.2-42`×26, `7.2-43`, `7.18.1-2`, `7.18.5-2` | same plus `7.1-9` |

**`[V]` Calc does produce a large, genuine structure tree** — the `[R]` claim that
PDF/UA is Writer-only was too strong. **But it produces zero header cells across
151 tables and 5,235 data cells.**

**`[V]` That is precisely what the client's own toolchain produced.**
`orono-fee-schedule` — Acrobat PDFMaker for Excel — is 144 tables, 2,036 cells,
**0 `/TH`** ([tagged-reality.md](tagged-reality.md)).

> **For spreadsheets, our path is no better than what the client already has.**

The bar was *"beating the 0 of 145 the clients' own tools manage."* We matched it
exactly and did not beat it.

## Prediction, checked line by line

**1. `FixScope` fires 0 times on real Word — HIT `[V]`.** And on real Excel too.
The uncomfortable one, and the headline.

**2. A Word table with `tblHeader` set produces `/TH` at `Scope=Column` —
UNTESTED, and that is the finding.** **No real source set `tblHeader`**, so the
mechanism could not be exercised on real input at all. Testing it would mean
authoring a fixture, which is exactly the move that produced this situation.

**3. Most real Word tables will not set `tblHeader` — HIT `[V]`.** The one real
table has none: 0 `/TH`, 10 `/TD`. **The ceiling is the author, again.**

**4. Calc produces no usable structure tree — MISS on the tree, HIT on the
semantics.** It produces 6,769 elements and 78 tables. It produces no header
cells whatsoever. The tree exists and carries nothing a screen reader can
navigate a table by.

**5. Title and language survive — SPLIT.** Both survive from Word and from
`ks-city-budget`; `ks-township-budget` comes out with **no title**, and its
source has none to copy. `repair-source.py` correctly declined rather than
inventing one.

**6. Neither output is UA-1 conformant — MISS on Word, HIT on Excel.** The Word
document is conformant. See the caveat above about what that is worth.

**Score: 2 clean hits, 1 untestable, 1 split, 2 partial/misses.**

## What this changes

**`[V]` The source path splits cleanly by format, and the split is not subtle.**

- **Word →** works. Titles, language, headings, lists survive; conformance is
  reachable. Two for two on real files.
- **Excel →** does not. 151 real tables, zero header cells, no better than the
  incumbent.

Since fee schedules, budgets and rate tables are overwhelmingly spreadsheets —
and `orono-fee-schedule` is exactly that — **a large and commercially important
share of municipal documents is not addressed by this path at all.**

Nothing here is a product recommendation. But the A/B/C/D/E choice in
[prior-art-and-options.md](prior-art-and-options.md) should be made knowing that
option B covers Word documents and not spreadsheets.
