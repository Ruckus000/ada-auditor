# Prediction, registered before touching a real table-bearing source

**Date:** 2026-08-25 · Committed **before** the first conversion, per
[briefs/README.md](briefs/README.md) rule 5.

## Why this run exists

[real-docx-results.md](real-docx-results.md) got a real municipal Word agenda to
UA-1 conformance with zero human input, and recorded its own limit: **both files
had zero tables and zero images**, so the two hardest assertion classes were
never exercised. `FixScope` reported `scopeSetToRow: 0` because there was nothing
to act on.

`orono-fee-schedule` — **144 tables, 2,036 data cells, zero `/TH`**, from Acrobat
PDFMaker for Excel — is the class that has to survive.

## The prediction I least want to be right about

**1. `[H]` `FixScope` fires 0 times on the real Word file.**

Every one of the 13 scope assertions it was built to remove came from an
**HTML-derived** corpus, where `<th>` imported as the bold `Table Heading`
paragraph style. Real Word marks a header row with `<w:tblHeader>` — a different
mechanism entirely.

**If this holds, `FixScope` corrects a defect that exists only in our fixtures,
and I built it against a proxy.** That is the same error this project has now
recorded twice: *"validating against a proxy we controlled."* It would not make
the rule wrong; it would make it unnecessary, which is worse, because it is code
we would maintain for nothing.

## The rest

**2.** `[H]` A Word table **with** `<w:tblHeader>` set produces `/TH` at
`Scope=Column`, correctly — ODF has `table:table-header-rows` and the corpus
already proved that mapping.

**3.** `[H]` **Most real Word tables will not set `tblHeader` at all**, giving
0 `/TH` and an honest omission, matching `orono-fee-schedule`. **The ceiling is
the author, again.**

**4.** `[H]` **Calc produces no usable structure tree**, or one with no table
semantics. `[R]` LibreOffice's PDF/UA implementation is *"currently done only for
Writer"*. If so, fee schedules, budgets and rate tables — a large share of what
municipalities publish — are **unreachable through this path**, which is a
scoping finding rather than a defect.

**5.** `[H]` Title and language survive from both formats, as they did from Word.

**6.** `[H]` **Neither output is UA-1 conformant.** The agenda passed because it
was trivial; a table-heavy document has more ways to fail.

## Win and kill

**Win:** a real table-bearing source yields correct `/TH` with correct scopes,
beating the **0 of 145** the clients' own tools manage.

**Kill for the Excel case:** Calc emits no structure tree. Record and stop.

## What this run may not do

**No new repair code.** If a defect appears, it gets recorded. Building a second
`FixScope` against a single real document would repeat the exact mistake this run
exists to test for.

**No ground truth, no `compare.mjs`.** These files have no fixtures, and the
guard that makes `compare.mjs` throw without one is what keeps it from ever
printing real municipal content into `comparison.json`. It stays.
