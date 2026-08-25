# The recommendation: audit documents, do not remediate them

**Date:** 2026-08-25 · A PM call, made on everything measured since 2026-08-23.

## The fact that decides it

`package.json`: **"Evidence-first ADA/WCAG accessibility auditor."**

`src/` carries `domain/evidence.ts`, `domain/discovery.ts`, `domain/policy.ts`,
`services/deterministic-audit.ts`, `findings-view.ts`, `report-html.ts`,
`score.ts`, `regression.ts`, `portfolio.ts`, `client-detail.ts`.

**We already sell evidence-first auditing to multiple clients.** Document
remediation was framed as a second service line, and for three days it has been
treated as a separate product. It is not the adjacent thing. **Auditing documents
is.**

The assertion/omission distinction we spent three experiments deriving is
*literally* evidence-first auditing applied to a PDF. Same thesis, same buyer,
same report.

## The insight that makes it obvious

`[V]` DOJ Title II exempts **archived** content and **pre-existing** documents —
unless the document is *currently used to apply for or access a service*
([legal-standard.md](legal-standard.md)).

**That exemption is a crawl question, and we already have the crawler.**
`domain/discovery.ts` knows which PDFs are linked from live pages. Nobody selling
document remediation can answer it, because they receive a folder of files with
no idea which ones the law actually reaches.

> **"You have 9,400 PDFs" → "these 340 are in scope, and 31 of them carry false
> claims."**

That is a report only this product can produce, and it is the single most useful
sentence a municipality facing an April 2027 deadline could be handed.

## Why not remediation

Every leg of the remediation case is now measured, and each one is weak:

| | |
|---|---|
| **PDF in, PDF out** | `[V]` **0 of 9** real documents reachable without a human. Closed. |
| **Alt text** | `[V]` Closed. A 7B model gets the facts right and fabricates a regulation under a real department's name. Scale makes it *undetectable*. |
| **Source-first, Word** | `[V]` Works — 2 for 2 on real files. |
| **Source-first, Excel** | `[V]` **0 header cells across 151 real tables.** No better than the incumbent. Fee schedules are spreadsheets. |
| **Do clients have sources?** | `[V]` **Unverified, and the evidence is discouraging** — we could not find one published municipal Word file with substantial tables. Municipalities publish PDFs, not sources. |
| **Are the sources any good?** | `[V]` No. A real agenda had zero headings; four of five real government Word files had no table at all. "Fix the source" means *authoring* structure, which is skilled human work. |
| **Is it differentiated?** | `[V]` No. Our tagger is at rough parity with Acrobat's free auto-tag, and axesWord already sells source-first remediation. |
| **Liability** | We would ship a file asserting compliance we have **proven we cannot guarantee**. |

**And a remediator's failures are invisible by construction.** That is the whole
finding of this project, and it is an argument for being on the other side of the
transaction.

## Why the audit is not the smaller business

The instinct is that auditing is a thinner product than remediation. On this
evidence it is not:

- **It applies to every document a client already has**, including ones a vendor
  already remediated. `[V]` Real "already tagged" files are 8,504 elements of pure
  paragraphs with zero headings — remediated in name, and nobody caught it.
- **It needs no cooperation** — no source files, no client workflow change.
- **It is a wedge.** Audit reveals the problem; remediation is the upsell, later,
  against a scoped list. Audit-first is how remediation gets sold anyway.
- **It compounds with the existing product.** Same client, same report, same
  score, same regression tracking. Website findings and document findings in one
  portfolio view.

## What ships, and what it reuses

`[V]` **Five of six assertion detectors are already written**, and none needs
ground truth — they work on any PDF from any source:

| detector | where it already lives |
|---|---|
| `/TH` scoped Column while sharing a row with `/TD` | `FixScope.java` — the rule, now as a *finding* |
| heading levels that skip | `Headings.java` R8 |
| placeholder alt (`"image 1"`) | `compare.mjs` |
| image drawn on the page but artifacted out of the tree | `Inspect.java` (`images` vs `figures`) |
| a table where no cell references content | `Tables.java` R0 |
| contrast below threshold | `Contrast.java` |

**The sixth** — a `/Figure` count that cannot be checked without ground truth —
is simply not built. The five that work are the product.

**Parked, not deleted:** the tagging pipeline, `repair-source.py`, the export
path, `FixScope`'s repair mode. All measured, all documented, all available if
remediation is revisited.

## What this does not do

**It does not fix anyone's documents.** The client still has to remediate, or
hire someone, or — per the practitioner consensus we independently rediscovered —
**publish a web page instead of a PDF.** That recommendation belongs *inside* the
audit report, which is where option C actually pays.

## What would change this call

**A client already asking to buy remediation.** That is commercial information I
do not have. If one exists and will pay, the calculus changes — but it would be a
services engagement priced per page, not the automated product we set out to
build, because `[V]` the automation cannot reach a finished document without a
human.
