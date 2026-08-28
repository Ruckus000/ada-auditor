# PDF repair, measured: what transcription actually buys

**Date:** 2026-08-28. Twenty real municipal and state PDFs through the
**shipping path** — `repairPdfBytes`, the same function the routes call — with
veraPDF UA-1 read before and after, per document. Predictions were registered
in [the Phase 0 file](pdf-repair-2026-08-28-predictions.md) and scored
[there](pdf-repair-2026-08-28-phase0.md).

Structure only: counts, clause identifiers, provenance kinds.

## The result

| | |
|---|---:|
| documents | 20 |
| repaired | **11** |
| refused as untagged | **9** |
| failing UA-1 clauses removed, in total | **32** |
| documents fully green on both instruments afterwards | **1** |
| documents where repair **added** a failing clause | **1** |

The repaired/refused split is 55/45 — exactly the tagged share Phase 0
measured, which is the point: repair runs on documents with a structure tree
and refuses the rest by policy, not by accident.

**Read the headline honestly. Transcription-only repair does not make
municipal PDFs conformant.** One document of twenty came out green. What it
does is remove about three failing clauses from each document it touches and
leave the remainder named.

## What repair removed, and what it cannot

| clause removed | documents | what it is |
|---|---:|---|
| 5-1 | 9 | PDF/UA identifier in XMP |
| 7.1-10 | 6 | ViewerPreferences/DisplayDocTitle |
| 7.1-9 | 5 | document title |
| 7.18.5-2 | 4 | link alternate description |
| 7.18.1-2 | 4 | link annotation tagging |
| 7.18.3-1 | 2 | page tab order |
| 6.2-1 | 1 | MarkInfo/Marked |
| 7.1-8 | 1 | metadata stream present |

| still failing afterwards | documents | why it is not ours to fix |
|---|---:|---|
| 7.3-1 | 4 | figures with no description — **punch-list item**, a person must write it |
| 7.21.4.1 / 7.21.4.2 | 4 | fonts never embedded by the producer |
| 7.1-3 | 4 | page content neither tagged nor marked as artifact — structural, and inferring it is what the STOP forbids |
| 7.18.4-1 | 3 | link annotation structure |

Titles came out **filename-derived 6, already-titled 4, transcribed from the
document's own first heading 1** — the distribution Phase 0 predicted, with
the heading rule firing once because tagged municipal PDFs carry almost no
heading structure.

## The one document repair made worse, and why it stays that way

`tml-statutes-table` went from nine failing clauses to five, and **gained
7.2-24** — "natural language in the Contents entry for annotations shall be
determined". The cause is our own fix: `Finish` transcribed the link's URI
into `/Contents`, closing 7.18.5-2 and 7.18.1-2, and an annotation that now
*has* a Contents entry must have a determinable language. The document
declares none.

Three ways to make that number go away, and two are dishonest:

- give the annotation a language — inventing a fact about the document;
- stop writing `/Contents` when no language is declared — removing something
  a screen-reader user genuinely benefits from, to improve a score.

So it stays. The document is strictly better off (nine failures to five), and
**the root cause is already reported**: its `3.1.1` gap says the source
declares no language. Supplying that one fact would close three clauses at
once (7.2-24, 7.2-33, 7.2-34). Recorded here because a repair that adds a
failing clause is exactly the kind of thing a vendor's report quietly omits.

## Follow-up this measurement earned

**Make "declare the document's language" a punch-list item.** It is currently
a gap string (`3.1.1`), which states a fact rather than asking for work — and
this run showed one missing language blocking three UA-1 clauses on a single
document. Two documents in the sample are affected. Not built here: it
changes the punch-list vocabulary and so bumps `INSTRUMENT_VERSION`, and it
deserves its own change rather than riding along inside this one.

## What a client can be told

For a PDF with a structure tree: *we repaired the catalog facts your document
already stated — its title, its language, where its links go — and here is the
list of what still needs a person.*

For one without: *this file has no structure to transcribe. Send us the Word
document it came from and we will convert that instead, or it needs tagging by
a person.* Nine of twenty land here, and the inventory already surfaces the
Word source when one exists.

Neither sentence is "your PDFs are fixed", and this file exists so that
sentence never gets written.
