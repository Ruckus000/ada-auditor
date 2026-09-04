# The answers pilot — results

**Date:** _(the day the person answered)_. Predictions:
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
| documents answered with descriptions | _ of 4 (n07, n35, n50, r27) | 4 | |
| descriptions written | _ of 8 | 8 | |
| wall clock, first document opened → fourth re-run finished | _ min _ s | under 15 min | held / falsified |
| of the four, compliant veraPDF verdict after re-run | _ of 4 | ≥ 3, falsified < 3 | |
| real-corpus conformance | 31/78 → _/78 | ≥ 34/78 | |
| language declarations made | _ of 7 (n05, n22, n23, n30, r06, r10, r14) | 7 | |
| language documents whose 7.2-24/33/34 clauses all cleared | _ of 7 | 7 | |
| language documents whose conformance changed | _ of 7 | 0 | |
| invented claims on every re-run (scorer, qpdf read of each delivered `/Alt`) | _ | 0 | |
| drift on every re-run (scorer, `contentChanges` outside the declared deltas) | _ | 0 | |

## The four documents

One row per document. "Before" and "after" are the inventory's derived state
and the checker's verdict; "remaining" is the clause list the punch list still
shows after the re-run, by id only.

| document | source | descriptions needed | descriptions written | hint / context used | before | after | remaining clauses |
|---|---|---:|---:|---|---|---|---|
| n07 | PDF (4.9 MB) | 5 | | | needs-answers | | |
| n35 | Word | 1 | | | needs-answers | | |
| n50 | Word | 1 | | | needs-answers | | |
| r27 | Word | 1 | | | needs-answers | | |

What "hint / context used" means: whether the context line (heading and
neighbouring text) and "open at page" were enough to write the description
without opening the file elsewhere. A yes/no per document, nothing more; it
is the qualitative half of the crop decision.

## The seven language documents

| document | hint shown | language declared | as suggested | 7.2-24/33/34 cleared | other clauses moved | verdict changed |
|---|---|---|---|---|---|---|
| n05 | en (fired) | | | | | |
| n22 | none (under the floor) | | — | | | |
| n23 | en (fired) | | | | | |
| n30 | none (inside the margin) | | — | | | |
| r06 | en (fired) | | | | | |
| r10 | en (fired) | | | | | |
| r14 | none (no token matched) | | — | | | |

"As suggested" is the workbench's derived line, not a note. The hint column is
pre-filled from `language-hint-results.md`; if the screen showed something
else, that is a finding, log it below.

## Wall clock

| segment | start | end | elapsed |
|---|---|---|---|
| open n07 → n07 re-run finished | | | |
| n35 | | | |
| n50 | | | |
| r27 | | | |
| **total (prediction 4)** | | | |
| the seven language documents (not in the prediction; recorded for the record) | | | |

Measured by one person on one sitting, wall-clock, including every wait on a
run. Interruptions are logged as a correction of kind *measurement*, not
subtracted.

## Corrections, logged rather than edited

- **Kind: _._** _(what the prediction assumed that the run showed
  otherwise — instrument scope, key, measurement, product. One bullet each,
  none edited into the tables.)_

## Predictions scorecard

Held: _. Missed without being falsified: _. Falsified: _.

## What this decides

- **Crops.** The registered rule: the wall clock decides whether the deferred
  crop step is worth building now that 379 of 380 open figures locate
  (`figure-geometry-2-results.md`). Under fifteen minutes for eight
  descriptions with the context line alone → crops stay deferred and the
  trigger is re-registered; over it, or a "no" in the context column → the
  crop step is the next item, with its own predictions first.
- **AI drafts and artifacting on a decision** keep their triggers in the plan;
  nothing here moves them.
- _(What else the numbers changed, if anything.)_
