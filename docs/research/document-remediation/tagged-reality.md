# What "already tagged" actually means on real documents

**Date:** 2026-08-25 · Option A, answered with real client toolchains rather than
a test machine. Structure only — no document content is quoted; these are
municipal records containing private individuals' details.

## The question

[prior-art-and-options.md](prior-art-and-options.md) recorded an `[R]` claim from
practitioner sources: **Word exports table headers as `/TH` but without a
`Scope`**, while LibreOffice supplies one that is wrong. If true, `FixScope.java`
corrects a defect we introduced by choosing LibreOffice, and a layer of our stack
is unnecessary.

Five of the nine real documents arrived already tagged, four of them from
Word/Excel toolchains. **They answer this directly, and they are real client
output rather than anything we produced.**

## The measurement

`[V]` Read with `Inspect.java`, which resolves the RoleMap — the trap that made
Brief A misread LibreOffice's output — so custom types mapped to standard ones
are counted correctly.

| document | producer | elements | headings | tables | `/TH` | `/TD` | title | lang |
|---|---|---:|---|---:|---:|---:|---|---|
| `tml-statutes-table` | Acrobat Distiller 8.1 / PDFMaker for Word | 1,255 | **0** | 1 | **0** | 408 | no | none |
| `orono-fee-schedule` | Adobe PDF Library 24 / PDFMaker for Excel | 3,044 | **0** | 144 | **0** | 2,036 | no | EN-US |
| `sturgis-agenda` | Diligent / ABCpdf, Word creator | 8,504 | **0** | 0 | **0** | 0 | yes | en-US |
| `newcastle-pc-hearing` | Adobe PDF Library 20 / PDFMaker for Word | 41 | 6 | 0 | — | — | no | EN-US |

Block-level composition:

```
tml-statutes-table    721 P,  1 Table          orono-fee-schedule  144 Table, 77 P, 1 Figure
sturgis-agenda      8,434 P,  nothing else     newcastle-pc-hearing 34 P, 5 H1, 1 H2
```

## What this settles

**`[V]` The `[R]` claim is wrong in the direction that matters.** Word's real
output does not emit `/TH` without a scope. It emits **no `/TH` at all** —
**zero across 145 tables and 2,444 data cells.** There is no scope to be right or
wrong about, because there are no header cells.

**`[V]` `FixScope.java` is not correcting a problem we created.** The concern is
withdrawn. Its rule remains sound and, on output like this, would have nothing to
act on — which is a fact about the input, not the rule.

**`[V]` "Already tagged" is not "accessible", and the gap is enormous.** These are
large, genuine structure trees — 8,504 elements in one case — composed almost
entirely of `/P`. A 90-page agenda has zero headings. A 15-page statutes table has
one table and no header cells. A fee schedule has 144 tables and not one header
row among them.

**This is the assertion problem at document scale.** A tree full of paragraphs
*claims* the document is structured. It satisfies the presence of a structure
tree, and it conveys nothing. `newcastle-pc-hearing` is the sharpest case: six
headings that open at `H2` and then run `H1 H1 H1 H1 H1` — a hierarchy that is
worse than none, because a reader navigating by heading level is actively
misled.

**`[V]` Our source path beats these clients' own toolchains.** Arm S produced
`03-simple-table` with a correct two-row header scoped to columns and three row
labels scoped to rows. Their own tools produced zero header cells on 144 real
tables.

**`[V]` Re-tagging already-tagged documents is defensible after all.** Open
question 3 asked whether the pipeline should preserve existing tags. On these
four there is nothing worth preserving.

## The honest qualification, which is the real finding

**This measures client *source* quality, not Word's exporter.** If an Excel range
was never defined as a table with a header row, PDFMaker cannot invent one. If a
Word document uses bold text instead of Heading styles, nothing downstream can
recover the outline.

So: `[V]` **the ceiling on the source-first path is real client source quality,
and on this evidence it is very low.** Four real municipal documents, produced by
mainstream tools, carry essentially no semantic structure to preserve.

That cuts against option B — remediating the source and handing it back has a far
larger job than "add a title" — and it does not touch option D at all, which
needs no source and no cooperation.

## Still open

`[V]` We have still never run a **real client `.docx`** through the path. These
are its PDF outputs, which is the strongest available proxy and not the thing
itself. Closing that needs a genuine municipal Word file, which means fetching one.
