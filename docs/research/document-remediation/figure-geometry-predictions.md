# Figure geometry and identity — predictions, registered before measurement

**Date:** 2026-09-02. **Change:** `FigureOrder.locate` — one content-stream
pass per page, tracking marked-content ids, recording every image drawn
inside one: its placed box from the CTM, and a SHA-256 over its raw stream
bytes plus dimensions. `Inspect` now emits `box`, `imageDigest` and
`imageFilter` per figure. Nothing writes; this is a reading.

**What it exists for.** The declared-answers channel asks a person to
describe each undescribed figure. Page furniture — a logo on every page — is
one image drawn many times, and the earlier probe (`image-reuse-declined.md`)
measured repeats of one image at 25 of the 35 figures shared across the blind
corpus's documents. The digest is what lets one description land on every
repeat: one act, N attributed rows. The box is emitted from the same pass
because it costs nothing more and the deferred crop step needs it.

**Against the probe.** `experiments/document-remediation/Figures.java`
located 109 of 249 undescribed figures (43.8 %) across the real corpus: it
read the figure's OWN marked-content ids only, images only, and mapped eight
documents' figures to nothing at all. This pass descends nested kids (a
tagger parks captions and even paragraphs under a figure) and hashes the raw
stream, so a JPX image it cannot decode still has an identity. It still
records images only: a figure drawn as paths locates nothing and reports
null, which is the honest absence.

## Registered predictions (over `experiments/document-remediation/real-pdf`, the 52 real PDFs)

1. **Located** — undescribed figures with a `box`: **≥ 55 %** (probe: 43.8 %).
   Falsified below 50 %, in which case nested descent bought less than
   expected and the image-only limit dominates.
2. **Identified** — undescribed figures with an `imageDigest`: **≥ 55 %**,
   equal to or above the located share (every located image is hashed; a
   hash never needs decoding).
3. **Collapsed** — undescribed figures that are a repeat of an earlier one in
   the same document (`count − 1` per digest group): **≥ 20 %** of undescribed
   figures. Falsified below 10 %.
4. **At least three documents** where grouping removes half or more of the
   open figure asks.
5. **Cost** — the whole-corpus `Inspect` wall time grows by **< 2×** against
   the pre-change stages.
6. **Zero readings fail** that succeeded before: the pass is wrapped, and a
   content stream it cannot parse degrades to nulls, never a crash.

Results follow in `figure-geometry-results.md`, with any correction to the
keys or these predictions logged by kind.
