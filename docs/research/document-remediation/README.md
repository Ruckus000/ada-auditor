# Document remediation — research index

Seventeen documents accumulated here across two experiments and a real-document
run, with no entry point. This is the entry point. **Read the three under "Start
here" and you have the whole picture.**

## Start here

| | |
|---|---|
| **[legal-standard.md](legal-standard.md)** | What the law actually requires, what it does not, the deadlines, the market rate, and the definition of good remediation. **The authoritative statement of what we are aiming at.** |
| **[working-agreement.md](working-agreement.md)** | How the project spent two experiments measuring the wrong thing, and the mechanisms that stop it recurring. |
| **[spike-decision.md](spike-decision.md)** | The closing decision. **Read its correction banner first** — the STOP is withdrawn in part. |

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
- **North-star metric:** human minutes per page, target under 5. Never measured.
- **Holdout 2 is sealed.** Both checkpoints unspent, and their value fell once
  real documents showed the synthetic corpus unrepresentative in kind rather
  than degree.

## Known open questions, so they are not rediscovered a fourth time

1. **Table header inversion.** `Tables.java` R1 treats the leading all-bold row
   as the header row. In a KPI summary block the emphasised row is the *values*,
   so four figures were marked as headers over their own labels. Known fix — a
   row of pure currency is not a header row — deliberately not implemented yet.
2. **How many human minutes does a document actually cost?** Never measured.
   This is the north-star metric.
3. **The pipeline re-tags unconditionally.** Five of nine real documents arrived
   already tagged; one that was four failures from conformance came out with
   twenty-seven. Measured both ways in [tagged-input.md](tagged-input.md); no
   policy chosen.
4. **Contrast (1.4.3) and form fields (4.1.2)** are untouched by the pipeline and
   unchecked by veraPDF's `ua1` profile. One of the nine real documents is a form.
5. **Nothing in `experiments/` meets the production boundaries.** 3,270 lines,
   outside the production `tsconfig`, in the eslint `ignores`, linted and
   typechecked by nothing.

## Current — findings that still hold

| | |
|---|---|
| [real-documents-results.md](real-documents-results.md) | Nine real municipal PDFs, first contact. Robustness and conformance. *Its conformance framing is superseded by `legal-standard.md`; the measurements stand.* |
| [table-header-verification.md](table-header-verification.md) | The liability test. 4 of 195 asserted headers wrong, with the mechanism. |
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
