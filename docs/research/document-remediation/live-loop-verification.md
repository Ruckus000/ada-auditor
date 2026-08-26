# The discovery→inspect loop, run against a real municipal site for the first time

**Date:** 2026-08-26. Everything before this was stubs: the loop — client
Documents screen → `POST /api/platform/discover` → `POST
/api/documents/inspect-url` — is fully covered by unit, browser and hydration
tests, and had never once touched a real municipal site. This run closes that
gap through the **built** app (`npm run build`, `next start` on :3260,
`AUDITOR_STORE=memory`), which is the production code path minus Vercel's
request wrapper, separately proven. The JVM `Inspect` stage is the real one
(`npm run build:documents`, PDFBox 3.0.8).

Privacy stance, from the project's standing constraints: these are public
municipal records that name real people, so this file quotes **structure
only** — counts, gap strings, hostnames, wall times. Documents are "document
1/2/3"; no document title text, no document text, no document URL paths. The
bytes never left this machine except the crawl and fetches to the site itself.
No PDF was written into the repo; `git ls-files | grep -cE '\.(pdf|docx)$'`
is 0.

Sites are the ones already on record in
[`real-sources.md`](../../../experiments/document-remediation/real-sources.md).

## Discovery: two crawls, and the first is an honest zero

`[V]` `POST /api/platform/discover` with `{"targetUrl": ...}`, bearer-token
auth, against the built server:

| site | pages | documents | errors | truncated | URLs seen | wall time |
|---|---:|---:|---:|---|---:|---:|
| `manchesterny.org` | 25 | **0** | 0 | no | — | 14.8s |
| `fordcityborough.org` | 31 | **12** | 1 | budget | 148 | 61.6s |

`[V]` **Manchester found zero documents, and that is correct behaviour, not a
failure.** `isDocumentLink` records only paths ending `.pdf`, and
`real-sources.md` already recorded that this town publishes `.docx`. A `.docx`
municipal site is invisible to document discovery today. Named as a limit, not
smoothed over: the fallback plan in the task existed for exactly this.

`[V]` Ford City returned 12 documents, all on the client's own hostname, all
found at depth ≤ 1, each with a `foundOn` page. `documentsOmitted` was absent
on both crawls (cap is 50). The 61.6s wall time is the crawl's own
`DISCOVERY_BUDGET_MS` (60s) doing its job: the server's `discovery_completed`
line says `durationMs: 61573, truncatedReason: "budget", seen: 148` — the
inner bound fired, the route answered 200 with a partial result and said
`truncated`, which is the designed alternative to a platform 504.

`[V]` The one crawl error is the extensionless-document gap caught live: a
page-styled permalink under a `/document/…/` route answered with a file
download, and the crawler recorded `page.goto: Download is starting` as a
`DiscoveryError` rather than crashing or auditing a PDF. The document behind
that URL is **not** in the documents list — an extensionless PDF is missed by
design, and this error line is what that miss looks like in practice.

## Inspect: three real PDFs through the JVM stage

`[V]` Three of the twelve discovered URLs, chosen for variety of size and
producer, each `POST /api/documents/inspect-url` `{"url": ...}` — the server
fetches the PDF itself (SSRF-guarded, redirects refused) and runs the real
PDFBox `Inspect`:

| | HTTP | wall time | tagged | pages | headings | tables | lists | figures | title |
|---|---|---:|---|---:|---:|---:|---:|---:|---|
| document 1 | 200 | 0.93s | no | 12 | 0 | 0 | 0 | 0 | present |
| document 2 | 200 | 1.86s | yes | 133 | 0 | 31 | 461 | 35 | absent |
| document 3 | 200 | 0.70s | yes | 2 | 0 | 0 | 0 | 4 | absent |

Gaps, verbatim from the responses:

**document 1** (`fordcityborough.org`):
- `3.1.1: the source declares no language, so none is claimed`
- `1.3.1: the output carries no structure tree`

**document 2** (`fordcityborough.org`):
- `2.4.2: the document has no title, and states no heading to copy one from`
- `1.1.1: 2 figures with no alt text`

**document 3** (`fordcityborough.org`):
- `2.4.2: the document has no title, and states no heading to copy one from`
- `1.1.1: 3 figures with no alt text`

`[V]` The shape matches what the offline corpus predicted. Document 1 is an
untagged spreadsheet export — no structure tree at all, and its one point in
favour, a title, is a producer artifact: the export tool wrote the source
file's own filename (extension included) as the document title. Documents 2
and 3 arrived tagged from their producers and still fail 2.4.2 — the
title-loss pattern [`tagged-reality.md`](tagged-reality.md) recorded on the
offline corpus, reproduced here on documents nobody hand-picked.

`[V]` **Zero headings across all three**, including a 133-page tagged ordinance
with 31 tables and 461 list nodes. A document that size with no `/H*` in its
structure tree is the remediation queue this product exists for.

`[V]` Wall time is flat where it matters: 133 pages inspected in 1.86s against
a 60s route budget. Fetch dominates, parse does not.

## The negative check

`[V]` `POST /api/documents/inspect-url` with
`{"url": "http://169.254.169.254/x.pdf"}` answered **400** in 3ms:

```
{"error":"unsafe_url","detail":"Target URL resolves to a private or reserved address."}
```

## Logs: the privacy claim, checked rather than assumed

`[V]` Every `document_inspected` line in the `next start` output carries
`host` (`fordcityborough.org`) and the structural summary — and **no URL, no
path, and no title text**: `logSafe` reduces the title to its kind
(`already-titled` / `no-heading-to-copy`), so document 1's filename-as-title
reached the API caller but never a log line. The SSRF refusal logged
`document_fetch_refused` with the hostname only. `discovery_completed` logs
the target **origin**, never a full URL.

## Misses, named

- **A `.docx`-publishing town yields zero documents.** Manchester is on record
  as exactly the kind of client this product wants, and discovery cannot see
  its documents at all. `isDocumentLink` is `.pdf`-only.
- **Extensionless PDFs are missed by design, and real sites have them.** One
  live example on the primary site (the download-permalink error above), and
  `real-sources.md` already lists `DocumentCenter/View/<id>` URLs on two other
  municipal hosts. The miss is deliberate — classifying by extension is the
  only way to record without navigating — but on some platforms it will be
  most of the documents.
- **Discovery is a capped proposal, not an inventory.** The Ford City crawl
  budget-stopped after walking 31 of 148 seen URLs, and a PDF known to exist
  on this host (the fee schedule hashed in `real-sources.md`) is not among the
  12 returned. A client screen built on this data shows *some* of the site's
  documents, honestly labelled `truncated` — never all of them.
- **This run does not prove the Vercel wrapper**, only everything inside it:
  production is behind SSO, so the identical code ran under local
  `next start`. The wrapper is proven separately; the seam is named.
- **Memory store.** `AUDITOR_STORE=memory` as in the hydration suite; nothing
  in this loop persists, so no store behaviour was exercised or claimed.

## Verdict

**`[V]` The loop holds end to end on a real municipal site.** A real crawl
found real PDFs without navigating into them, the same URLs fed straight back
into inspect-url produced WCAG-criterion gaps from the real JVM stage in
under two seconds each, the SSRF guard refused the canonical bad address, and
the logs kept every document path and title out. The gaps it returned are the
known municipal pattern — untagged spreadsheet exports and tagged-but-untitled
Word exports — which is the demand the remediation path was built against.
