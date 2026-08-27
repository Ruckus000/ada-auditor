# The whole system on production, reached from the open internet

**Date:** 2026-08-26, the evening of the day the inventory, the report
snapshot, the stored artifacts and the instrument stamp all merged (#116, #117,
#118, #120, #121).
Third and last of the `live-*` sequence: [`live-loop-verification.md`](live-loop-verification.md)
ran discovery and inspection on a laptop, [`live-conversion-verification.md`](live-conversion-verification.md)
ran the first real conversion on a laptop, and this run is the deployed system
on Vercel — crawl, inventory, inspection, audit, client report — exercised the
way a client would reach it, from outside.

It found one fault, and it was not in the code.

Same privacy stance as the two files above: public municipal records name real
people, so this file quotes **structure only** — counts, kinds, hostnames,
wall times, verdicts. No document title text, no document text, no document
URL paths, no client identifiers. The site is the `.docx`-publishing
municipality already on record in
[`real-sources.md`](../../../experiments/document-remediation/real-sources.md).

## The finding: the client's report had never been deliverable

`[V]` Vercel Deployment Protection was set to `ssoProtection.deploymentType:
"all"` — **every deployment, production included, behind the team's SSO
challenge.** The consequence is precise and it is the whole product: `r/[token]`,
the single public surface outside the auth gate and the only artifact a client
ever receives, answered a login page to anyone who was not a member of this
Vercel team. The share link had been undeliverable since the day that surface
shipped.

`[V]` Every suite was green throughout. They still are. Nothing in
`npm test`, the browser suite, the hydration suite, the DB contracts, chaos, or
the localci gate can see this, because **the fault was in the hosting
configuration, not in the tree they inspect.** The hydration suite proves
`r/[token]` renders and hydrates against a built app on `next start`; that
proof is real and it is silent about whether the URL is reachable.

`[V]` Fixed by narrowing protection to previews only
(`deploymentType: "preview"`), then verified from an unauthenticated client:

| check | result |
|---|---|
| production alias, `/api/ready` | **200** |
| production deployment URL | **200** |
| preview deployment URL | **302** to the SSO challenge |
| the platform and document API routes, unauthenticated | **401** |
| `r/<bogus-token>` | **404** |
| `/` and `/reports` unauthenticated | Locked card |

`[V]` The Locked card was checked for the leak it exists to prevent: **no
client name and no share token appears in the served HTML or in the RSC
payload.** That is the regression `guarded()` was written for, and the first
time it has been asserted against a public origin rather than a test server.

The transferable lesson, recorded because it will look identical next time: a
green pipeline says the code is right, not that the product is reachable. The
delivery path is outside the repository and needs its own proof.

## What production actually does, measured

`[V]` One crawl of the municipal site through the deployed app:

| | |
|---|---|
| pages | 25 |
| errors | 0 |
| truncated | no |
| wall time | **25s** |
| document links seen | **242** |
| documents recorded | **67** |

`[V]` The 242 split by kind, and what the per-kind cap (#116, 50 per kind) did
with them:

| kind | seen | recorded | omitted |
|---|---:|---:|---:|
| pdf | 225 | **50** (cap) | 175 |
| docx | 14 | **14** | 0 |
| doc | 3 | **3** | 0 |

`[V]` `documentsOmitted: { pdf: 175 }` — the omission is declared, and it
names the kind it dropped.

`[V]` Four documents read by the deployed JVM stage, **1.1s to 7.9s** each,
cold starts included: one clean, three carrying the same three-gap profile.
Every inspection row was written with `instrument_version = 1`.

`[V]` An audit run over the same client on the same visit: **13 findings,
score 99, verdict fail** — and the verdict came from page findings alone, with
three gap-carrying documents sitting in the same client's inventory. The
two-path rule (document gaps never gate a run) is now proven in production and
not only in unit tests.

`[V]` The shared report, opened from outside as a client would:
**ON RECORD 67 · REVIEWED 4 · WITH GAPS 3 · NOT YET REVIEWED 63.** Unread
documents are counted and contribute no gap lines, exactly as
`buildDocumentReport` specifies.

## The cap question, closed

[`live-conversion-verification.md`](live-conversion-verification.md) ended by
naming cap-crowding as an open product question: all 50 slots went to PDFs and
**the Word documents — the only format this platform can fully remediate —
never reached the list.** The per-kind reserve was the answer chosen, and the
table above is what it bought: **17 Word documents recorded** where the single
global cap recorded zero, with the PDF omission still declared honestly rather
than hidden. That question is closed.

## Conversion is not available on production, and says so

`[V]` `GET /api/documents/remediate` on the deployed app answers
`available: false`, naming the missing runtime.

This is the split-by-weight decision showing its face in production: the
jlink'd JVM is tens of megabytes and ships to Vercel, so **inspection runs
there**; LibreOffice is **794MB** and does not, so **conversion is host-local
today.**
The capability answer is computed by the same function that would perform the
conversion — on Vercel every route is its own function, so no other surface's
answer about that route would be honest.

So the deployed product reads documents and reports on them; it does not yet
convert them. Stated plainly here because a reader of the merged code could
reasonably assume otherwise.

## The negatives, which are the honest half

`[V]` Each refusal behaved as designed rather than pretending:

- a conversion download whose artifact was never stored → **404**, not a link
  pointing at nothing;
- a fabricated share token → **404**;
- every platform and document API route checked, unauthenticated → **401**
  — `/api/ready` and `/api/health` answer publicly by design, as the table
  above shows;
- conversion requested where no converter exists → refusal naming the missing
  runtime, not a failure that looks like a document defect.

## Privacy and pinning, on the live page

`[V]` No `titleText` appears anywhere in the served shared report. The document
inventory in the database holds document titles; the public page does not, and
the logs never did. That three-way split is the design, and this is the first
time it has been checked against a page served to the public internet.

`[V]` The report's documents section is pinned: captured into `reports.documents`
when the report was issued, and unchanged by later inventory activity on the
same client.

## Cleanup, and why this file is the record

`[V]` The test client and every row beneath it were deleted afterwards; the
three real clients were untouched and verified intact.

That deletion is also why this file exists in this form. **The raw evidence is
gone** — there is no `evidence/` JSON behind these numbers, because the rows
were transient by design and the documents themselves are municipal records we
do not keep. Everything above was read off live responses at the time and is
recorded here because it cannot be re-derived without re-running.

## What this run leaves open

1. **Conversion in production.** LibreOffice's weight keeps it host-local. A
   deployed converter needs a different packaging decision — a container, a
   separate service, or a smaller converter — and that decision has not been
   made.
2. **Extensionless document capture is untested against reality.** The
   `page.on('download')` path (#118) is covered by unit and browser tests and
   was **not exercised here**: every one of this site's 67 documents carried a
   real file extension plus a query string. The gap it closes is real — a
   permalink answering with a download was observed live in
   `live-loop-verification.md` — but the fix has met fixtures only.
3. **n=1.** One municipal site, one platform (a website builder serving its
   documents from a CDN). The cap numbers, the kind mix and the CDN behaviour
   are one site's, not a population's.
