# 4.1.2 form-field names — results

Registered in `form-names-predictions.md` before the run. What was wrong there
stays wrong here.

## The defect

r13 was **delivered** with **135 form fields carrying no accessible name**, and
the punch list named none of them. The same summary told the client
**4.1.2 was not checked**.

Not a gap in what we could see — the evidence was already in hand. veraPDF fails
`7.18.1-3` (*a form field shall have a TU key present, or all its widget
annotations shall have alternative descriptions*), and `alreadyVoiced` routed the
whole `7.18` family to the 1.3.1 annotation-nesting item. That item is present on
r13 for an unrelated reason — 289 widgets sit outside the structure tree — so it
**earned** the suppression under the existing rule, and the clause vanished. Not
in a gap, not in a need, not even in the "further PDF/UA checks fail" catch-all.

The suppression rule is not at fault; the routing was. `7.18.1-3` is a question
about a field's NAME and 1.3.1 is an item about reading ORDER, and answering the
second leaves the first standing.

## What changed

`Inspect` counts widget annotations and how many carry no accessible name, and
`4.1.2 Name, Role, Value` moves out of `NOT_CHECKED_CRITERIA` into what the
product claims to check. `7.18.1-3` now routes to 4.1.2; the rest of `7.18` still
routes to 1.3.1.

**Read ourselves rather than taken from veraPDF.** A criterion in
`CHECKED_CRITERIA` is claimed on every document, and conformance can come back
`checker: 'none'` — a criterion whose evidence is optional cannot be claimed
unconditionally. veraPDF stays the second opinion, which is how the agreement
below is worth something.

**The published rule verbatim, not a tighter one of ours.** Implementing
veraPDF's own condition is what makes the two counts comparable as independent
answers to one question. Deliberately no exemption for hidden fields: the rule
states none, and a self-invented exemption is what silently swallowed a real
contrast failure behind `/Artifact` last time.

## Verification

**`[V]` 97 documents, exit 0, every promise held, 0 regressed.** Disposition
42/42, doors 11/11, invented claims 0, silent gaps 0, drift 0.

**The registered prediction that mattered was the negative one, and it held.**
Exactly two documents emit 4.1.2 across all 97, with exactly the predicted
strings:

| document | fields | unnamed | gap |
|---|---:|---:|---|
| r13 | 289 | 135 | `4.1.2: 135 form fields with no accessible name` |
| p15-form-fields-outside-structure | 2 | 2 | `4.1.2: 2 form fields with no accessible name` |

**135 is agreed by three independent readings** — veraPDF's `7.18.1-3` failed
checks, a raw qpdf-object scan written for this measurement, and the stage.

**Header:** r05 is the cap-critical document, carries no form fields and did not
move (13,212 bytes, 3,172 of headroom). r13 sits at 2,631.

lint, typecheck, 1,899 unit tests, 41 JVM document tests — three of them driving
the real stage.

## The registered prediction that was WRONG

I predicted **two `scope-change` corrections**. There are **none**, and the
corrections file is unchanged at 42 across 18 documents.

Both halves of the prediction were wrong for different reasons, and both were
knowable before the run:

- **r13's key sets `needsExact: false`.** Real keys record `needs` as a
  MUST-INCLUDE set, precisely because "the product may correctly voice more than
  a third-party reading can predict". An extra 4.1.2 is the case that rule was
  written for, so it raises nothing and generates no correction.
- **p15 is planted**, and planted expectations live in `spec.mjs`, not in the
  corrections overlay. Updating one is not a correction.

The mistake was registering a prediction about an apparatus I had not read
closely enough — the same shape as registering contrast numbers against an
uninspected instrument two changes ago. Twice now, so it is worth naming: the
protocol wants predictions about the PRODUCT, and I keep also predicting the
scoreboard.

**`vs previous` was untestable here.** I predicted the `INSTRUMENT_VERSION` bump
would make stored baselines read `incomparable` for a cycle. The blind harness
runs `AUDITOR_STORE=memory` and holds no baselines, so nothing exercised it. The
bump is still right — without it every stored baseline reads `4.1.2` as a gap the
client's document just grew — but this run is not evidence for it.

## p15 is a regression lock, labelled

Its key gained 4.1.2 in the same change that made the product emit it, so it is a
regression lock rather than blind evidence — the p16/p17 lesson, named in-row.
What it is FOR is the other direction: it fails the run if the reading is ever
narrowed to fields an `/AcroForm` registers.

**That narrowing is not hypothetical — it was my first implementation.** Walking
PDFBox's `getFieldTree()` resolves inherited `/TU` correctly and reported **zero
form fields for p15**, a document with two unlabelled ones, because its catalog
has no `/AcroForm` at all and its widgets belong to no field tree. A document
read as having no form is exactly the silence this change exists to end, and it
was caught by scanning the corpus rather than by any test. The population now
comes from the page annotations; `/Parent` is walked only to resolve inheritance.

## What this does not close

- **`7.18.4-1` — 289 widgets not nested in a `Form` tag — is still voiced only as
  1.3.1.** That is the reachability half, and the existing item is honest about
  it. Naming it 4.1.2 as well would report one defect twice.
- **No field is ever labelled by us.** A field's label is what the field is FOR;
  inferring it is the invention refused for alt text, and worse here, because a
  wrong label on a form is a barrier that looks like a fix.
- **One real form is thin evidence.** The corpus has exactly one. The count is
  corroborated three ways, but prevalence is not established, and a second real
  form could carry a shape this pass reads wrongly.
- **The Word lane does not read form fields from the source.** No Word row in the
  corpus carries any, and what gets graded is the delivered PDF, so this costs
  nothing today — but a Word source with form fields would be read only after
  conversion.
