# Restoring the real filenames — results

Measured against [`real-filenames-predictions.md`](real-filenames-predictions.md),
committed in `ac6724b` before the runner changed. 148 documents, exit 0, every
promise held, 0 regressed. Counts and ids only.

## Predictions against outcomes

| registered | actual | |
|---|---|---|
| newly conformant: +10, exactly {n02, n17, n42–n46, n48, n49, r03} | **exactly those ten** | held |
| lane split: Word 21/26, PDF 5/52 | **21/26 and 5/52** | held |
| clause change: titled documents lose `7.1-9` and nothing else | **0 surprises** — every clause delta was `7.1-9` and/or the earned `5-1` | held |
| scorer: 0 fatal findings, five promises hold, drift 0 | **all held** | held |
| title provenance moves on 22 documents; the 23rd stays | **23 moved; none stayed** | **WRONG.** See below |
| key corrections owed after: 10 conformance rows | **0 written** | **WRONG.** See below |
| `INSTRUMENT_VERSION` | 11 | held |

**Real conformance: 16/78 → 26/78.** Word 21/26 (81%), PDF 5/52. Not one line
of product code changed — the ten documents were always this close, and the
instrument was what said otherwise.

## The two misses, on the record

**"22 of 23" was a stale number.** The registered figure came from
`title-from-real-filenames.mts` as recorded in `title-gap-is-the-corpus.md`,
which found one document no rung of the chain could title. Re-run against
today's chain, **all 23 basenames title** — the chain has improved since that
measurement (the placeholder-title and junk-table work), and the prediction
carried the old number forward without re-running the measurement it cited. The
conformance prediction survived the miss only because the extra document was
co-blocked anyway. Lesson, stated plainly: a prediction that cites a
measurement inherits that measurement's date.

**"10 conformance corrections owed" misread the protocol.** No correction
mechanism for expected conformance exists, and that is by design:
`author-real-keys.mjs` derives keys from source bytes and instruments, and what
a delivered document *should* conform to encodes product capability, which the
key author deliberately does not model. The practiced protocol — five documents
already delivered compliant against under-claiming keys before this change —
is that the key's `compliant: false` stands and the independent checker's
verdict is the record. Three new non-fatal `unexpectedly-compliant` probe notes
joined them (the seven Word keys carry no conformance expectation at all).

## What this closes

The `AGENTS.md` known-gaps entry recording the corpus title bias is now
resolved: the harness posts real names, the measured number and the
production-equivalent number are the same number, and the remaining `2.4.2`
gaps in the corpus are documents whose real filename the product's own junk
table refuses — which is the product's judgement, exercised on real input.
