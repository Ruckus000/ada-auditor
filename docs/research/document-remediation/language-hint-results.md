# The language hint — results

**Date:** 2026-09-03. Predictions: `language-hint-predictions.md`, registered
before this run. Instrument: `experiments/document-remediation/measure-language-hint.mts`
over `blind-corpus/real/*.pdf` — `inspectDocument` once per file, the hint
scored from the structure the product emits, the declared `/Lang` (through
`languageToCarry`) as the proxy. Counts and tags only; no document's text
was printed, and none is quoted here.

## Numbers

Over the 52 real PDFs (`^[rn]\d+\.pdf$`), every one read, none failed,
30.2 s wall for the whole set including the JVM start per document.

| measure | count | prediction | outcome |
|---|---:|---|---|
| readable documents | 52 of 52 | — | — |
| documents with a usable `/Lang` | 40 | — | — |
| … on which the hint fired | 37 | — | — |
| … agreeing with the declared primary subtag | 37 of 37 (**100 %**) | ≥ 90 %, falsified < 80 % | **held** |
| … on which the hint abstained | 3 (n14, r08, r16) | — | all three untagged: no text in the reading |
| documents raising the ask on inspection | 12 of 52 (23.1 %) | — | see the correction below |
| the seven named floor documents on which the hint fired | **4 of 7** (n05, n23, r06, r10) | ≥ 5, falsified ≤ 3 | **missed, not falsified** |
| abstentions the floor and margin do not explain | 0 | 0 | **held** |
| `INSTRUMENT_VERSION` | 12 | stays 12 | **held** (`tests/domain/document-asks.test.ts`) |
| zero change across the blind corpus | fatal 0 · invented 0 · silent 0 · drift 0; 151 of 151 rows identical on `sourceLanguage`, `gaps`, `needs` and conformance | the same | **held** (the bytes are explained below) |

## The seven named documents

Fired / abstained per document, with the two highest counts and the size
of the reading. The winner on every fired document is `en`, and every
runner-up is a Romance language fed by the shared words (`a`, `no`, `as`,
`de`), which is what the margin is for.

| document | headings | reading-order entries | winner | runner-up | hint |
|---|---:|---:|---|---|---|
| n05 | 95 | 6,516 | en 12,820 | pt 1,390 | fired: en |
| n22 | 0 | 2 | en 1 | — | abstained — under the floor |
| n23 | 0 | 106 | en 155 | es 5 | fired: en |
| n30 | 0 | 55 | en 61 | pt 31 | abstained — inside the margin, by one token (61 < 2 × 31) |
| r06 | 0 | 168 | en 161 | pt 18 | fired: en |
| r10 | 1 | 173 | en 283 | pt 13 | fired: en |
| r14 | 0 | 5 | — | — | abstained — no token matched |

Two of the three abstentions are documents whose structure tree carries
almost nothing (2 and 5 reading-order entries against hundreds of text
characters on the page): a tagger that wrapped the page in a handful of
elements, so the 90-character cut per entry leaves the hint nothing to
read. The third, n30, is the margin doing what it was registered to do —
and it is left as it is. Loosening the margin to 1.9 after seeing that one
number would be tuning to the corpus, and the number it would buy is one
document.

## Corrections, logged rather than edited

- **Kind: instrument scope.** The predictions say "7 of the 52 real PDFs
  raise the ask (13 %)". That is the count on a *delivery* — a repaired
  document's punch list. On the *inspection* reading, which is where the
  workbench and the one-off screen show the ask, 12 of 52 raise it
  (23 %): the same seven plus five untagged PDFs (n09, n11, n12, n31,
  r20) that declare no `/Lang` and carry no structure at all. On those five
  the language item sits under the untagged refusal, and there is nothing
  for the hint to read (order = 0); it abstains on every one. Both numbers
  are true; the 13 % stands as the trigger because it counts the documents
  on which a person will actually be asked, and the 23 % is recorded so
  the next reader is not surprised by the measurement script's line.
- **Kind: none to the thresholds.** The floor (8) and the margin (2×) are
  unchanged after the run.

## What this changes

- **The hint ships as registered**: a suggestion on the ask's target,
  never a claim, never preselected, acceptance derived from the row.
- **Where it helps** is where the ask is answered from real text: on four
  of the seven documents an operator now sees "Its text reads as English
  (283 matches)" beside the empty select instead of the title alone.
- **Where it does not** is a limit of the reading, not the detector: a
  document whose tree holds two elements gives the hint two lines. The
  cut is `Inspect`'s and stays — the stripped text crosses the JVM boundary
  as a count on purpose, and widening it for a hint would be the wrong
  trade. The number that would move it is a tagger fix on the client's
  side, which the punch list already asks for.
- **The corpus cannot test the eight other detectors**: every usable tag
  among the real PDFs is English. They are held to the invented fixtures in
  `tests/domain/language-hint.test.ts` (nine languages, a bilingual notice
  that abstains, a Japanese paragraph that is not read as Chinese) until a
  real non-English document enters the corpus.

## Predictions scorecard

Held: 5 (agreement; abstention explained; zero change; `INSTRUMENT_VERSION`;
the trigger, with the scope correction above). Missed without being
falsified: 1 (coverage on the seven — 4, against ≥ 5 and a falsification
line at ≤ 3). Falsified: 0.

## The blind run

`npm run blind:documents run` then `score`, on this tree with the hint in
it, over all 151 rows (the 93-document corpus plus the door probes and the
answer sidecars): **every promise held** — disposition 46/46, door 11/11,
invented claims 0 (so zero `invented-language`: no `sourceLanguage` on any
document that declares none), silent gaps 0, drift 0. Punch items 14
missing and 2 unexpected, counts 2 off, 52 unverifiable — every one of
those a probe note that the previous run also carried.

Against the previous run on the sibling tree (`answers-channel`, which by
then held Agent A's r23/r30 key corrections and its planted `w21` row),
the scorer's findings differ in exactly three lines, all three Agent A's:
the two `counts-off` notes on r23 and r30 that its corrections remove, and
the `w21-toc-title-body` row this tree does not have. Per document, 151 of
151 rows are identical on `sourceLanguage`, `gaps`, `needs`, the
conformance verdict and the failing clauses.

Delivered bytes: 120 rows deliver a file. 73 are byte-identical to the
previous run, and the 78 that differ are fully accounted for — 34 planted
PDFs whose only differing line is the trailer `/ID`, which PDFBox mints
afresh on every save when the source carried none (every real PDF keeps
its own and is identical to the byte), and 44 Word-source conversions,
where LibreOffice's output is not byte-stable between runs. Nothing else
differs. The hint reaches no delivered file, which is what "a suggestion,
never a claim" has to mean in bytes.
