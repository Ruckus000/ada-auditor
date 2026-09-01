# When the author typed "decorative", what did they mean? — criteria, registered first

Registered before the measurement runs and before any product code changes, so
what follows is a test rather than a fitting exercise. Counts and outcome words
only: no alt string is printed, no document is named beyond its corpus id.

## The defect this is aimed at

`7.3-1` is **not** in r04's or r05's veraPDF residual. veraPDF accepts their
`/Alt` strings; the 153 punch items on those two documents come entirely from
our own F30 predicate, and every one of them says:

> `alt text is a placeholder, not a description (WCAG F30) — write one`

`PLACEHOLDER_ALT` (`src/domain/document-remediation.ts:1217`) holds nine words,
and three of them — `decorative`, `spacer`, `blank` — are not the same kind of
thing as `image`, `picture` or `photo`. The latter are an exporter leaving junk
in a field. The former read as an author saying the graphic carries nothing.

If that reading is right, the instruction is wrong: the remedy for an image the
author declared decorative is to artifact it in the source, not to write a
description for it. **The item is not in doubt — only the sentence.**

## What is NOT being proposed

- **No item is removed.** The criterion stays `1.1.1`, the count stays 153, no
  clause stops being voiced. `repair-results.md` records a temptation to soften
  a figure check to report a better number and refuses it; this is the opposite
  move, and it must not be allowed to become that one.
- **Nothing is artifacted.** Acting on the word would be a structural write that
  `contentChanges` refuses, and an assertion on a client's bytes off a single
  word. The item stays advisory.
- **`isPlaceholderAlt` does not move.** "Decorative" *is* a placeholder under
  F30 — it is not a description. The predicate is right.

## The measurement

Per delivered real document, over the `/Alt` strings our own reading already
classifies as placeholders:

1. the count of each of `decorative`, `spacer`, `blank`;
2. the number of **distinct** raw strings in that document.

## Decision rule, committed before the numbers are known

1. **`decorative` is included unconditionally.** It is the accessibility term of
   art for "this carries no information", and it is the word Word's own control
   is labelled with.
2. **`spacer` and `blank` are included only if they occur in a document that
   also uses `decorative`** — i.e. one author using one family of
   "no description needed" markers. Occurring alone, they describe appearance
   rather than declaring intent, and they stay on the existing F30 message.
3. **If a document's strings collapse to one distinct value**, record that it is
   a template convention rather than 52 or 101 separate judgements. This does
   **not** change the remedy — the advice is right either way — but a convention
   is weaker evidence of authorial intent than a per-image decision, and the
   results must say which one this is.
4. **`SUMMARY_HEADER_BUDGET` is not raised.** r05 carries 101 items and sits
   ~283 bytes under it. The replacement wording is measured on r05's real header
   before and after; if it does not fit, the wording shrinks.

## Predictions

| | registered |
|---|---|
| items whose sentence changes | 153, across exactly 2 documents (r04 52, r05 101) |
| documents whose conformance changes | **0** — r04 and r05 each fail four other clauses |
| punch-item criteria multisets, any document | **unchanged**, every one |
| gap strings | unchanged — `gapsIn` is not touched |
| existing tests broken | **0** |
| `INSTRUMENT_VERSION` | stays 11 — same criteria, same item count, only wording |
| blind run promises | all five hold; 0 regressed |

**The scorer cannot see this change.** `ourCriteria()` maps `needs` to
`n.criterion` before comparing, so criteria are identical by construction and a
green scorecard proves nothing. Verification is a direct before/after diff of
`summary.needs` item text on r04 and r05, plus the r05 header byte count.

If a criteria multiset moves on any document, the change has done something it
was not supposed to do, and it stops rather than having its expectation edited.
