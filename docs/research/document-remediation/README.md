# Document remediation — research index

Two experiments, a real-document run, a legal review, and two parallel-experiment
briefs. This is the entry point. **Read the three under "Start here" and you
have the whole picture.**

## Start here

| | |
|---|---|
| **[legal-standard.md](legal-standard.md)** | What the law actually requires, what it does not, the deadlines, the market rate, and the definition of good remediation. **The authoritative statement of what we are aiming at.** |
| **[working-agreement.md](working-agreement.md)** | How the project spent two experiments measuring the wrong thing, and the mechanisms that stop it recurring. |
| **[position-2026-08-25.md](position-2026-08-25.md)** | **The current position.** Zero of nine real documents reachable without a human, the options that leaves, and the recommendation. Supersedes `decision-2026-08-24.md`. |
| **[build-status-2026-08-26.md](build-status-2026-08-26.md)** | **Where the product is**, as opposed to what the pipeline can reach: which stages have graduated into `src/`, which of the seven legal criteria they cover, and what to build next. The first status about shipping code rather than measurements. |
| [decision-2026-08-24.md](decision-2026-08-24.md) | Superseded. Predates the zero-human constraint and both briefs. Carries a banner. |

## The current constraint

**Zero human input at any stage** (set 2026-08-24, after
`decision-2026-08-24.md` was written). That decision assumed a human supplied
the judgement, so it carries a banner. Measurements in it stand; assumptions
about human time do not.

## Where things stand

- **Straight-through automation does not work.** Nothing here delivers a finished
  document without a human. That conclusion survived the correction.
- **The blockers are not what we thought.** Legally, the nine real documents are
  blocked by a document title and alt text. The font-level failures we spent a
  classification on are not WCAG criteria at all.
- **The open liability is measured, and it is small.** Of 195 table headers
  asserted into nine real documents, **4 are wrong** — see
  [table-header-verification.md](table-header-verification.md). `Tables.java`
  stays.
- **Heading promotion has no working solution, and both candidates are now dead.**
  Typographic scoring promotes an address and a column header. A local layout
  model triples wrong-level assertions and is monotonically worse the more it is
  used. The current pipeline is the best measured.
- **Alt text has no safe option under zero-human.** The VLM was tested: it
  describes proof-of-posting photographs as "a poster on the wall" and "the
  building… the sky", never reaches the PDF's `/Alt`, and silently skips every
  image under 5% of page area.
- **North-star metric:** human minutes per page, target under 5. *Superseded by
  the zero-human constraint, but retained as the measure of how much work is
  left to automate.* First estimate
  is **~3–4 for a simple page and ~6 for a table-heavy one** — straddling the
  threshold. See [human-effort.md](human-effort.md).
- **The pipeline delivers less than the 98% figure suggests.** On both documents
  finished by hand it shipped zero headings and zero table headers. 98% of
  machine-checkable failures removed is not 98% of the work done.
- **Holdout 2 is sealed.** Both checkpoints unspent, and their value fell once
  real documents showed the synthetic corpus unrepresentative in kind rather
  than degree.

## Live runs — the shipping system against real sites

Measurements above come from the pipeline in `experiments/`. These three record
the **product** meeting real municipal sites, in order, and each one found
something no fixture had.

| | |
|---|---|
| [live-loop-verification.md](live-loop-verification.md) | Discovery → inspection, first contact. A correct zero (`.docx` invisible to a `.pdf`-only classifier), the crawl budget doing its job, and the extensionless-document miss caught live. |
| [live-conversion-verification.md](live-conversion-verification.md) | **The first real Word document converted end to end — 3s, tagged, zero gaps, no human input.** Also two production blockers: a service worker that crashed the server, and every document on the builder's CDN. |
| **[second-municipality-2026-08-27.md](second-municipality-2026-08-27.md)** | **n=2.** Download-capture catches its first real extensionless permalink — yesterday's error row is today's inspected inventory. The conversion audit trail proven with matching hashes on production, and the shared report carrying it all, anonymously. |
| **[conversion-on-production-2026-08-27.md](conversion-on-production-2026-08-27.md)** | **Conversion reaches production.** Six builds, four runtime gaps — NSS, the oosplash chain, fontconfig, and a dlopen no ELF walk can see — closed by a runtime-faithful local container. A real Word document to a tagged PDF through the deployed function in 8s, zero gaps. |
| **[production-verification-2026-08-26.md](production-verification-2026-08-26.md)** | **The deployed system, reached from the open internet.** The client's share link had never been deliverable — a hosting-configuration fault no suite can see. Plus what production measures: 242 links seen, 67 recorded, inspections 1.1–7.9s, and conversion honestly unavailable there. |

## Known open questions, so they are not rediscovered a fourth time

1. **Table header inversion.** `Tables.java` R1 treats the leading all-bold row
   as the header row. In a KPI summary block the emphasised row is the *values*,
   so four figures were marked as headers over their own labels. Known fix — a
   row of pure currency is not a header row — deliberately not implemented yet.
2. **Demotion-only caps what we can deliver.** `Headings.java` cannot add a
   heading, so a document whose real headings were never tagged gets zero
   headings from us — correctly and uselessly. **Brief A tests whether this is
   avoidable rather than solvable** — the structure exists in the source and is
   destroyed at export.
3. **The pipeline re-tags unconditionally.** Five of nine real documents arrived
   already tagged; one that was four failures from conformance came out with
   twenty-seven. Measured both ways in [tagged-input.md](tagged-input.md); no
   policy chosen.
4. **Form fields (4.1.2)** are untouched by the pipeline and unchecked by
   veraPDF's `ua1` profile. One of the nine real documents is a form.
5. **Nothing in `experiments/` meets the production boundaries.** 3,270 lines,
   outside the production `tsconfig`, in the eslint `ignores`, linted and
   typechecked by nothing.

**Closed:** contrast (1.4.3) was on this list as unmeasurable. It is now measured
— see [contrast-results.md](contrast-results.md). It had been listed twice and
stayed here for a day after it was solved, which is the drift the briefs below
exist to contain.

## The parallel experiments — both complete

Two questions measured in separate chats under a binding protocol. Both returned
measurements; synthesis is in [briefs-synthesis.md](briefs-synthesis.md) and
[brief-a-synthesis.md](brief-a-synthesis.md). **Neither drifted, and every number
in both reproduced when re-derived from raw output.**

| | question |
|---|---|
| **[briefs/README.md](briefs/README.md)** | **The protocol. Binding on both.** One question, a registered prediction, a fixed instrument, an explicit "not doing" list, and a stopping condition. |
| [briefs/source-document.md](briefs/source-document.md) | **A** — does the structure we cannot reconstruct from a PDF survive an export from its source? Our own corpus is authored as HTML with correct semantics and rendered by an exporter that deletes them. |
| [briefs/vlm-scale.md](briefs/vlm-scale.md) | **B** — is the alt-text wall the model, or the input? A falsification test of our own recorded conclusion, which came from a 256M model given no document context. |
| [source-export-results.md](source-export-results.md) | **A, result.** The exporter loses the H1 — but on an HTML-import quirk in our fixtures. `[V]` A native source exports `/H1 /H2 /H3` intact. |
| [vlm-scale-results.md](vlm-scale-results.md) | **B, result.** `[V]` 7B scores 6/6 content facts on bare pixels **and** fabricates a regulatory requirement under a real department's name. **Scale makes alt text more dangerous, not safer.** |
| [briefs-synthesis.md](briefs-synthesis.md) | **The joint finding: the source path omits, every inference path asserts.** Only one clears a gate set at zero assertions. |
| [source-native-results.md](source-native-results.md) | **C, result.** `[V]` Ten probes, zero assertions — the exporter does not infer. One systematic exception: it stamps `Scope=Column` on any header-styled cell. |
| **[real-tables-results.md](real-tables-results.md)** | **The scope repair fired 0 times on every real document.** Word holds up and is conformant; **Excel produces 0 header cells across 151 real tables** — no better than the incumbent. |
| [real-docx-results.md](real-docx-results.md) | A real municipal Word agenda, UA-1 conformant, zero human input. The title survives where clients' own toolchains lose it. |
| [tagged-reality.md](tagged-reality.md) | What "already tagged" means on real files: 8,504 elements of pure paragraphs, 0 header cells across 145 tables. |
| [prior-art-and-options.md](prior-art-and-options.md) | What already exists, what we duplicated, and the five options. |
| **[repair-results.md](repair-results.md)** | **21 assertions → 7, and the first document delivered clean from a source.** The scope the exporter invented is corrected after export; the repair that deleted images is deleted instead. |
| [repair-prediction.md](repair-prediction.md) | Registered before either repair was built. 5 hits, 1 miss. |
| **[instrument-correction.md](instrument-correction.md)** | **`compare.mjs` was blind to figure under-tagging; every number it produced is restated here.** Abstention is 13 assertions and 6 DELIVERABLE, not 8 and 8. Brief C's repaired arm asserts 21 times and delivers nothing. **Fixed and tested.** |
| [brief-c-synthesis.md](brief-c-synthesis.md) | **The scope repair is abstention, not interpretation** — and `compare.mjs` cannot see figure under-tagging, which puts every number since abstention in doubt. |

## Current — findings that still hold

| | |
|---|---|
| [real-documents-results.md](real-documents-results.md) | Nine real municipal PDFs, first contact. Robustness and conformance. *Its conformance framing is superseded by `legal-standard.md`; the measurements stand.* |
| [table-header-verification.md](table-header-verification.md) | The liability test. 4 of 195 asserted headers wrong, with the mechanism. |
| [picture-description-results.md](picture-description-results.md) | **VLM alt text tested: confident, fluent, wrong.** Worse than the placeholder it would replace. |
| [contrast-results.md](contrast-results.md) | **WCAG 1.4.3 now detectable.** Finds both planted defects and 3 of 9 real documents. |
| [tagger-comparison-results.md](tagger-comparison-results.md) | **A layout model made the pipeline worse** — 8 assertions to 26. Heading promotion still unsolved. |
| [tagger-comparison-prediction.md](tagger-comparison-prediction.md) | Prediction registered before testing four taggers against ground truth. |
| [heading-promotion-options.md](heading-promotion-options.md) | Options for heading promotion under a no-human constraint. The typographic scorer was built and killed. |
| [build-options.md](build-options.md) | How to build the three blocking conditions. No new dependency needed for any. |
| [human-effort.md](human-effort.md) | Two documents finished by hand. Work items, estimates, and what the 98% figure hides. |
| [tagged-input.md](tagged-input.md) | Both paths for documents that arrive already tagged. |
| [real-failure-classification.md](real-failure-classification.md) | Every remaining failure categorised. *Re-cut along WCAG in `legal-standard.md`.* |
| [abstention-results.md](abstention-results.md) | Global abstention: 16 assertions → 8, deliverables 5 → 8. Development corpora. |
| [abstention-prediction.md](abstention-prediction.md) | The prediction registered before that run. Kept as the record of a method that worked. |
| [holdout2.md](holdout2.md) | Freeze rules and checkpoint accounting. Both unspent. |
| [test-corpus.md](test-corpus.md) | The synthetic corpora. Still accurate as a description. |
| [evidence/](evidence/) | Raw per-document JSON behind every number. |

## Superseded — kept for the record, not to act on

| | why |
|---|---|
| [spike-decision.md](spike-decision.md) | Its STOP measured PDF/UA conformance, not the legal standard. Superseded by `decision-2026-08-24.md`; carries a banner. |
| [experiment-2-decision.md](experiment-2-decision.md) | Two of its three findings were falsified by the abstention run. Carries a banner. |
| [experiment-2-results.md](experiment-2-results.md) | Its development table predates the reading-order and list checks. Carries a banner. |
| [decision.md](decision.md) | Experiment 1's PROCEED WITH CONDITIONS. Condition 6 — run real documents — has now been answered. |
| [results.md](results.md) · [experiment-plan.md](experiment-plan.md) · [failure-classification.md](failure-classification.md) | Experiment 1. The A/B/C/D classification *method* is still the pattern we use; its conclusions are historical. |
| [experiment-2-plan.md](experiment-2-plan.md) | Experiment 2's plan, executed and closed. |
| [`../../superpowers/research/2026-08-23-document-remediation-options.md`](../../superpowers/research/2026-08-23-document-remediation-options.md) | The original options memo. **Contains known errors** — an incorrect AGPL explanation and an overstated Matterhorn claim, both marked withdrawn in place. It is also the root cause: it selected tools without establishing the legal standard. |

## Code

[`experiments/document-remediation/`](../../../experiments/document-remediation/)
— the pipeline, the comparator, the corpora. Its README covers setup and why it
does not look like `src/`.
[`real-sources.md`](../../../experiments/document-remediation/real-sources.md)
lists the nine real documents by URL and SHA-256; **the files themselves are
gitignored** and stay local.
