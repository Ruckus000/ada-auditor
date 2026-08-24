# Document remediation feasibility spike — experiment plan

**Status:** Phase 0 complete. Nothing built, no product decision taken.
**Date:** 2026-08-23

## Research question

Can OpenDataLoader's free Tagged PDF output, followed by a modest deterministic
finishing pass using PDFBox, reliably get representative PDFs through the
machine-verifiable PDF/UA checks performed by veraPDF?

We do not know the answer, and the experiment is not designed to produce a
particular one.

## Hypothesis

**[H]** The gap between OpenDataLoader's free Tagged PDF output and PDF/UA-1 is
largely deterministic document-level work — XMP `pdfuaid:part`, `dc:title`,
`/Lang`, `/MarkInfo << /Marked true >>`, `ViewerPreferences /DisplayDocTitle` —
and can be closed with a small PDFBox pass.

This is a hypothesis, not a finding. Evidence already exists against it:
OpenDataLoader positions PDF/UA conversion as a distinct enterprise stage and
bundles a visual tag-review workspace with it, which suggests their own route to
PDF/UA includes human review rather than a metadata flag.

## Success and failure criteria

**Kill criterion, set by the user, overriding all others:** if clearing the
remaining failures requires **any** category C work — structure-tree surgery,
re-parenting elements, synthesising table header relationships — the
recommendation is **STOP**. It fires regardless of how close the pass rate looks.

| Outcome | Meaning |
|---|---|
| **PROCEED** | Free OpenDataLoader plus a category-A-only finishing pass clears the machine-verifiable checks on representative documents. No category C required. |
| **PROCEED WITH CONDITIONS** | Viable, but specific measured problems must be addressed before product work. |
| **STOP** | Category C required, i.e. we would be building our own remediation engine. |

Per-document classification: `DELIVERABLE` · `NEEDS_REVIEW` · `INCONCLUSIVE`.
Uncertainty is never recorded as success.

## Pinned tool versions

Verified from the installed artefacts, not from vendor web pages.

| Tool | Version | Licence | How verified |
|---|---|---|---|
| Java (Homebrew OpenJDK) | 17.0.17 | — | `java -version` |
| veraPDF greenfield | **1.30.2** | GPL v3 **and MPL v2 or later** | printed by `verapdf --version` itself |
| Apache PDFBox (`pdfbox-app`) | **3.0.8** | Apache 2.0 | Maven Central coordinates |
| `@opendataloader/pdf` | **2.5.0** | Apache-2.0 | installed `package.json` + bundled `LICENSE` |
| Node | v20.20.2 | — | satisfies the package's own `engines: >=20.19.0` |

The MPL branch of veraPDF is what makes it usable here; that dual licence is
asserted by the binary's own version banner. **Not legal advice** — licensing
conclusions should be validated by counsel before they bind production.

## Phase 0 findings

**[V] `--format tagged-pdf` is available with no licence or activation
mechanism.** The open-source CLI exposes no PDF/UA export option at all and
contains no licensing gate — the enterprise feature is simply absent from the
artefact rather than locked within it. The open-core boundary is confirmed from
the binary, not from marketing.

**[V] veraPDF ships Well-Tagged PDF flavours alongside PDF/UA.** Available
flavours are `1a 1b 2a 2b 2u 3a 3b 3u 4 4f 4e ua1 ua2 wt1r wt1a`. `wt1a` is the
PDF Association's Well-Tagged PDF profile — precisely what OpenDataLoader
targets.

*This changes the measurement design.* We validate every artefact against
**both `wt1a` and `ua1`**. The delta between them **is** the open-core gap,
measured directly rather than inferred. A document passing `wt1a` and failing
`ua1` tells us exactly what the enterprise tier would have done.

**[V] Hybrid mode runs a local server, so it is compatible with the PII
constraint.** `--hybrid` takes `docling-fast` or `hancom-ai` and, per its own
help text, "requires a running server" started locally
(`opendataloader-pdf-hybrid --port 5002`); `--hybrid-url` points at a server we
operate. This is self-hosted inference, not a hosted API, and it answers open
question 2 from the research review. Out of scope for this spike, but it no
longer threatens the bytes-never-leave-our-infra promise.

**[V] veraPDF has a `--fixmetadata` flag.** Potentially relevant in Phase 4 —
though a fix applied by veraPDF and then validated by veraPDF needs care, since
the spike's stance is that a fixer never validates itself.

**[V] PDFBox ships a `fromimage` subcommand**, so corpus document 09
(image-only/scanned) needs no custom Java.

**[V] Adding the npm package touched only what was intended:** a single
`devDependencies` line and 27 lines of lockfile.

**Operational note:** veraPDF's launcher prints "Unable to locate a Java
Runtime" before succeeding unless `JAVA_HOME` is set. All experiment commands
export `JAVA_HOME=/opt/homebrew/opt/openjdk@17`.

**No licensing or installation issue invalidates the experiment.** Phase 1 may
proceed.

## Reproduction

From the repository root:

```bash
npm ci
experiments/document-remediation/fetch-tools.sh
```

Then from `experiments/document-remediation/`, with
`export JAVA_HOME=/opt/homebrew/opt/openjdk@17`:

```bash
node make-images.mjs                                  # corpus PNGs (deterministic)
node generate-corpus.mjs                              # phase 1: corpus -> out/corpus
node validate.mjs out/corpus out/phase2-baseline      # phase 2: baselines
node run-opendataloader.mjs                           # phase 3: free tagged-pdf path
node validate.mjs out/phase3-tagged out/phase3-validated
"$JAVA_HOME/bin/javac" -cp vendor/pdfbox-app-3.0.8.jar -d out/classes Finish.java
node run-finishing.mjs                                # phase 4: category-A pass
node validate.mjs out/phase4-finished out/phase5-final  # phase 5: independent validation
node check-fixes.mjs                                  # regression assertions
node report.mjs                                       # results table -> out/results.json
```

`validate.mjs` is the same script in all three phases; the fixer never
validates itself.

## Measurements collected

Per document: type, page count, initial failure count and rule IDs, failures
after OpenDataLoader, failures after the finishing pass, **new failures
introduced**, OpenDataLoader time, finishing time, veraPDF time, total time,
peak memory where practical, input bytes, output bytes, classification, reason,
and lines of custom remediation code attributable to it.

Also, given the Phase 0 finding: `wt1a` and `ua1` results separately at every
stage.

Aggregates: machine pass rate, straight-through remediation rate, needs-review
rate, inconclusive rate, median processing time, p95 if the sample permits, peak
observed memory.

## Non-goals

Not built, not designed, not discussed here: the production feature; vision
models (Florence-2, Moondream, any frontier API); databases; cross-document
caching; review UI; billing; queues; monitoring; abstractions or ports;
refactoring of production code; solving every PDF.

The finishing layer must not be silently expanded until the tests pass. **The
experiment is allowed to fail, and a negative result is a useful result.**

## Evidence discipline

`[V]` verified by our own observation or primary documentation · `[R]` reported
by another source, not reproduced by us · `[H]` our inference, not established.
`[H]` never becomes `[V]` without evidence. Our measurements override vendor
claims.
