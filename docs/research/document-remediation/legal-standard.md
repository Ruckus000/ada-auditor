# What the law actually requires

**Date:** 2026-08-24 · **Not legal advice.** This is product scoping by an
engineer reading public sources. The rule-to-criterion mapping below is my
judgement and is marked as such so it can be argued with rather than inherited.
Anything that becomes a client commitment needs counsel.

## The finding that changes the spec

**We measured the wrong thing for the whole project.**

Every gate in this spike was built on **veraPDF PDF/UA conformance**. PDF/UA
(ISO 14289) is a structural standard for how a PDF is built. It is not what
anyone is legally required to meet.

The operative standard for US public entities is **WCAG 2.1 Level AA**, adopted
by the Department of Justice's Title II final rule of 24 April 2024, which
explicitly covers PDFs, word processor files, presentations and spreadsheets —
not only web pages.
([DOJ rule summary](https://www.civicplus.com/blog/wa/dojs-rule-web-accessibility-state-local-governments-need-to-know/),
[ADA Title II document accessibility](https://247accessibledocuments.com/what-ada-title-ii-means-for-pdf-and-document-accessibility/))

PDF/UA is a well-regarded *means* of achieving WCAG inside a PDF. It is not the
requirement.

## Deadlines — there is a clock, and it is close

| entity | compliance date |
|---|---|
| public entities, population **≥ 50,000** | **26 April 2027** |
| public entities **< 50,000**, and special district governments | **26 April 2028** |

Both were extended by one year in April 2026.
([Jackson Lewis](https://www.jacksonlewis.com/insights/doj-extends-public-entities-compliance-deadline-ada-related-website-accessibility-hhss-may-2026-deadline-still-looms),
[Consumer Financial Services Law Monitor](https://www.consumerfinancialserviceslawmonitor.com/2026/04/doj-extends-title-ii-ada-web-accessibility-rule-compliance-deadlines-for-state-and-local-governments/),
[University of Arizona](https://accessibility.arizona.edu/news/doj-issues-interim-final-rule-title-ii-digital-accessibility-compliance-dates))

These are law-firm and university summaries, not the Federal Register text.
**Confirm with counsel before either date appears in a client-facing document.**

It is August 2026. Every municipality whose documents we pulled has a deadline
eight to twenty months out.

## The exceptions, which scope the job

The rule does **not** require every historical PDF to be remediated. Two
exceptions matter commercially:

- **Archived content** — created before the compliance date, kept solely for
  reference, research or recordkeeping, in an archived area, unmodified since.
- **Pre-existing conventional electronic documents** — PDFs, word processor
  files, presentations and spreadsheets that were already on the site before the
  compliance date.

Both fall away if the document is **currently used to apply for or access a
service, programme or activity**. And in every case an accessible version must
still be provided **on request**.
([University of Virginia](https://digitalaccessibility.virginia.edu/doj-exceptions),
[ALA](https://www.ala.org/accessibility/ada-rule-exceptions))

**This changes the shape of an engagement** from "remediate ten thousand
documents" to: identify the actively-used subset, remediate that, and stand up a
request process for the rest. Finite, scopeable, and much easier to sell.

## Re-scoring our nine real documents

Mapping each remaining veraPDF failure to the WCAG criterion it implicates.
**My judgement, not a legal opinion:**

| veraPDF rule | WCAG 2.1 AA criterion |
|---|---|
| `7.1-9` metadata dc:title | 2.4.2 Page Titled |
| `7.3-1` Figure without alt | 1.1.1 Non-text Content |
| `7.20-2` Form XObject outside structure | 1.3.1 Info and Relationships |
| `7.18.3-1` `/Tabs S` on annotated pages | 2.4.3 Focus Order — weak |
| `7.21.4.1-1` font not embedded | **none** |
| `7.21.4.2-2` CIDSet incomplete | **none** |
| `7.21.5-1` glyph widths inconsistent | **none** |
| `7.10-1` optional content config `Name` | **none** |

**Six of the twenty remaining failures have no WCAG counterpart at all.** Those
are the "category E" failures I used to justify a STOP recommendation.

What actually blocks the nine, legally:

| criterion | documents |
|---|---:|
| **2.4.2** document title | 6 |
| **1.1.1** alt text | 5 |
| 2.4.3 focus order (weak) | 2 |
| 1.3.1 info and relationships | 1 |

A title is one field. Alt text is a person writing a sentence per meaningful
image — skilled work, but human work, not a technical barrier.

### The counter-argument, recorded rather than smoothed over

*Not legally required* is not *safe to skip*. Several sources hold that meeting
WCAG 2.1 AA inside a PDF in practice requires the structural conformance PDF/UA
provides, and that organisations under Title II should target both
([Siteimprove](https://www.siteimprove.com/blog/pdf-ua-vs-wcag-document-accessibility-standards/),
[University at Buffalo](https://www.buffalo.edu/access/digital/content/documents/pdf/wcagvspdfua.html)).

So the six inert failures are not what gets a client sued, but they may well be
what gets our deliverable rejected by a client's own QA, or by the accessibility
consultant they hire to check us. That is a commercial risk rather than a legal
one, and it should be priced rather than dismissed.

## What nothing we measure covers

veraPDF's `ua1` profile does not check these, and neither does our comparator:

- **1.4.3 Contrast (Minimum)** — a source-design problem. It cannot be fixed by
  tagging, and faking it would be worse than flagging it.
- **4.1.2 Name, Role, Value** — form field labels. One of our nine real
  documents is an AcroForm and the pipeline does not touch form fields at all.

Any claim we make must exclude these explicitly or cover them by other means.

## What the incumbents already do

The relevant question is not "can this be automated" but "is our automation
worth anything given what already exists."

Adobe Acrobat's auto-tagging is positioned as a starting point, not a solution.
The published limitations are strikingly close to our own measured results: it
cannot interpret styling variation and may tag structurally different content
identically; complex tables are "sometimes not ideal and need further
remediation"; complex layouts cause misread reading order and heading levels;
and **reading order and colour contrast always require a manual check.**
([Equidox](https://equidox.co/blog/the-truth-about-auto-tagging-pdfs/),
[AbilityNet](https://abilitynet.org.uk/news-blogs/evaluating-adobes-new-cloud-based-auto-tagging-feature-pdf-accessibility),
[University of Nevada, Reno](https://www.unr.edu/digital-learning/accessibility/pdfs/advanced-remediation))

**Conclusion: our pipeline is at rough parity with the incumbent's automated
step, not behind it.** That is worth knowing and it is not a moat. The
differentiators available to us are cost (local, zero external spend, seconds
per document, no per-seat licence) and the evidence trail — not tagging quality.

## The economics

| | |
|---|---|
| manual remediation, market range | **$5–25 per page** |
| published vendor rates | $4–11.50 per page |
| automated-only tooling | $0.30–2 per page |

([Venngage](https://venngage.com/blog/pdf-accessibility-cost/),
[Accessible.org](https://accessible.org/services/pdf-remediation/),
[Equidox](https://equidox.co/blog/pdf-remediation-pricing-am-i-getting-a-good-deal/))

At **$8/page** against a **$50/hr** loaded remediator: break-even is ~9.6 minutes
per page, and a 50% gross margin needs **under ~4.8 minutes per page**.

**North-star metric: human minutes per page. Target under 5.** Conformance
rates, assertion counts and deliverable rates are diagnostics and are never
reported as the answer.

Note also that outsourcing does not remove the buyer's internal cost — someone
still manages the vendor and QAs the output
([AccessiTool](https://www.accessitool.com/blog/pdf-remediation-services-when-to-outsource-accessibility-compliance-2026)).
Reducing *their* QA burden is a place to compete.

## What good remediation is

The pass mark this project never had. A document is defensibly remediated when:

| | criterion |
|---|---|
| structure reflects the real document — headings, lists, tables with true header relationships | 1.3.1 |
| reading order is meaningful | 1.3.2 |
| meaningful images carry accurate alt text; decorative ones are artifacts | 1.1.1 |
| the document has a title | 2.4.2 |
| the document declares its language | 3.1.1 |
| form fields are labelled, where forms exist | 4.1.2 |
| contrast has been checked, and failures flagged rather than faked | 1.4.3 |

…**and there is a record of what a human verified versus what a machine
asserted.** That last line is not a nicety. Our pipeline put 195 table header
cells into nine real documents and verified none of them; under 1.3.1 a wrong
header is not a missing fix, it is a manufactured barrier shipped with a
confident report.

## Why the deliverable is evidence

**There is no safe harbor.** No certificate stops a claim. Demand letters plead
specific barriers — image-only PDFs that screen readers cannot read, missing
tags, wrong heading structure, wrong reading order, untagged tables, images
without alt text, unlabelled form fields
([Milestone](https://blog.milestoneinternet.com/web-design-promotion/pdfs-and-images-may-be-ada-non-compliant-creating-risk-of-lawsuits/),
[Rapson](https://rapsontechnologies.com/pdf-accessibility-lawsuit-guide/)).

What answers those is a documented, systematic, good-faith process: what was
checked, what was fixed, what remains, who decided, and a working request
process for the rest.

**So the product is the evidence, and the remediated file is a by-product.**
That inverts the original spec, which was a file-transformation service with the
report as an afterthought.
