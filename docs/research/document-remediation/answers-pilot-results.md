# The answers pilot — results

**Date:** 2026-09-08, answered; the three Word documents re-run on the same day
once the defect this pilot found was fixed. Predictions:
`answers-pilot-predictions.md`, registered 2026-09-02, before any answer was
written.

**Instrument: the app built and served locally, not the deployment.** Corrected
2026-09-04, before the first answer, when the four documents were looked at
rather than assumed. Production was verified that day and is sound — the alias
serves `dpl_7sAZcBR7tWxTfNLmk4rjqVhobPCF`, the deployment Vercel recorded on
`18b1a28` (the PR #205 merge), `/api/ready` answers `ready`, `/remediate`
answers 200, the document routes answer 401 unauthenticated and a bogus share
token answers 404 — and it still cannot host this pilot:

- **Three of the four are Word sources** (n35, n50, r27; only n07 is a PDF).
  Closing them means converting with the answers, and conversion needs
  LibreOffice, which a deployment does not carry by design — the split-by-weight
  decision, 794 MB beside a function. The console says so in its own words on a
  deployment: *"conversion runs where LibreOffice is installed, and this
  deployment does not have it."*
- **n07 is 4.9 MB**, over the 4.5 MB request body a Vercel function accepts,
  so its upload would never reach a route there. By URL it would, but that
  changes nothing for the other three.

So the pilot runs against this repository's own build (`npm run build`,
`npm start`) with LibreOffice and a JDK on the host, writing through the same
`DATABASE_URL` the deployment uses — the same code at the same commit, with the
converter present. The one thing the local instrument does not prove is
reachability, and that is what the production check above is for.
`CHAOS_ENABLED` is set in the local environment; it is read only by the audit
run handler (`api/_lib/chaos.ts`, `audit-run-handler.ts`) and reaches no
document route, so it does not touch these numbers.

**What is recorded here and what is not.** Counts, ordinals, verdicts and
clause ids. Never a description's text: the descriptions are a person's, they
name what is in a client's figures, and the harness's `invented-alt` facet is
the only reader they get. The wall clock is the one number this pilot exists
to produce.

## Numbers

Fill every cell from the workbench and the inventory; the scorer fills the
last two rows from the delivered bytes.

| measure | measured | prediction | outcome |
|---|---:|---|---|
| documents answered with descriptions | 4 of 4 (n07, n35, n50, r27) | 4 | — |
| descriptions written | 8 of 8 | 8 | — |
| wall clock, the eight descriptions | ≤ 2 min of save-to-save time inside a 40-minute sitting | under 15 min | **held** |
| of the four, compliant veraPDF verdict after the run | **3 of 4** — n07, n50, r27; n35 fails `7.1-9` | ≥ 3, falsified < 3 | **held** |
| real-corpus conformance | 31/78 → 34/78 | ≥ 34/78 | **held** |
| language declarations made | 7 of 7 | 7 | — |
| language documents whose 7.2-24/33/34 clauses all cleared | not measured — see the correction | 7 | **not testable on this data** |
| language documents whose conformance changed | not measured — see the correction | 0 | **not testable on this data** |
| invented claims (qpdf read of every delivered `/Alt`) | **0** across all four | 0 | **held** |
| drift (`contentChanges` outside the declared deltas) | **0** — every run passed the gate | 0 | **held** |

Every delivered `/Alt`, read back with qpdf and matched by hash against the
answers on record and the source's own descriptions:

| document | declared | delivered `/Alt` | from a declaration | carried by the source | invented |
|---|---:|---:|---:|---:|---:|
| n07 | 5 | 33 | 5 | 28 | **0** |
| n35 | 1 | 1 | 1 | 0 | **0** |
| n50 | 1 | 1 | 1 | 0 | **0** |
| r27 | 1 | 2 | 1 | 1 | **0** |

n07's five arrived byte-for-byte. A first comparison said none matched, which
was the reader's fault: the file stores them in PDFDocEncoding, where the curly
quotes and the bullet the person typed are the single bytes `0x8D`, `0x8E` and
`0x80`. Decoded properly, every character matches at every position.

## The four documents

One row per document. "Before" and "after" are the inventory's derived state
and the checker's verdict; "remaining" is the clause list the punch list still
shows after the re-run, by id only.

| document | source | descriptions needed | written | before | after | remaining clauses |
|---|---|---:|---:|---|---|---|
| n07 | PDF (4.9 MB) | 5 | 5 | needs-answers | **conformant** | none |
| n35 | Word | 1 | 1 | needs-answers | closed | `7.1-9`, and `5-1` withheld because of it |
| n50 | Word | 1 | 1 | needs-answers | **conformant** | none |
| r27 | Word | 1 | 1 | needs-answers | **conformant** | none |

n35 lands on `closed` rather than `conformant`: every item a person could
answer is answered and the file still fails the checker on `7.1-9`, untagged
page content, which is the producer's to fix and was never a description's to
close. That is the state existing for exactly this case.

Nobody needed to open a document outside the workbench. The context line and
"open at page" carried all eight descriptions, which is the qualitative half of
the crop decision and the reason crops stay deferred.

## The seven language documents

Each of the seven has a language on record, all four hints behaved as
`language-hint-results.md` predicted (fired on n05, n23, r06 and r10; silent on
n22, n30 and r14), and **none of the seven was re-run**. Prediction 3 asked
what a language declaration alone does to `7.2-24/33/34` and to conformance,
and these seven can no longer answer it: they carry 57 figure descriptions and
a set of decided and requested items as well as a language, so any change in
their clauses has more than one cause. Re-running them would produce numbers
that look like an answer and are not one.

What is on record for them, as counts:

| document | figure descriptions | language | other dispositions |
|---|---:|---|---|
| n05 | 29 | declared | 1 decided figure, 3 decided headings, fonts, annotations, untagged |
| n22 | 2 | declared | annotations, fonts, form fields, untagged, pdfua |
| n23 | 0 | declared | fonts, untagged, pdfua |
| n30 | 18 | declared | fonts ×2, untagged, pdfua |
| r06 | 7 | declared | fonts, untagged, pdfua |
| r10 | 1 | declared | fonts, untagged, pdfua |
| r14 | 0 | declared | untagged, pdfua |

Two shapes in that set are worth a second look before it is used for anything:
n05 holds 29 descriptions with 15 distinct texts and n30 holds 18 with 7, where
the workbench already collapses repeated images into one ask; and the shortest
values are 6, 17 and 18 characters, which is below what describes anything. The
four documents this pilot measured show neither pattern — n07's five are
135 to 205 characters and all distinct, the three Word ones 36 to 50.

## Wall clock

Save timestamps, which is what the record holds. A save is a keystroke's end,
not its beginning, so consecutive saves bound the writing from above.

| segment | measured |
|---|---|
| r27, first save of the sitting | 01:56:53 |
| n50, after r27 | +24 s |
| n35, after n50 | +17 s |
| n07's five descriptions, after the previous save | +83 s |
| **the eight descriptions** | **≤ 2 min 4 s of save-to-save time** |
| the whole eleven-document sitting | 01:56:53 → 02:36:49, 39.9 min |

The prediction's fifteen minutes covered eight descriptions across four
documents. Those cost two minutes of the forty; the rest went on seven
documents the pilot had not asked for.

## Corrections, logged rather than edited

- **Kind: product — the finding this pilot exists to have produced.** Every
  Word document was refused `content-changed` on the first attempt. The
  declaration pass ran `Finish` in place, `Finish` holds its input open while
  PDFBox resolves objects lazily, and the save truncated the file the parser
  was still reading. Ruled out first, by measurement: conversion is
  structurally deterministic (two independent conversions of n50 give
  different bytes and an identical reading), and the text is not the cause
  (the three refused descriptions are plain ASCII; n07's carried curly quotes
  and a bullet and passed). Fixed by staging the pass and renaming, with a
  stage-level refusal of the aliasing and a runner that no longer discards a
  stage's warnings. **The three documents then delivered.** No test had ever
  paired a Word source with a description, and of 154 corpus keys the only two
  answer sidecars were on the same PDF.
- **Kind: measurement.** The prediction says wall clock "from opening the
  first document to the fourth re-run". No stopwatch was run, and
  `declared_at` records a save rather than a keystroke, so what is measured is
  the gap between consecutive saves: 24 s and 17 s between the three Word
  documents, and 83 s between the previous save and n07's five. Those bound
  the writing from above and are far inside fifteen minutes. The re-runs are
  excluded because they were performed later, mechanically, and would measure
  the pipeline rather than the person.
- **Kind: scope — prediction 3 is not testable on this data.** The
  registered design was a language and nothing else on the seven floor
  documents. In the event the person answered all eleven documents: 102
  answers, 65 figure descriptions, and dispositions on font, untagged,
  annotation and form-field items. Those seven now carry descriptions as well
  as a language, so no conformance change on them can be attributed to the
  language alone. It needs a fresh client with only the language declared;
  nothing is wrong with the answers, they simply answer more than the question.
- **Kind: none to the instrument.** The gate and the model were both right and
  neither was touched: `contentChanges` compares the ten content fields it
  always did, and `applyDeclarations` still models a description as moving
  `figures[].alt` and that figure's `order[].text` and nothing else.

## Predictions scorecard

Held: 4 (conformance 3 of 4; corpus 34/78; invented claims 0; drift 0; and the
answer cost, under its own measurement correction). Not testable on this data:
2 (both halves of prediction 3). Falsified: 0.

## What this decides

- **Crops stay deferred.** The registered rule was that the wall clock decides
  it, now that 379 of 380 open figures locate
  (`figure-geometry-2-results.md`). Eight descriptions cost a couple of
  minutes with the context line alone, so the crop step buys back time that is
  not being spent. The trigger is re-registered rather than closed: a document
  whose figures a person cannot place from the context line, or a sitting
  where the descriptions dominate the clock, reopens it.
- **AI drafts and artifacting on a decision** keep their triggers; nothing
  here moves them.
- **The channel is proven on both lanes now**, which it was not before: the
  repair lane by n07 and the corpus's `p71`, the conversion lane by n50 and
  r27 and the new `w22-answers-applied-word`. That was the gap the pilot
  found, and finding it was worth more than the number it was run for.
  `[V]` The blind run over 153 rows holds every promise — invented claims 0,
  silent gaps 0, drift 0, counts 0 off, disposition core 48/48 — and the new
  row is the pair that says it: `w22` delivers compliant with the description
  consumed, while `w07`, the same bytes with nobody's answer, stays
  non-conformant with its `1.1.1` item open.
- **Still open, and not this pilot's to close:** the workbench's "Apply
  answers and run" posts a row's address to a route that re-fetches it, so it
  fails for any document added by upload. The four documents here were run
  through the API instead. Its own issue.
