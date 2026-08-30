# Document blind test — results

Seven runs of 92 documents, then 93 the pipeline had never seen, against keys locked in
`5ad8352` before the first byte reached it. Counts and clause identifiers only.
Predictions are in `blind-test-2026-08-29-predictions.md`, written first.

## The scorecard, final run

```
Disposition   core 38/38 hit · 0 refused differently · 0 delivered when a refusal was expected
Door          11/11 · 0 leaked · 0 wrong status
Punch items   0 missing · 1 unexpected (listed; a person decides)
Invented claims  0
Silent gaps   0 · 0 suppressed with nothing voicing them
Drift         0
Counts        2 off · 18 unverifiable
Probes        69 observations across 46 rows (data, not failures)
Key corrections this run: 40
vs previous run: 0 fixed · 0 regressed · 0 still failing
```

Exit 0. **Every promise held.**

## What the corpus actually produced

81 documents past the door: **66 delivered, 15 refused**.

| | count |
|---|---|
| deliveries fully conformant on both instruments | **19** |
| deliveries not conformant | 47 |
| of those, carrying a punch list or a gap | **47 of 47** |
| **delivered non-conformant with nothing to do about it** | **0** |
| punch items written across the corpus | 173 |
| real PDFs delivered / refused | 14 / 5 |

That bottom-left number is the whole product. A document either comes back
conformant or comes back with the work named. Across 92 documents it never
came back as neither.

## The five promises, measured

| promise | result |
|---|---|
| accurate disposition | 38/38 core rows |
| zero invented claims | 0 |
| zero silent gaps | 0 |
| zero drift between the product's verdict and an independent one | 0 across every delivery |
| complete punch list | 0 missing on any row |
| door behaves | 11/11, nothing leaked |

Conformance is reported beside these and is deliberately not one of them: the
Matterhorn Protocol puts 47 of PDF/UA-1's 136 failure conditions beyond any
machine, and claiming otherwise is what the FTC fined a competitor $1M for.

## What the test found in the product

**Three defects, and one broken promise.**

**1. A document's attachments were examined by nobody.** See the decided
questions below: a tagged cover sheet delivered clean over an untagged payload,
with nothing in the vocabulary able to say so.

**2. A placeholder title outranked the document's own heading.** See the
decided question below: an exporter's stamp was delivered as `already-titled`,
satisfying UA-1's DisplayDocTitle while telling a reader nothing.

**3. A document with one bad metadata field got no remediation at all.**
`Finish` refuses a language tag that is not BCP-47 — correctly, since writing
`en US` states something false while passing every machine check there is. But
`planRepair` handed the source's tag straight through, so a PDF whose own
`/Lang` was empty or malformed came back `repair_failed: invalid-language` and
the client got nothing. A tag nobody can resolve is, to a reader, the same as
no tag; it is now dropped, and the 3.1.1 punch item asks a person to name the
real one. `[V]` p21 and p22 now deliver, carrying that item.

**4. Two documents were delivered neither conformant nor punch-listed.**
The promise, broken, and found only because the corpus was new. `withConformance`
suppressed every clause in a family our own vocabulary can speak for — on the
assumption the matching item would be there. Our annotation item counts
annotations with no `/StructParent`; veraPDF fails 7.18 for reasons that
counter cannot see. The item stayed quiet, the suppression spoke for it, and
two failing clauses reached the client as silence.

Suppression is now **earned**: a clause is left to one of our items only when
that item is present, checked per family. `[V]` The corpus-wide count of
"suppressed with nothing voicing them" went 4 → 0.

That last finding is the answer to whether this test was worth running. No
unit test could have produced it: it needed a real document, through the real
door, checked by an instrument that did not share the product's assumptions.

## What the test found in itself

Six defects, all mine, and they outnumber the product's three to one. Worth
recording, because a blind test that only reports on the product is not being
read carefully.

| defect | consequence |
|---|---|
| structure elements counted by the optional `/Type /StructElem` | 14 tagged documents read as untagged; would have reported the product delivering untagged PDFs |
| title detector blind to XMP | accused the product of inventing a title the document declares twice |
| synthetic Identity-H font with a placeholder font program | no text extractable at all, so the title chain "failed" the heading rung |
| table header cells styled `Heading3` | a document planted with two headings really contained four |
| heading order read from qpdf's object map | three documents credited with heading problems in an order no reader experiences |
| `descr` counted as a description, `title` not | a captioned seal called undescribed |

`generate.mjs` also emptied the whole keys directory, deleting 28 real keys it
does not own — caught by the independence test counting keys, restored from the
lock commit, which is why the lock commit exists.

**40 corrections across 18 of 28 real documents: 64%**, far past the 10% the
protocol calls a finding about key quality. It is a finding about mine. Every
one is in `corrections.json` with its evidence and prints on every future
scorecard.

The strongest single result of the campaign is what happened after those fixes:
counting structure elements by shape reproduces the product's counts **exactly**
— r01 11/3/25/1, r17 32/31/11/1, r22 2/0/10/2, every facet. Two independent
readings of the same bytes, agreeing.

## Predictions against outcomes

| registered | actual | |
|---|---|---|
| refusals among real PDFs: 16 of 19 | **5 of 19** | wrong, and the reason was my `/Type` defect. The wild is far more tagged than the training corpus suggested |
| deliveries among real Word documents: 9 of 9 | 9 of 9 | held |
| invented claims 0 · silent gaps 0 · drift 0 · door leaks 0 · punch missing 0 | all 0 | held (silent gaps only after the fix above) |
| fully conformant deliveries: 3–6 of ~21 | **19 of 66** | both numbers moved; more documents were repairable than predicted |
| r01 stays compliant through repair | compliant | held — repair did not break an already-conformant document |
| at least 2 real PDFs failing 7.21.4 | held | |

**The four things I registered as likely wrong:** the junk-title row was a real
problem and is now fixed (below); the heading-level vocabulary disagreement was mine, not the
product's; the portfolio row behaved exactly as predicted (below); and
suppressed-but-quiet clauses were real, and were the broken promise.

## Both open questions, decided

**A title an exporter left behind is no longer carried forward.** p04 declared
`Microsoft Word - Document1.docx` and the product reported it as
`already-titled` — faithful, since the document does say it, but the product
already refused junk of exactly that shape from a *filename*, and a
screen-reader user got a meaningless title either way.

Decided on **provenance rather than content**: a producer stamp is what Word
writes when a document has no title, so its presence is evidence that nobody
filled the field. Such a title is declined and the chain continues — the
document's own heading, then the filename, then the honest gap — which recovers
the same words under a label that is true. `isPlaceholderTitle` is a predicate,
never a rewriter: a title that survives is delivered exactly as written. It
delegates to the junk table the filename chain already used, so there is one
policy and not two, and it now governs all three paths that decide a title
(repair, conversion, inspection) so no two surfaces can disagree about one
document. `INSTRUMENT_VERSION` 7; the 2.4.2 gap now reads "no title a reader
could use", which stays true of a document that carries a placeholder.

`[V]` Re-run: **disposition 36/36 on core rows** (p04 promoted from probe, since
the product now makes this claim), and across all 92 documents **exactly one
title changed** — p04's, to `transcribed`. No real document lost a legitimate
title, which is the guard against a policy that eats what it was meant to
protect.

**A portfolio's attachments are now named.** p16 is a tagged cover sheet with
an untagged PDF attached. It delivered, and neither instrument looked inside:
our reading walks the outer structure and veraPDF validates the outer bytes, so
no clause failed and nothing was voiced. Not a silent gap by the promise's
definition — every failing *clause* was named — but a client could receive a
clean-looking verdict over an unremediated payload, and the vocabulary had no
word for it. Predicted before the run, confirmed by it, and now closed.

`Inspect` counts the EmbeddedFiles name tree and the punch list says so.
Labelled **`PDF/UA 7.11`**, the standard's own section for embedded files,
rather than a WCAG criterion — and that is the opposite choice from the
annotation item, deliberately. There the defect is known, so 1.3.1 fits. Here
the attachment was never opened, so naming a success criterion would assert a
failure nobody checked, which is the invention this product refuses. Counted,
never opened: remediating an attachment means rewriting the container around
it, and the honest instruction is that each attached document goes through the
pipeline on its own. `INSTRUMENT_VERSION` 8.

`[V]` Two corpus rows now hold it — the portfolio and a plain PDF with a file
attached, because `/Collection` only makes a viewer show the portfolio UI and
is not what makes the payload unexamined. Both voice the item; disposition
**38/38** on core rows, nothing regressed.

## The deployed spot-check: attempted, blocked

Seven corpus documents — both product fixes, both refusal kinds, and the
ordinary good case — were posted to the production deployment carrying these
changes (`oile61is6`, Ready, built from the merge). All seven answered **401**,
uniformly.

A uniform verdict is always the instrument, so it was diagnosed rather than
reported as a result:

- the body is the application's own `{"error":"unauthorized"}`, not Vercel's
  SSO page, so this is the route's constant-time token comparison failing
  rather than deployment protection;
- `AUDITOR_RUN_TOKEN` **is** set in Vercel Production (created 3h before the
  attempt, names listed without values);
- the value in the local `.env.local` is 66 characters and is rejected by both
  the new deployment and the previous one, so the local file and the deployed
  variable have diverged since the parity run earlier the same day.

**This measures nothing about the pipeline.** Making the two match is a
credential operation and is the operator's, not this campaign's. Until then the
blind test's numbers are local-only — the same caveat every production
measurement in this project has carried, named rather than glossed.

## What this test still cannot do

Unchanged from the predictions, and worth repeating where the results are:

- One person authored both the pipeline and the keys. The mechanisms bound the
  leak; nothing proves it is zero — and 64% of real keys needed correcting,
  which is the honest measure of how much that matters.
- The planted corpus is bounded by one imagination. The 28 real documents are
  the only guard against unknown-unknowns, and 28 is thin.
- Two count disagreements remain (r28, r32: one heading each), both explained
  by headings that do not survive conversion, and both the source-side-predicts-
  output-side category error rather than product defects.
- 18 count facets are unverifiable by any third-party instrument and are listed
  as such rather than quietly scored.
