# One description does not close a second item — the library is declined

Measured against [`image-reuse-predictions.md`](image-reuse-predictions.md),
committed in `afadb7e` before the probe was written. 24 delivered real
documents failing `7.3-1`, 250 undescribed figures. Counts and ids only.

## The registered criterion fires

> **Fewer than 3 of the 24 documents with ≥30% of undescribed figures sharing
> an image → decline and stop.**

`[V]` **Two documents**: n15 (66%) and n22 (100%). Threshold was three.
**Declined.**

And both are small. n22 is two figures drawing one image — one description
saved. n15 is four of six mapped figures. The upper bound on what a
within-document library would close across the whole population is
`shared − distinct-among-shared` ≈ **7 of 250 items, under 3%**, and that is a
bound rather than a measurement because it assumes every share is maximal.

## The number that actually matters is the one I did not predict

| | figures |
|---|---:|
| undescribed figures across the 24 documents | 250 |
| drawing a shared image, **furniture excluded** | **10** |
| drawing a shared image, furniture included | 35 |
| ⇒ page furniture accounts for | **25 of 35** |

**Nearly three-quarters of the apparent reuse is page furniture** — an image
appearing on three or more pages, tagged `/Figure` instead of `/Artifact`.
r09 alone carries 20 such figures behind 4 images; n19's five mapped figures
are one image drawn five times. Criterion 3 was written to keep exactly this
out of the headline, and it earned its place: without it this run would have
reported 35 shared figures and read like a positive result.

Those 25 items are not a description problem at all. They are the artifacting
question — already declined twice, its price recorded in `AGENTS.md` — now
measured on the description-blocked population specifically.

## The instrument reaches 44% of the population, and my criterion measured the wrong unit

`[V]` 112 of 250 undescribed figures resolve to an image. Eight of 24
documents resolve **none**.

Criterion 2 said "if figure→image mapping fails on more than a third of the
**documents**". That is 8 of 24 — exactly a third, so it does not fire. But the
unit was wrong: the question is about figures, and at the figure level coverage
is **44.8%**, which is far worse than the criterion was built to catch. The
criterion did not protect what it was supposed to protect, and it stays as
written rather than being retro-fitted.

One instrument defect WAS found and fixed before concluding: the first version
resolved only direct integer MCID kids and ignored marked-content reference
dictionaries. Fixing it moved exactly one document (n21, 3→5 mapped) and left
the eight zero-mapped documents at zero — so the unmapped population is a
property of those documents, not of the probe. That is why this is reported as
a decline rather than as an inconclusive run, but the caveat is real: **a
better instrument is the only thing that could overturn this**, and it would
have to find sharing in the 138 unmapped figures at a rate the mapped ones do
not show.

## What this closes

The description library — per-client or per-document — is **declined on
evidence**, and the evidence is not the one I predicted would decide it.

- The cross-document case cannot be tested here at all: all 24 blocked
  documents come from 24 different hosts, and the six real multi-document
  organizations in the corpus contribute **zero** description-blocked figures
  between them.
- The within-document case, which needed no client and no invented repeat rate,
  is worth under 3% of the items.

So the claim I made — that closing this gap "needs a client with repeat
documents, not more engineering" — was half wrong. It does need a client. But
the mechanism I proposed to use the client for would not pay off even with one,
unless that client's documents look nothing like any of the 78 real documents
measured here.

**The 250 sentences stay a person's work.** The one mechanical item this
measurement did surface is furniture-artifacting, which is declined for its own
recorded reasons and now carries a second price: ~25 punch items across three
documents.

## Not built, and why

The mock client corpus in the plan's Phase 2 existed to test a library's
mechanism and hazards. With the library declined the fixtures have nothing to
prove, so they are not built — the ladder's first rung, applied to my own plan.
The hazard question they were designed around (whether one image can need
different descriptions in different documents) is worth writing down anyway,
because it is the reason any future reuse proposal must be approval-gated
rather than automatic: the same photograph is "the town hall" in a directory
and "the property showing the unpermitted addition" in an enforcement notice.
