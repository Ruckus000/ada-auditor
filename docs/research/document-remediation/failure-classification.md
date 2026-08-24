# Phase 4 — classification of remaining failures

Written **before** any finishing code, so the category boundaries cannot be
drawn to flatter the result. Categories are as specified:

- **A** straightforward deterministic finishing operation
- **B** semantic decision requiring uncertain inference
- **C** substantial PDF structure manipulation
- **D** unsupported or unclear

**Only category A gets implemented.** Any category C proving necessary is the
kill criterion and means STOP.

## Every ua1 failure remaining after OpenDataLoader

| Rule | Fails | Docs | Requirement | Category |
|---|---|---|---|---|
| 7.2-34 | 7449 | 11 | Natural language for page content shall be determined | **A**, with a caveat below |
| 7.2-22 | 23 | 7 | Natural language for text in `Alt` shall be determined | **A**, same caveat |
| 7.2-24 | 6 | 3 | Natural language in annotation `Contents` shall be determined | **A**, same caveat |
| 6.2-1 | 12 | 12 | Catalog shall include `MarkInfo` with `Marked true` | **A** |
| 7.1-8 | 12 | 12 | Catalog shall contain a `Metadata` key | **A**, with a caveat below |
| 7.1-10 | 3 | 3 | Catalog shall include `ViewerPreferences` with `DisplayDocTitle` | **A** |

**Not one remaining rule concerns the structure tree.** Every one is a
document-catalog entry. That is the single most important fact in this spike so
far, and it is why the kill criterion has not fired.

## Category A — implemented

1. **`/MarkInfo << /Marked true >>`** on the catalog. Fixed value, no inference.
2. **`/ViewerPreferences << /DisplayDocTitle true >>`**. Fixed value.
3. **`/Lang` on the catalog.** Deterministic *write*; see the caveat.
4. **XMP metadata stream** carrying `pdfuaid:part=1` and, where a title already
   exists in DocInfo, `dc:title` copied from it. Copying is deterministic.

Four catalog writes. No structure element is created, moved, re-parented, or
altered.

### Caveat on language — read this before believing the numbers

The corpus PDFs carry no language at all: Chromium drops the HTML `lang`
attribute when it writes an untagged PDF. So `/Lang` has no in-document source
to copy from, and the value has to come from somewhere.

- Writing `/Lang` from a **value supplied as input** is deterministic — **A**.
- **Detecting** the language from content is inference — **B**, not implemented.

The finishing pass therefore takes the language as a required parameter, which
is what a real remediation service would do: the client knows what language
their document is in. **The operation is category A; the value is an input, not
a finding.** Any results table must be read with that in mind.

### Caveat on title

`dc:title` is copied from DocInfo `/Title` where one exists. Documents 10 and 11
were authored with no `<title>` element and therefore have none to copy.
**Inventing a title from visible content is inference — category B, not
implemented.** Those two documents are expected to remain non-conformant, and
that is the correct outcome rather than a gap to close.

## Category B — not implemented

- **Language detection** from document content.
- **Title inference** for documents 10 and 11 from their visible first line.
- **Alt text for figures** — documents 06, 08, 09 have meaningful graphics with
  nothing to extract from. Out of scope for this spike by instruction.

## Category C — not implemented, and would trigger STOP

- **Per-passage language marking.** Document 10 mixes English and French. A
  single catalog `/Lang` will satisfy veraPDF's 7.2-34 while the French passages
  remain incorrectly labelled English. Fixing that properly means writing `/Lang`
  onto individual structure elements — structure-tree surgery.
  **It is not implemented, and its absence will not show up as a failure.**
  This is the clearest illustration in the whole corpus of machine-checkable
  conformance being necessary but not sufficient.
- **A single `Document` root structure element.** `8.2.5.2-2` fails on all twelve
  under `wt1a` because OpenDataLoader's structure tree root does not contain one.
  It is not a ua1 rule, so PDF/UA-1 does not require it and the kill criterion
  does not fire. If the product ever targets WTPDF or PDF/UA-2 conformance, this
  becomes category C work and the conclusion changes.

## Category D — unclear

None identified.

## What this classification cannot see

`11-deliberately-inaccessible` carries eleven authored barriers including "click
here" link text, a sub-threshold contrast paragraph holding a real deadline, a
layout table, and text locked inside an image. **veraPDF reports none of them**,
because none is a machine-checkable PDF/UA condition. If that document reaches
a passing verdict it will be a correct machine result about a document that is
still unusable.

`09-scanned` currently has the fewest failures of any document because it has no
text. Failure count is not a proxy for remediability.
