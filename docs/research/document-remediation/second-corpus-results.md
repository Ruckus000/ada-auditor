# The second blind corpus, and a retraction

50 real documents, 33 PDF and 17 Word, from 44 hosts sharing no domain with the
training manifests or the first corpus. Keys authored by qpdf, unzip, xmllint and
the veraPDF CLI only, hash-locked in `29fd773` before the product saw a byte.

## The retraction comes first

The first run reported **8 invented claims**. I attributed two of them to the
product and wrote that the Word converter had "fabricated 49 headings" on a
township's minutes, calling it "a manufactured barrier shipped with a confident
report".

**That was wrong. All 8 were defects in my answer keys. The product read all 50
documents correctly.**

The claim was also wrong a second time over, in the same review: I reported that
n37 had *lost* 12 headings in conversion. It had not. Those were empty
heading-styled paragraphs that `removeEmptyHeadings` deletes on purpose.

## What the keys were getting wrong

| documents | the key's reading | the truth |
|---|---|---|
| n03, n05, n21, n22, n30 | raw `/S` only | ISO 32000 requires a conforming reader to resolve `/RoleMap`; `Inspect.standard()` does |
| n42 | `word/document.xml` only | its one table is in `word/footnotes.xml` |
| n50, n41, n37, n39 | `w:pStyle` matching `/Heading(\d)/` | **outline level** is the OOXML heading signal |

The heading rule is the one worth keeping:

- **n50** declares its entire outline with **84 direct `w:outlineLvl w:val="2"`**
  on otherwise unstyled paragraphs and zero `HeadingN` anywhere in the body.
  `removeEmptyHeadings` strips the 35 empty ones, leaving **49** — exactly what
  was delivered, with the 49 texts corresponding 1:1 in document order.
- **n41** uses `contactheading`, which carries no outline level of its own and is
  `w:basedOn="Heading2"`. Verified: 9 uses, 0 direct outline levels.
  **34 + 9 = 43**, exactly what was delivered.

A style called `HeadingN` is merely the commonest way to acquire an outline
level. Matching the name and missing the definition is the same mistake as
reading raw `/S` and missing the role map: **reading a document more narrowly
than a conforming consumer does, then calling the difference an invention by the
product.** Three instances of one error, in one campaign.

## After the corrections

```
148 documents · exit 0 · every promise held
disposition 43/43 · doors 11/11 · invented claims 0
silent gaps 0 · drift 0 · punch items 0 missing
corrections 54 across 28 documents — 52 instrument defects, 2 scope changes
```

Every one of the 12 corrected rows now agrees with the product exactly.

**The 20% corrected share trips the protocol's own 10% warning**, and it stays
visible. Four campaigns in, the keys have been wrong far more often than the
product has, and that is the honest headline of this corpus rather than anything
about remediation quality.

## What the 50 documents actually showed

| | delivered | PDF/UA-1 conformant |
|---|---:|---:|
| Word → PDF | 17 | **7** |
| PDF → repaired | 28 | **1** |

Five PDFs were **refused as untagged** rather than tagged by inference. 234 punch
items across 45 delivered documents, median 2, dominated by `1.1.1` (115 — alt
text a person has to write). Median 4.0 s per document.

Converting Word reaches conformance about 40% of the time. Repairing an existing
PDF reached it **once in 28**. That is consistent with the recorded position that
PDF repair is transcription-only, now measured on documents nobody chose.

## What changed

- The key author resolves `/RoleMap` for PDFs, reads tables across every Word
  story part, and resolves a paragraph's **effective outline level** — direct
  `w:outlineLvl`, else the level of its style resolved through the `w:basedOn`
  chain — counting only paragraphs that carry text, which is what makes it agree
  with the delivered document rather than approximate it. After
  `extract-docx-truth.mjs:88-124`, which already recorded two of the three
  shapes; the `w:basedOn` chain defeated that implementation too.
- **`w19-outline-level-headings`**, a planted `core` row: headings declared only
  by direct outline level and by a `basedOn`-inheriting custom style, zero
  `HeadingN` anywhere, plus one empty outline-levelled paragraph so the expected
  count is 3 rather than 4. `docx-builders.mjs` could not previously express any
  of this, which is why the corpus could not catch it.

## Honest notes

- **I rewrote two locked keys mid-fix** by running the key author in default
  mode, which writes keys rather than recording corrections — the exact hazard
  the `--only` flag had been added for an hour earlier. Caught on `git status`
  and restored from the lock commit.
- **`counts.headings` is still a SOURCE count graded against an OUTPUT count**,
  while `author-real-keys.mjs` states in its own comments that predicting output
  structure from input structure is a category error. The non-empty outline rule
  makes the two agree across this corpus, but they remain different quantities.
  ~~Two rows still differ by one heading and are reported as non-fatal notes.~~
  **Retracted 2026-09-03.** The two rows (r28, r32) differed because their keys
  were never re-authored under the rule this document describes: the
  corrections run here was `--only=n`, and the `r` cohort kept the pre-fix
  answers from `5ad8352`. Under today's rule r32's key and the delivery agree
  (4), and r28's delivered twelfth heading is a described image the author's
  `<w:t>`-only test could not see. The same re-read found r23 and r30 one
  heading SHORT in delivery — a `TOCHeading` paragraph the import turns into an
  index title — which is the real loss, and a product finding. See
  `word-keys-2026-09-03.md`.
- **Not built:** a detector for headings whose text reads as prose. n50's author
  outline-levelled 49 body sentences, which is a real accessibility problem in
  the source and which the product now faithfully carries. Flagging it means
  judging authorial intent — the wall 1.4.1 hit — and would need its own
  feasibility measurement.
