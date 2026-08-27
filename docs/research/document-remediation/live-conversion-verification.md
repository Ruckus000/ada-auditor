# The full loop on a real Word document: crawl → discover → convert → verify

**Date:** 2026-08-26, the same day the conversion flow merged (#113). This is
the run that flow was built for, against the site whose zero-document result
motivated the `.docx` classifier — and it found two production blockers before
it produced the first real remediated document. Both are fixed with regression
tests (#114, #115); this file records what the live site taught that no
fixture had.

Same privacy stance as [`live-loop-verification.md`](live-loop-verification.md):
public municipal records name real people, so this file quotes **structure
only** — counts, kinds, hostnames, wall times. No document title text, no
document text, no document URL paths. The bytes never left this machine except
the fetches to the site itself. No document was written into the repo.

The site is the `.docx`-publishing municipality already on record in
[`real-sources.md`](../../../experiments/document-remediation/real-sources.md).
Built app (`npm run build`, `next start`), real JVM, real LibreOffice.

## Blocker 1: the site's service worker crashed the server

`[V]` The site's template registers a service worker, and Playwright's
`response.frame()` **throws** for every response the worker fetches — not
returns null, throws — synchronously inside the crawl's context `response`
listener, where nothing catches it. Each worker fetch became an
`uncaughtException` in the server process; the crawl wedged past its own
budget and the request timed out at 180s.

The journey runner's navigation listener had the identical hole, so an
*audit* of any service-worker site would have died the same way. Both now
skip frameless responses (#114), with a browser regression test whose fixture
registers a real worker — reverting the guard reproduces the exact production
error.

## Blocker 2: every document the town publishes is on its builder's CDN

`[V]` With the crash fixed, the crawl completed in 13s: 25 pages, 0 errors,
untruncated — and **0 documents**, on the site known to publish Word files.
The earlier diagnosis ("`isDocumentLink` is `.pdf`-only") was only half the
story. Reading the town-board page directly: **229 hrefs, of which 123 `.pdf`,
10 `.docx` and 1 `.doc` — all 134 hosted on `img1.wsimg.com`**, the website
builder's asset CDN, not the town's own hostname. Document classification ran
*after* the crawl's scope check, so every one was dropped as third-party
before the classifier ever saw it.

This is not an edge case: builder-hosted municipal sites keep their documents
on the builder's CDN as a matter of platform design. A document linked from
the client's own page is the client's content by reference wherever the bytes
live; #115 classifies before the scope check (documents are recorded, never
navigated, and only fetched later behind the SSRF guard at an operator's
request) and the screen now shows the host when it differs.

After the fix, the same crawl: 25 pages, 0 errors, **50 documents recorded
and 192 omitted beyond the cap — 242 document links seen** where an hour
earlier there were zero. All on the CDN host.

## The cap crowds out the remediable format

`[V]` All 50 recorded documents were PDFs. The site links far more PDFs than
Word files, the cap keeps the first fifty sighted, and the Word documents —
the format this platform can fully remediate — never reached the list.
`documentsOmitted: 192` says work was dropped, honestly, but not *which*
work, and the dropped half includes everything convertible. Open product
question, recorded here rather than patched in passing: a per-kind reserve, a
larger cap, or kind-aware ordering all change what an operator sees first.

## The first real conversion, end to end

`[V]` One of the town-board page's `.docx` links (a 6-page document on the
CDN host), through `POST /api/documents/remediate-url` on the built app:

| | |
|---|---|
| wall time, fetch through verified PDF | **3s** |
| output | 147,621 bytes, tagged |
| title | `already-titled` — carried through from the source, not invented |
| language | `en-US`, read from the source and reapplied |
| structure | 18 headings, 21 lists, 0 tables, 0 figures |
| **gaps** | **none** |

The served bytes were then independently re-read through
`POST /api/documents/inspect`: tagged, titled, language declared, zero
machine-detectable gaps. Both instruments agree.

That is the product's thesis executed on real municipal content with no human
input: a Word document found where it lives, converted to a tagged PDF whose
every claim was already in the source, verified by the same instrument that
audits everything else — in three seconds.

## What this run leaves open

- ~~The cap-crowding question above.~~ **Answered** by the per-kind cap:
  17 Word documents recorded on the same site where the global cap recorded
  zero — see
  [production-verification-2026-08-26.md](production-verification-2026-08-26.md).
- Extensionless document URLs remain a recorded miss (unchanged).
- ~~Conversion still leaves no persistent record — the bytes go to the
  operator, the log gets `logSafe` counts. The audit-trail schema is the
  next deliberate decision.~~ **Built** (#117, #120): `client_documents` /
  `document_inspections` / `document_conversions`, each conversion recording
  the SHA-256 of the bytes in and the bytes out, with the delivered PDF stored
  for re-download.
