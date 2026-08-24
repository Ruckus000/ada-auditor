# Document remediation — options review

**Status:** research only. Nothing approved, nothing to build.
**Date:** 2026-08-23 · **Revision:** 2, after external review

## How to read this document

Revision 1 was criticised, correctly, for sliding from "supported by evidence"
into "sounds plausible" without marking the transition. Every substantive claim
below is now graded:

| Tag | Meaning |
|---|---|
| **[V]** | Verified against a primary or vendor source, cited |
| **[R]** | Reported by a secondary source; plausible, not independently confirmed |
| **[H]** | **Hypothesis.** Our inference. Not established. Must be tested before it carries weight |

**Nothing tagged [H] may be used to justify an architectural decision.**

This is not legal advice. Licensing conclusions in §3 should be validated by
counsel before they bind a production decision.

## Constraints fixed before research

- **Deliverable:** a remediated file, not just a report
- **PII:** bytes never leave our infrastructure
- **Budget:** ~$50/month at roughly 1,000 documents/month
- **Residual work:** a document we cannot fully remediate is not delivered as
  remediated — it returns `inconclusive`, mirroring the existing rule that
  incomplete evidence never becomes a pass
- **Inference:** extract → small local model → refuse. No frontier API in v1.

---

## 1. What validation can and cannot establish

**[V]** The Matterhorn Protocol 1.1 translates ISO 14289-1 (**PDF/UA-1**) into
31 checkpoints and 136 failure conditions: **87** determinable by software
alone, **47** usually requiring human judgement, **2** with no determined test
method.

**[V]** veraPDF states that for PDF/UA it performs only machine-verifiable
checks.

**[V]** The PDF Association frames the 47 as conditions that *may* require human
judgement, and notes software can assist substantially with them.

### The claim we can defend

> Passing veraPDF's PDF/UA validation is **necessary** evidence of
> accessibility, and is **not by itself sufficient** evidence of full semantic
> accessibility.

Revision 1 said the product "cannot honestly promise PDF/UA conformant... by
anyone, at any price." **That was overstated and is withdrawn.** The evidence
establishes that veraPDF alone cannot prove full conformance. It does not
establish that no automated system could ever make that determination.

**[!] Scope caveat:** 87/47/2 is specifically Matterhorn 1.1 against PDF/UA-1.
veraPDF supports both PDF/UA-1 and PDF/UA-2. **Do not carry the "87 machine
checks" figure into a PDF/UA-2 product claim** without separately validating
that mapping.

### What does not change

The softer claim leaves the architecture untouched. We still cannot
machine-certify the human-judgement conditions, so they still need a review
queue — and that queue already exists conceptually:

| Web audit (existing) | Document remediation |
|---|---|
| axe `violations` | Machine-checkable Matterhorn failures |
| axe `incomplete` → `needs-review` | Human-judgement conditions → `needs-review` |
| Undecided checks excluded from score | Human-judgement conditions excluded from score |
| Incomplete evidence → `inconclusive` | Unparseable document → `inconclusive` |

`AGENTS.md` already carries the governing sentence: *"A check axe could not
decide never fails a run... They are the human-review queue."*

---

## 2. Landscape

### 2.1 Validation

**veraPDF** — PDF Association-governed validator formalising each "shall"
statement in PDF/UA-1 and PDF/UA-2. Java. **[V]** Dual-licensed GPLv3 / MPLv2;
the MPL branch is usable in commercial SaaS. Validates only — fixes nothing.

### 2.2 Tagging engines

**OpenDataLoader PDF** — `opendataloader-project/opendataloader-pdf`

- **[V]** Apache 2.0; Java 11+; GPU not required
- **[V]** Developed with Hancom and **Dual Lab, the veraPDF developers**
- **[V]** Generates Tagged PDFs end-to-end
- **[V]** Published pipeline and commercial boundary:

  | Stage | Cost |
  |---|---|
  | Audit (detect untagged, read existing tags) | Free |
  | Auto-tag → Tagged PDF | **Free, Apache 2.0** |
  | **Export PDF/UA-1 / PDF/UA-2** | **Enterprise** |
  | Visual editing workspace (review/adjust/approve tags) | **Enterprise** |

- **[V]** XY-Cut++ reading order; heading hierarchy; table extraction
- **[V]** **Built-in OCR, 80+ languages**
- **[V]** Optional "hybrid" LLM enhancement for OCR and complex tables, claimed
  93% table accuracy in their benchmarks
- **[V]** Alt text generation for images or charts is **not documented** in
  their material
- **[V]** Does not process Word/Excel/PowerPoint
- **[V]** Their Python SDK spawns a **JVM process per `convert()` call** — a
  per-document cost, not a one-time startup cost

**Docling** — `docling-project/docling`
- **[V]** MIT; IBM Research Zurich; hosted by the **LF AI & Data Foundation**
- **[R]** ~30k stars
- **[V]** RT-DETR layout analysis on DocLayNet; **TableFormer v2** for table
  structure including borderless tables, spans, hierarchical headers
- Python + PyTorch — a second runtime and a much heavier image
- **[V]** Extracts structure; does **not** write tagged PDFs

### 2.3 Reference implementations

**ASU CIC — `ASUCICREPO/PDF_Accessibility`** — **[V]** MIT. AWS CDK; S3; Lambda
for split/merge; Step Functions orchestration; ECS Fargate for containerised
work. **[V]** The PDF-to-PDF track **depends on the Adobe PDF Services API**
(enterprise contract or trial). **[V]** Self-describes as *"not suitable for
production"* with *"relaxed authentication and authorization."*

*Read:* a well-funded university AI centre attempted this and still bought
Adobe for tagging. Two patterns worth stealing: **split → parallel-process →
merge** for large documents, and keeping the toolchain containerised and
orchestrated from outside.

**AccessPDF — `laurenaulet/accesspdf`** — **[V]** Apache 2.0, Python, ~2 stars,
~37 commits. **Too small to depend on.** Valuable for candour: **[V]**
PowerPoint-derived PDFs work poorly; scanned PDFs need OCR first; *"AI alt text
always needs human review"* — inaccurate for charts and technical figures.
**[V]** Uses Ollama + LLaVA locally by default, confirming the local-model tier
is a route others take.

**Pdf-Acc-Toolset — `aMytho/Pdf-Acc-Toolset`** — client-side WASM remediation.
**[V]** Built on iText, which is AGPL — see §3.

### 2.4 Local vision models (alt-text tier)

| Model | Params | Licence | Note |
|---|---|---|---|
| Florence-2-base | ~0.23B | **[V]** MIT | Purpose-built captioning |
| Moondream 2 | 1.9B / 0.5B | **[V]** Apache 2.0 | 0.5B targets constrained hardware |
| SmolVLM / SmolVLM2 | 256M–2.2B | **[V]** Apache 2.0 | Explicitly on-device |

**[H]** ONNX Runtime rather than PyTorch will give a materially smaller image
and faster CPU start. Untested here.

---

## 3. Licensing

**Not legal advice. Validate with counsel before production.**

### Assessed usable in commercial SaaS

veraPDF (MPLv2 branch), OpenDataLoader (Apache 2.0), Docling (MIT), Apache
PDFBox (Apache 2.0), qpdf (Apache 2.0), pikepdf (MPL-2.0), LibreOffice
(MPL-2.0), Tesseract (Apache 2.0), Florence-2 (MIT), Moondream 2 / SmolVLM
(Apache 2.0). All **[V]**.

### Excluded

**PyMuPDF / MuPDF / Ghostscript** — **[V]** AGPL-3.0, owned by Artifex, offered
under a dual AGPL/commercial model.

*Correction from revision 1.* That document justified exclusion by asserting
"the AGPL network clause" automatically requires a commercial licence for any
SaaS backend use. **That explanation was wrong.** AGPL §13's network-source
obligation concerns users interacting remotely with a *modified* version of the
Program; it is not a blanket rule that any AGPL dependency forces an entire
SaaS application open.

The defensible basis is narrower and vendor-specific: **[V]** MuPDF's own
licensing guidance states that using MuPDF as part of a SaaS installation
requires that installation to be AGPL-compatible. We exclude these components
on **Artifex's stated licensing position**, not on a general theory of the AGPL.

**iText** — **[V]** AGPL; commercial licence otherwise.

**OCRmyPDF** — **[R]** its documentation has historically warned SaaS operators
about its own and Ghostscript's licensing. Treat as *"historically problematic
for our licensing model; verify against the current release and deployment mode
before use,"* not permanently excluded. **[V]** Moot if we use OpenDataLoader,
which has OCR built in.

`pikepdf` (MPL, wraps qpdf) is the clean substitute for PyMuPDF — **but see
§5.4 on the runtime cost of introducing Python.**

---

## 4. THE PRIMARY TECHNICAL RISK

Everything else in this document is secondary to one unresolved question.

**OpenDataLoader gives us Tagged PDF free. PDF/UA export is enterprise. We do
not know how wide that gap is.**

**[H]** Revision 1 characterised the gap as "largely deterministic metadata
work" — XMP `pdfuaid:part`, `dc:title`, `/Lang`, `/MarkInfo << /Marked true >>`,
`ViewerPreferences /DisplayDocTitle true`, artifact marking. **This was
speculation stated as engineering fact and is downgraded to a hypothesis.**

Evidence against it: **[V]** OpenDataLoader deliberately positions PDF/UA
conversion as a distinct enterprise *stage*, not a metadata flag. Their
enterprise tier also includes a **visual editing workspace for reviewing and
approving tags before export** — which suggests the vendor's own model of
getting to PDF/UA involves a human review step, not merely a conversion.

Apache 2.0 grants the right to build on the free output. Whether doing so is a
weekend or a re-implementation of proprietary remediation logic is unknown.

### The fork

- **If** free output plus a modest PDFBox finishing pass reliably clears the
  machine-checkable conditions → the free-tooling premise holds and the $50
  product is plausible.
- **If** it requires reproducing substantial proprietary logic → the
  architecture changes fundamentally and this proposal needs rewriting.

**No design work should begin before this is answered.**

---

## 5. Other pitfalls

### 5.1 Auto-tagging is a starting point, including commercially

**[V]** Adobe's auto-tagging is described as not "smart" — based on static
definitions derived from publishing-tool styling. **[V]** Acrobat Pro marks
reading order evaluation as "Needs Manual Check." **[R]** Experienced
remediators frequently delete large parts of auto-generated tags and redo them.

Known failure modes: complex and borderless tables; multi-column reading order;
heading inference (inherits the source document's sins); PowerPoint-derived
PDFs; scanned documents without OCR.

**[H]** Our auto-remediation rate will land below what free tooling's marketing
implies, making `inconclusive` the common case rather than the exception. To be
measured, not assumed.

### 5.2 Never treat remediation as sanitization

Hostile PDFs are hostile binaries. The threat surface is far larger than
JavaScript and attachments: actions, launch behaviour, rich media, malformed
object graphs, URI actions, XFA, pathological decompression, font parsing.

Revision 1 implied that stripping JavaScript and attachments yields safe
output. **It does not.** The invariant:

> **Remediation is not sanitization.** Input is processed in an isolated,
> network-disabled environment under resource limits. Output passes an explicit
> sanitization policy plus fresh independent parsing and validation before
> delivery.

**[V]** OCRmyPDF makes essentially this warning about itself — it is not
designed as a sanitization tool and should not be exposed directly to malicious
public input. Ours should carry the same warning internally.

External references in documents (`/URI` actions, remote images) are an SSRF
vector — the document analogue of the guard
`integrations/browser/target-url.ts` already implements.

### 5.3 PII lives where people forget

XMP and DocInfo metadata carry author names, organisation, and local file paths
(`C:\Users\jsmith\...`). **Fake redactions** — black rectangles over live text —
leave text extractable, and our extraction *will* pull it into memory, logs, and
model calls. **Never log document text**; `tests/services/log-shape.test.ts`
already greps the tree for hand-built JSON envelopes and the technique extends.

### 5.4 The runtime story is messier than "one JVM"

Revision 1 recommended "OpenDataLoader + veraPDF + pikepdf/PDFBox — one JVM
image." **That contradicts itself: pikepdf is Python.**

**[V]** OpenDataLoader's Python SDK spawns a JVM process per `convert()` call.
So even the Java path carries per-document process-spawn cost.

**[H]** Restricting the finishing pass to **PDFBox only** keeps the stack to one
runtime and one image. This is preferable if PDFBox can do the required
object-level work; whether it can is untested.

### 5.5 Local inference is not free

Revision 1's cost table listed local inference at **$0**. That is external-spend
accounting presented as total cost, and it contradicted this document's own
conclusion that compute is the binding constraint.

Local inference consumes CPU time, memory, image size, cold-start latency,
concurrency capacity, and engineering maintenance. The correct budget lines:

| Line | Value |
|---|---|
| External inference / API spend | **$0** — the real saving, and it is real |
| Local inference compute | **Included in measured compute cost. Currently unmeasured.** |

On a $50/month budget where compute is the constraint, this distinction decides
whether the product is viable.

---

## 6. Experiments required before any design

Ordered by how much they can invalidate.

1. **[PRIMARY — §4]** Take **10–20 genuinely ugly real PDFs** — multi-column,
   complex tables, scanned, PowerPoint-derived. Run free OpenDataLoader → a
   PDFBox finishing pass → veraPDF. **Record exactly which machine-checkable
   failure conditions remain.** This answers whether the product exists.
2. **Benchmark OpenDataLoader's own capabilities before building around them.**
   Its OCR and hybrid LLM table mode may already cover work we planned to
   build. Critically: **determine whether hybrid mode can target a local
   endpoint** — if it only calls a hosted provider, it is incompatible with the
   PII constraint and must be disabled.
3. Measure sandbox CPU-seconds, peak memory, and JVM-per-document spawn cost.
4. Alt-text quality from Florence-2 / Moondream on **document figures**, not the
   photographs these models are benchmarked on.
5. Real client input mix — source documents vs. PDF-only. Unknown, and it
   decides whether the far easier source-document path is worth building.
6. Frequency of scanned/image-only documents.

---

## 7. Provisional direction

Nothing approved. Contingent on experiment 1.

- **Engine:** OpenDataLoader (Apache 2.0) for layout, OCR, and tagging; veraPDF
  (MPL) for independent validation; PDFBox for the finishing pass.
- **Alt text:** caption extraction first; a local small VLM second;
  `inconclusive` third. No frontier API. **[H]** — pending experiment 4.
- **Validation is independent of the fixer.** The fix engine's claim to have
  fixed something is not evidence; only a fresh veraPDF run over the *output
  bytes* counts. This is the existing evidence-first stance, unchanged.
- **Claim:** veraPDF passage is necessary but not sufficient; human-judgement
  conditions are listed for review. Never bare "conformant."
- **Known debt:** `src/services/ai-advisory.ts:1` imports the Anthropic SDK
  directly, contradicting `AGENTS.md:86`, which places AI providers in
  `/src/integrations`. Adding a second model consumer is the moment to
  introduce a port and move the existing adapter behind it.

## Sources

- Matterhorn Protocol 1.1 — https://pdfa.org/wp-content/uploads/2021/04/Matterhorn-Protocol-1-1.pdf
- veraPDF validation docs — https://docs.verapdf.org/validation/
- veraPDF PDF/UA-1 rules — https://github.com/veraPDF/veraPDF-validation-profiles/wiki/PDFUA-Part-1-rules
- OpenDataLoader PDF — https://github.com/opendataloader-project/opendataloader-pdf
- OpenDataLoader accessibility pipeline — https://opendataloader.org/accessibility
- OpenDataLoader site (OCR, hybrid mode, tiers) — https://opendataloader.org/
- Docling — https://github.com/docling-project/docling
- ASU CIC PDF_Accessibility — https://github.com/ASUCICREPO/PDF_Accessibility
- AccessPDF — https://github.com/laurenaulet/accesspdf
- Pdf-Acc-Toolset — https://github.com/aMytho/Pdf-Acc-Toolset
- Artifex licensing — https://artifex.com/licensing
- Equidox, "The Truth about Auto-Tagging PDFs" — https://equidox.co/blog/the-truth-about-auto-tagging-pdfs/
- AbilityNet, Adobe cloud auto-tagging evaluation — https://abilitynet.org.uk/news-blogs/evaluating-adobes-new-cloud-based-auto-tagging-feature-pdf-accessibility
- Benchmarking PDF Accessibility Evaluation (arXiv 2509.18965) — https://arxiv.org/pdf/2509.18965
- Step-by-Step PDF Remediation to Improve Tag Accuracy (arXiv 2503.22216) — https://arxiv.org/pdf/2503.22216
- SmolVLM — https://huggingface.co/blog/smolvlm
