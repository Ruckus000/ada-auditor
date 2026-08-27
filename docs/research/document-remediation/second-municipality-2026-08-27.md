# The second municipality: download-capture meets its first real permalink

**Date:** 2026-08-27. Milestone 2 of the roadmap: the full loop — crawl →
inventory → inspect → convert → client report — against a **second** real
municipality, on production, closing the n=1 caveat both earlier live docs
carried. Same privacy stance: structure, hostnames, counts, wall times; no
titles, no text, no URL paths.

The site is the borough already on record in
[`real-sources.md`](../../../experiments/document-remediation/real-sources.md)
whose `/document/…` permalinks answer with file downloads — the shape that was
a recorded **error** in
[`live-loop-verification.md`](live-loop-verification.md) and the reason
download-capture (#118) exists. That path shipped covered by unit and browser
fixtures and had never met a real site until today.

## Discovery: the error became a document

`[V]` `POST /api/platform/clients/{id}/documents/discover`, production:

| | original run (pre-capture) | today |
|---|---:|---:|
| pages | 31 | 29 |
| documents | 12 | **13** |
| errors | **1** (`page.goto: Download is starting`) | **0** |
| truncated | budget, 148 seen | budget, 148 seen |
| wall | 61.6s | 63s |

`[V]` The thirteenth document is the permalink: **no file extension, `kind:
pdf`, `foundOn` recorded** — captured from the `page.on('download')` event,
bytes cancelled, exactly as designed. The error row is gone because the thing
it recorded is now inventory. First real-world proof of the capture path.

## The captured document, read and reported

`[V]` The same extensionless URL through add-by-URL on production: fetched
server-side behind the SSRF guard, read by the deployed JVM in **4s** —
tagged, 4 pages, 7 tables, one gap (`2.4.2: the document has no title, and
states no heading to copy one from`). A document that was invisible to the
product two weeks ago and an error row yesterday is now inspected inventory
with a criterion-keyed gap.

## The conversion audit trail, end to end on the client-scoped route

`[V]` The Word document from the first municipality, through
`POST /api/platform/clients/{id}/documents/convert` (the route the inventory
screen's Convert button calls — driven directly here, which is the honest
description): **200 in 6s**, and then the part with teeth:

- the conversion row records `inputSha256` and `outputSha256`;
- the stored artifact re-downloads through the operator conversions door;
- `[V]` **the served file's sha256 equals the row's `outputSha256` exactly** —
  bytes in, bytes out, provable, on production.

## The report a client would open

`[V]` Journey configured, run through the client-scoped runs route (`fail`,
96 — the generic `/api/audit/run` without inline steps answers
`journey_has_no_steps`; the client-scoped route reads the stored journey and
is the working path). Report issued, share link opened **anonymously**:

- **Checks passed 96%** with the explainer sentence, and the word "Score"
  absent — Milestone 1's copy, live on a real production report the same day
  it merged;
- documents section: **ON RECORD 14 · REVIEWED 2 · WITH GAPS 1**, the 2.4.2
  gap verbatim, no `titleText` anywhere in the served page.

## n=2, said plainly

Two municipal hosting shapes, both handled: the first keeps every document on
its website builder's CDN (242 links seen, 67 recorded, 175 pdf omitted by
the per-kind cap); the second serves 13 from its own host, caps untouched,
one of them extensionless behind a permalink. The cap behaviour, the CDN
handling and the capture path have each now been exercised where they were
designed to matter.

## Cleanup

`[V]` Client deleted (schema cascades covered documents, inspections,
conversions, journeys, reports), the one journey-keyed run removed, **zero
residue** verified across six tables, the share link answering 404, and the
three pre-existing clients intact by name.

## Open

- The audit and the crawl budget-truncate at the same 148-URL frontier on
  this site both times — consistent, and still a truncation; the budget trade
  is documented where it is set.
- Conversion cold-start remains unmeasured (both production conversions today
  were 6–8s, warm-ish).
