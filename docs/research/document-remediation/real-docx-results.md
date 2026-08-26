# A real municipal Word file, end to end — and one of them comes out conformant

**Date:** 2026-08-25 · Option A, closed. Two genuine `.docx` files from the Town
of Manchester, NY, listed with hashes in
[`real-sources.md`](../../../experiments/document-remediation/real-sources.md)
and gitignored like the rest of `real/`. Structure only below; these are public
records naming real people.

**This is the first time the project has run a real client-format source through
the path.** Everything before was a PDF, or a synthetic HTML corpus converted to
ODF — two conversions from anything a client sends. That gap was named in
[prior-art-and-options.md](prior-art-and-options.md) as my own drift, and this
closes it.

## What the real sources actually contain

`[V]` Read directly from `word/document.xml`:

| | agenda | minutes |
|---|---|---|
| paragraphs | 39 | 226 |
| **heading styles** | **none at all** | `Heading1` ×23, `Heading7` ×2 |
| — of those, carrying text | — | 19 of 25 |
| tables | 0 | 0 |
| images | 0 | 0 |
| **`dc:title`** | **present** | **present** |
| `w:lang` | absent | absent |

**`[V]` Real municipal Word files vary enormously in quality.** One has no
headings whatsoever. The other has 25 heading-styled paragraphs — and 6 of them
are empty, and 2 are at level 7 among 23 at level 1.

## What came out

`[V]` `.docx` → LibreOffice → `.fodt` → `repair-source.py` → tagged + `PDFUACompliance` export → `FixScope` → `Inspect`:

| | agenda | minutes |
|---|---|---|
| structure tree | yes, 39 elements | yes, 369 elements |
| **title** | **yes** | **yes** |
| **language** | **`en-US`** | **`en-US`** |
| headings | none | **20 × H1, 1 × H6** |
| lists | 1 list, 2 items | 22 lists, 61 items |
| **veraPDF PDF/UA-1** | **COMPLIANT** | fails `7.4.2-1` only |

**`[V]` The agenda is UA-1 conformant, from a real municipal Word file, with zero
human input.** That is the first end-to-end success in this project on anything
that came from a real client.

## The finding that matters commercially

**`[V]` The title survives, and the clients' own toolchains lose it.**

2.4.2 (document title) is the single most common legal blocker in the real
corpus — **6 of 9 documents**, and it is the *only* thing blocking four of them.
Of the four real PDFs that arrived already tagged from Word/Excel toolchains,
**three carry no title at all** ([tagged-reality.md](tagged-reality.md)).

Both Word sources here **have** a title. Our path keeps it. Their path throws it
away.

`[V]` Language is the same story: absent as an explicit `w:lang` in both sources,
present as `en-US` in both outputs.

## The failures, and where they come from

**`[V]` The minutes fails one rule, `7.4.2-1`, and the cause is in the source.**
The document's own author used `Heading7` among `Heading1`s, so the exported
hierarchy skips levels. That is a real defect faithfully carried through — an
honest failure, not an invented claim. **Nothing in our path caused it and
nothing in our path should silently fix it**, because choosing what level that
heading really is would be an assertion.

**`[V]` The agenda has no headings because the source has none.** A meeting
agenda plainly has visual sections; the author never marked them. The output is
conformant and structurally thin, which is exactly the ceiling already recorded:
**the export cannot be better than what it is given.**

## Unexplained, and recorded rather than smoothed over

`[V]` The source has **25** heading-styled paragraphs, 19 carrying text. The
output has **21** headings. The mapping is neither 25→21 nor 19→21, so some empty
headings survived and some populated ones did not. **I have not accounted for
it.** It does not affect conformance here, and it is a real gap in the story.

`[V]` `Heading7` became `/H6`. PDF/UA-1 has no H7, so something had to give, but
the source said one level and the output says another. Whether that counts as an
assertion is not obvious and is not decided here.

## The caveat that limits all of it

**`[V]` This document class is the easy one.** Both files have **zero tables and
zero images** — so the two hardest assertion classes in the entire project, table
headers and alt text, were never exercised.

The real corpus contains a fee schedule with **144 tables and 2,036 data cells**.
Nothing here says what our path does with that from a real Word or Excel source.
`FixScope` reported `scopeSetToRow: 0` on both files because there was nothing to
act on.

**Agendas and minutes are the friendly case. The result is real and it is
narrow.**
