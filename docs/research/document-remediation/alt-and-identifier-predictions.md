# Alt legibility and the conformance identifier — predictions, registered first

Written **before** either change was implemented, against the corpus and run data
as they stood on `2897e1f`. Counts, rule names and clause identifiers only — no
document text, no titles, no paths.

## The two defects

Both are the same shape: **the product counts the presence of a field and reports
it as substance.**

1. **The delivered bytes assert a conformance the report denies.**
   `Finish.java:324` writes the PDF/UA-1 identifier unconditionally. All 68
   delivered files carry it; **49 are not compliant** on our own veraPDF verdict.
   A consumer reading the XMP — which is how conformance is machine-detected —
   sees a PDF/UA-1 claim on a file we ourselves say does not conform.

2. **Alt text is tested for presence, never for legibility.** `gapsIn` and
   `needsIn` test only `figure.alt === null`. Of 173 `/Alt` strings across the
   delivered corpus, **158 fail WCAG Technique F30** — 153 by the placeholder-word
   rule, 3 by the filesystem-path rule, 1 by the `cid:` rule, 1 empty. All are
   currently counted as described and raise no 1.1.1 item.

**The standard being applied is not ours.** WCAG 2.1 Technique F30 — *"Failure of
Success Criterion 1.1.1 and 1.2.1 due to using text alternatives that are not
alternatives (e.g., filenames or placeholder text)"* — names three categories:
placeholder text, programming references, and filenames. The predicate implements
those and nothing beyond them.

## What is being changed

- The identifier is **earned**: withheld unless the document conforms, mirroring
  the `MarkInfo` gate already at `Finish.java:106-120`.
- `isPlaceholderAlt` — a pure predicate, refusing on **provenance only**, never on
  subjective quality, in the shape of `isPlaceholderTitle`.
- `corrections.json` gains a `kind`, so an instrument defect and a scope change
  can never again be summed into one integer.

## Registered predictions

### Alt reclassification

**157 alt strings, across exactly 4 documents.**

| document | strings flagged | rule |
|---|---:|---|
| r04 | 52 | placeholder-word |
| r05 | 101 | placeholder-word |
| r06 | 1 | `cid:` reference |
| r34 | 3 | filesystem-path |

**15 legitimate descriptions left untouched, and zero flagged.** This is the
guard, and it matters more than the 157: a policy that eats real descriptions is
worse than the problem it solves. Three of the 15 carry a trailing NUL and are
only safe because the predicate normalises the terminator before testing — one of
them is on **r01, the only conformant real PDF in the corpus.**

`p28-figure-empty-alt` unchanged: empty alt is a positive claim of no meaning, and
that policy is not being reversed here.

**One registered under-detection.** One r34 string is a filename fragment with no
extension. It is left alone deliberately — flagging it would need a quality
judgement rather than provenance evidence. Recorded rather than chased.

### The identifier

| | before | after |
|---|---:|---:|
| delivered files asserting the identifier | 68 | **19** |
| of those, not compliant (false assertions) | **49** | **0** |
| compliant documents still asserting it | 19 | **19** |

Withholding the identifier adds exactly one failing clause, `5-1`, and only that
clause. Measured on r01 before implementing: `compliant: true, []` becomes
`compliant: false, ['5-1']`.

### Corrections

**44 total — 40 instrument defects across 18 documents, 4 scope changes across 4
documents**, printed as a split and never summed.

### The five promises, unchanged

Invented claims 0 · silent gaps 0 · **drift 0** · punch missing 0 · disposition
38/38 on core rows · door 11/11.

**Drift is the one genuinely at risk.** Clause lists change for 49 documents, and
the delivered buffer is currently read *before* validation. If the reported
verdict is ever computed on bytes other than the ones delivered, the independent
veraPDF reading will disagree and the run will fail. That is the intended
tripwire.

### Two consequences that will look like regressions and are not

- **Every stored document baseline reads `incomparable` for one cycle.**
  `INSTRUMENT_VERSION` goes 8 → 9, and the comparator refuses to diff readings
  across versions by design — a vocabulary change diffed silently would report our
  change as the client's document changing.
- **Punch items rise sharply** — 176 to roughly 333. More named work on the same
  documents is the product working, not degrading.

## What this test cannot do

Stated up front rather than discovered later.

- **Blindness on alt text is gone for this corpus.** All 173 strings were read
  before this was written. What survives: the predictions are exact and
  falsifiable, and the extraction is re-derivable by anyone with qpdf and no
  product code.
- **The corrected keys cannot corroborate the classification.** The independence
  test forbids the key author from importing `src/`, so the rule exists twice and
  the two agree by construction. The keys prove what the alt strings *are*; they
  do not prove the classification of them is right.
- **The new planted rows are regression locks, not blind rows.** Their keys assert
  behaviour written in the same change — the p16/p17 lesson, labelled this time
  rather than counted as evidence.
- **No corpus row carried a non-Latin alt string** before this change. One is
  added, which closes the gap prospectively but means the predicate has no track
  record on CJK or RTL descriptions.
- **The remaining 19 identifiers still overstate.** `pdfuaid:part 1` asserts full
  PDF/UA-1 conformance; veraPDF checks the 87 machine-checkable of Matterhorn's
  136 failure conditions. This change removes the 49 egregious claims and leaves
  19 smaller ones, which the deferred scope-sentence work is what actually closes.
