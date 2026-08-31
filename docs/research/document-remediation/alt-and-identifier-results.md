# Alt legibility and the conformance identifier — results

Measured against `alt-and-identifier-predictions.md`, written and committed
(`16d2d99`) before any product code changed. 97 documents, exit 0.
Counts, rule names and clause identifiers only.

## The scorecard

```
Disposition   core 42/42 hit · 0 refused differently · 0 delivered when a refusal was expected
Door          11/11 · 0 leaked · 0 wrong status
Punch items   0 missing · 1 unexpected (listed; a person decides)
Invented claims  0
Silent gaps   0 · 0 suppressed with nothing voicing them
Drift         0
Counts        2 off · 18 unverifiable
Conformance   0 not checked · 0 short of a compliant key
Key corrections  42 across 18 documents — 40 instrument defects, 2 scope changes
  alt-legibility contributed 157 items (some inside instrument-defect rows)
vs previous run: 0 fixed · 0 regressed · 0 still failing
```

Drift was the one genuinely at risk, because clause lists changed on 53
documents. It held at zero.

## Predictions against outcomes

| registered | actual | |
|---|---|---|
| alt strings reclassified: 157 across 4 documents | **157 across 4** | held, per document: r04 52, r05 101, r06 1, r34 3 |
| legitimate descriptions untouched: 15, **zero flagged** | **zero flagged** | held — verified per document, including the three carrying a trailing NUL |
| delivered files asserting the identifier: 68 → 19 | **19** | held |
| false assertions (stamped, not compliant): 49 → **0** | **0** | held |
| compliant documents still asserting it: 19 → 19 | **19** | held |
| corrections 44 — 40 instrument defects, 4 scope changes | **42 — 40 and 2** | **WRONG.** See below |
| five promises unchanged | all held | drift 0 across 53 changed clause lists |

**The corrections split was mis-predicted and the prediction stands uncorrected.**
r06 and r34 were already wrong for unrelated reasons, so their legibility items
fold into `instrument-defect` rows and never reach the scope-change count. The
total contribution is reported separately for exactly this reason — 157 items,
some inside instrument-defect rows — but the registered split was 4 and the
answer is 2. Editing a prediction after the run is the failure mode this
apparatus exists to prevent, so it stays wrong on the record.

## Two defects the change surfaced, both real

**1. The summary header is unbounded, and it broke a delivery.** The punch list
travels in the `x-remediation-summary` response header, one item per undescribed
figure. A real municipal document carrying 101 of them produced a **22,743-byte**
header, and every client on Node's 16 KB default rejected the entire response
with `Headers Overflow Error`. The client received no punch list at all — worse
than a blunt one.

Latent before this change (the largest was 54 items at 12,220 bytes) and tipped
over by it. Shortening the two figure items to their essentials brought the same
104 items to **12,946 bytes** and the delivery back to 200 with nothing
truncated. `[V]` Measured on the document itself, at the default cap, before and
after.

**That is headroom, not a bound.** ~3.4 KB remains, and a document with a few
hundred figures would breach it again. The contract is what needs fixing;
recorded in AGENTS.md rather than closed here.

**2. The product silently lost the ability to certify any document, and the
blind test reported every promise held.** Gating the identifier meant staging a
stamped copy and re-validating it. The staged file was named `<output>.pdf.ua`;
**veraPDF exits 4 on a path that does not end `.pdf`**, the helper read that as
"the identifier did not help", and discarded every stamp. Conformant deliveries
went **19 → 0**.

The run still passed. Disposition 42/42, drift 0, silent gaps 0, every promise
held — because **not one answer key claimed that any document should come back
conformant**. Real keys say `conformance: 'any'` or assert non-compliance;
planted keys said nothing at all. A corpus that cannot notice the product has
stopped certifying is measuring the wrong thing.

Found only by the independent extractor, which counts identifier assertions in
the delivered bytes with no product code in the loop. That is the whole argument
for keeping one.

Two changes came out of it: the staged file is now named `<output>-ua.pdf`, and
both bail-out branches log `document_identifier_not_earned` instead of failing
quietly. And `w01-baseline` — the ordinary good Word document — now asserts
`conformance: { compliant: true }`, so this exact failure fails the run.

## What the product does now

- The identifier is **earned**: written without it, measured, and written back
  only when `5-1` is the sole failing clause. Withholding it costs exactly that
  one clause and nothing else, measured before implementing, which is what makes
  the inverse test exact rather than approximate.
- The verdict always describes the bytes delivered beside it. The file is read
  **after** the identifier decision and after the re-check — which is why drift
  stayed at zero while 53 documents' clause lists changed.
- `5-1` is named rather than left to the catch-all, which would have told 49
  clients that "a person must review 5-1" — instructing them to restore the very
  claim the document is not entitled to make. The item says the absence is
  deliberate and asks for no work.
- Alt text is read for legibility against **WCAG Technique F30**, on provenance
  only. The punch item never quotes the string it is refusing; one of them in
  this corpus is a UNC path naming a private host, and the punch list renders on
  a public page.

## Residuals, named

- **The remaining 19 identifiers still overstate.** `pdfuaid:part 1` asserts full
  PDF/UA-1 conformance; veraPDF checks the 87 machine-checkable of Matterhorn's
  136 failure conditions. This removed 49 egregious claims and left 19 smaller
  ones. The deferred scope sentence is what closes them.
- **Header headroom is ~3.4 KB**, not a bound.
- **The legibility rule exists twice** — in the product and in the key author,
  which the independence test forbids from importing `src/`. They agree by
  construction, so the corrected keys prove what the alt strings *are* and prove
  nothing about whether classifying them this way is right.
- **The four new planted rows are regression locks, not blind evidence**, and are
  labelled so in `spec.mjs`. Disposition moved 38/38 → 42/42 by adding four rows
  that could not fail.
- **One registered under-detection stands**: one string is a filename fragment
  with no extension, and flagging it would need a quality judgement rather than
  provenance evidence.
- **Blindness on alt text is gone for this corpus.** All 173 strings were read
  before the predictions were written.
