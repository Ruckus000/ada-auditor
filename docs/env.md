# Environment Variables

Required for Phase 1 Vercel control plane operation.

| Variable | Required | Description |
|---|---|---|
| `AUDITOR_RUN_TOKEN` | Yes (for audit runs + readiness) | The **machine** credential: CI, scripts, the scheduler, and the way into the console before the first operator account exists. Must be at least 16 characters — use `openssl rand -hex 32`. Callers send it to `POST /api/audit/run` as `Authorization: Bearer <token>` or `x-auditor-run-token`. People sign in with an email and a password instead (`npm run operator -- add`), so this should stop being something operators know — while they know it, disabling an operator revokes nothing. Rotating it signs every human out **only** while `AUDITOR_SESSION_SECRET` is unset. |
| `AUDITOR_SESSION_SECRET` | Recommended | Signs operator session cookies. Keep it separate from `AUDITOR_RUN_TOKEN`: while they are the same value, rotating the machine token signs every human out, which is the exact coupling operator accounts exist to break. Unset falls back to the run token and `/api/ready` warns (`session_secret_shared_with_run_token`) rather than failing — a deployment driven entirely by CI is still a working one. Rotating this *is* the deliberate "sign everyone out" lever. |
| `AUDITOR_RP_ID` | Optional (required for passkeys) | The registrable domain passkeys are bound to, e.g. `audit.example.com`. Must be `AUDITOR_RP_ORIGIN`'s host or a parent of it; a mismatch turns passkeys off rather than half-working. **Never derived from a request header** — `Host` and `x-forwarded-host` are attacker-controlled wherever the app can be reached without a trusted proxy, and a relying party taken from one lets an attacker have credentials minted against a domain they control. Unset means passkeys are unavailable and everyone signs in with a password, which is the correct state for local development and preview deploys: a credential is bound to one origin, so a production passkey cannot work against a preview URL. |
| `AUDITOR_RP_ORIGIN` | Optional (required for passkeys) | The full origin the browser must report, e.g. `https://audit.example.com`. Pairs with `AUDITOR_RP_ID`; both or neither. Passwords remain a full peer either way, and are the way back in if every registered device is lost — there is no passkey-only mode and no email-based reset. |
| `AUDITOR_OPERATOR_NAME` | No | Who activity is attributed to when the caller is a **machine** — CI, a script, the scheduler. A signed-in operator is recorded under their own name and `operators.id` instead, so this no longer stands in for a person. Unset renders as `Operator`. It replaced a hardcoded `"Jules Reyes"` that read as though the product knew who was signed in. |
| `AUDITOR_INSTANCE_ID` | No | Echoed back as `instance` by `GET /api/health`, so a caller that started a server can confirm the answer came from *that* process. The hydration suite sets it to a per-run UUID: its port is fixed, so a second concurrent run's `next start` cannot bind while `/api/health` keeps answering from the first run's server — which the suite used to drive as though it owned it, seeding a shared store and failing later assertions in ways that looked like product bugs. Unset reports `null`. |
| `AUDITOR_STORE` | No | Set to `memory` to run against ephemeral in-process stores instead of Postgres. For harnesses that boot the real server without a database — the hydration and accessibility suites in CI. It is an explicit opt-in, never a fallback for a missing `DATABASE_URL`: a fallback would let a misconfigured deploy serve an empty portfolio and discard every run silently. Nothing persists, and the process logs `store_memory_mode` on the way past. Never set it in a deployed environment. |
| `CRON_SECRET` | Required for schedules | Vercel Cron sends `Authorization: Bearer $CRON_SECRET` to `/api/cron/tick` every hour (`vercel.json`). Unset means the tick refuses every request and no journey schedule ever fires — reported by `/api/ready` as `cron_secret_not_configured`, and reported rather than gating, because an auditor driven entirely by hand is a working deployment. The run token is also accepted, so an operator can tick by hand instead of waiting an hour to find out whether a new schedule works. |
| `AUDITOR_SELF_URL` | No | Where the tick posts its dispatched runs, e.g. `https://auditor.example.com`. Inferred from `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL` when unset. **Never** taken from a request header: `host` and `x-forwarded-host` are attacker-controlled and the tick attaches the machine token to whatever it posts to, so trusting them would hand the token to anyone who could reach the endpoint with a spoofed header. With neither set, the tick claims nothing and says so. |
| `CRON_MAX_STARTS_PER_TICK` | No | Most journeys dispatched per hourly tick. Default 3. Each dispatch is a separate invocation with its own Chromium, so this and the run budget are what stop one tick launching a fleet. When it truncates, the tick logs how many were deferred — they are picked up next hour, not dropped. |
| `AUDITOR_MAX_RUNS_PER_HOUR` / `_PER_DAY` | No | Ceiling on audits started per window. Defaults 20 and 100. A run launches a browser and makes a model call, so without this a loop in a caller spends real money unattended. Global rather than per operator — the bill is shared. Both windows are counted even when the first already refuses, because the counters describe demand, not permitted demand. Fails **open** if the counter is unreachable: a cost control that becomes an outage has made things worse. |
| `AUDITOR_MAX_PREVIEWS_PER_HOUR` / `_PER_DAY` | No | Ceiling on journey *previews* — the replay-verify walk behind "Verify so far" — per window. Defaults 40 and 200. Counted separately from audits on purpose: a preview is the runner minus the axe scan, the advisory call and all persistence, so it costs browser time and not the model call the audit budget mainly defends. On one shared counter, authoring competed with auditing for the same twenty — an operator iterating on a stale selector could spend the hour's audits without running one, and the scheduler would then refuse a real client's audit because somebody was typing. Higher than the run ceiling because verifying is a loop and auditing is a decision. Same fixed windows, same fail-open behaviour, same `run_budget_exceeded` code on refusal; the degraded log carries `budget: previews` so a failing counter names which ceiling stopped being enforced. The defaults are a starting point rather than a measurement — `journey_preview`'s `durationMs` across a real authoring session is what should replace them. |
| `AUDITOR_MAX_DOCUMENTS_PER_HOUR` / `_PER_DAY` | No | Ceiling on document work per window — every inspection, conversion, repair and intake, through the console or the stateless `/api/documents/*` routes. Defaults 500 and 2000. Each launches a JVM, and a converter for Word, on a function that may run five minutes; until this counter existed those routes were authenticated and uncounted, so a leaked machine token or a caller in a loop had nothing in the way. Its own counter for the reason previews have one: "Inspect all unreviewed" walks an inventory of up to two hundred documents in one click, and on a shared counter one sweep would spend every audit a client had bought. One counter for every kind rather than one per kind — a conversion costs ten times an inspection, but what is being bounded is function time under a caller that should not be there, and one number bounds it. Sized against real use: a sweep is two hundred requests and the blind harness posts a hundred and fifty in one run. Consumed after the caller is authorised and before anything is buffered, probed or fetched, so a refused request costs nothing and mints no row and no event. Same fixed windows, same fail-open; refused with 429 `document_budget_exceeded`, whose `message` says when the window resets and whose `detail` names it; the degraded log carries `budget: documents`. The inventory's "Inspect all" stops at the first refusal rather than issuing two hundred more. Discovery crawls are deliberately not counted here — see the note in `platform/discover/route.ts`. |
| `AUDITOR_MAX_PAGES_PER_RUN` | No | Pages audited per run before the journey is truncated — **the second of two bounds**, and the one that stops a site with many small pages. Default 20 (`DEFAULT_MAX_PAGES_PER_RUN` in `src/domain/run-limits.ts`) — a starting point, not a measurement; `audit_page_cap_reached` records when it bit, and `run_pages.duration_ms` is what will eventually replace the guess with a number. A count cannot bound a duration, which is why `AUDITOR_WALK_BUDGET_MS` exists beside it; a truncated run records `truncation_reason` so an operator can tell which of the two to change. |
| `AUDITOR_WALK_BUDGET_MS` | No | **The first of two bounds**: how long the walk may spend *starting* new work, measured from before the browser launches. Default 180000 — what is left of the 300s function ceiling after a 120s reserve for upload, advisory, persistence and the page still in flight (`MAX_RUN_DURATION_MS` minus `RUN_RESERVE_MS`). It bounds when work starts, never when work already in flight finishes, so **keep it comfortably above `AUDITOR_EXPECT_TIMEOUT_MS`**: the page being audited when the deadline passes may still take that long, and the reserve is what covers it. A walk always audits at least one page however spent the budget is — a zero-page run is the evidence-free outcome this exists to prevent. When it bites the run logs `audit_time_budget_reached` and stores `truncation_reason = 'budget'`, which means get a container worker rather than raise the page cap. |
| `AUDITOR_STEP_TIMEOUT_MS` | No | How long one `fill` or `click` may wait for its element. Default 10000. Nothing set a timeout at all before, so Playwright's 30s stood — and because the step loop has no `catch`, the first stale selector ends the run, so this is one wait per run rather than one per step. Ten seconds because a control that has not appeared by then, on a page already navigated to and settled, is stale rather than slow. Raise it for an app that genuinely paints later. |
| `AUDITOR_EXPECT_TIMEOUT_MS` | No | How long an `expect` step may wait for the URL or selector it declares. Default 30000, deliberately longer than `AUDITOR_STEP_TIMEOUT_MS`. The ten-second figure above is justified by the page having already arrived; an expectation is the opposite case — it usually follows a click and spans the arrival itself, which is the reason the step exists. Capping that at an interaction-scale number is the mistake `page.goto` is deliberately kept away from. |
| `AUDITOR_RUN_STALE_SECONDS` | No | How long a run may sit in `running` before it is treated as abandoned. Default 360 — `maxDuration` plus a minute of grace. A run whose function times out or crashes never gets to overwrite its own row, so without this a dead run is displayed as "scanning" forever. Derived on read so screens are honest immediately, and written back durably by the hourly tick. |
| `CHAOS_ENABLED` | No | Set to `true` to allow chaos scenario injection via API (`chaosScenario` body field) and to run `npm run chaos`. Default: disabled. Preview only recommended. |
| `DATABASE_URL` | Yes | Neon Postgres connection string, injected by the Vercel Marketplace integration (`vercel integration add neon`). The run store needs it everywhere, including locally — there is no filesystem fallback, because one would mean a misconfigured deploy quietly writing runs to a disk that disappears with the invocation. Apply the schema with `npm run migrate`. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | No | Upstash Redis REST credentials. The console sign-in throttle and the run budget both count here. Unset means both count in process memory, which on serverless resets on every cold start and is per-instance — so the effective run ceiling becomes the limit times however many instances are warm, and the throttle is a speed bump rather than a limit. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | No | Alternate Upstash env names; accepted if `KV_REST_API_*` is unset. |
| `BLOB_READ_WRITE_TOKEN` | Required on Vercel | Vercel Blob credentials, for run evidence (screenshot, DOM snapshot, accessibility tree). Unset means artifacts stay on local disk — fine locally and in CI, but on serverless the filesystem disappears with the invocation, so evidence would be unreachable. `/api/ready` warns (`evidence_storage_not_configured`) rather than failing, and the warning matters more than it looks: a page's evidence is judged complete from its *local* paths, so an unconfigured store still produces runs reporting `evidenceStatus: 'complete'` whose evidence answers 410 forever after. Provision with `vercel blob create-store <name> --access private` and the token is injected automatically. **The store must be private**: this evidence is authenticated pages on a client's system, and uploads are written with `access: 'private'` — a public store would leave the stored URL as the only thing protecting it. |
| `ARTIFACT_RETENTION_DAYS` | No | How long run evidence is kept. Default **90** — chosen rather than inherited: thirty days expired the evidence behind a report while the client was still remediating from it, and ninety covers a remediation cycle and a quarterly review. Not longer, because this is captured end-user data and how long it exists is part of what a client agrees to. These are screenshots of authenticated pages on client systems and contain real end-user data, so `npm run prune:artifacts` sweeps anything older; a missing or nonsensical value falls back to the default rather than to keeping them forever. |
| `AUDITOR_MAX_DOCUMENT_BYTES` | No | Largest document `POST /api/documents/remediate` will accept. Default **26214400** (25MB) — a municipal agenda is tens of kilobytes, so this is a ceiling rather than a budget. Checked twice: against `Content-Length` before the body is buffered, so an unauthenticated caller cannot make the process hold 25MB, and again against the real size because `Content-Length` can lie. **It bounds the compressed size, not the decompressed one** — a `.docx` is a ZIP, so a zip bomb is possible in principle; what limits that is the per-call conversion timeout and LibreOffice running as a separate killable process. Recorded rather than solved. **On Vercel the ceiling is lower than this and not ours**: the platform caps a function's request body at 4.5MB, so the upload path refuses larger documents with a platform 413 before this setting is consulted. The URL path is unaffected — the server fetches the document itself — and a municipal agenda is tens of kilobytes. |
| `AI_GATEWAY_API_KEY` | No | Authenticates the AI advisory pass against the Vercel AI Gateway. Not needed on a Vercel deployment, which authenticates with the `VERCEL_OIDC_TOKEN` it mints for itself; `vercel env pull` writes a copy locally that is valid for about a day. Unset, with no OIDC token either, means the run completes with deterministic findings only; it is never a run failure. Advisory findings are always `gateable: false` and never affect `ciStatus`. |
| `AUDITOR_ADVISORY_MODEL` | No | Which model the advisory uses, as a gateway `provider/model` string, default `minimax/minimax-m3-free`; `off` disables the pass outright. The off switch exists because gateway auth is ambient on Vercel (the deployment's own OIDC token), so unsetting keys stopped being a way to say no. The default costs nothing and is the right trade for auditing public sites. It is the wrong trade for an authenticated journey: free gateway models advertise neither zero data retention nor a no-training guarantee, and this pass sends the accessibility tree of every page walked — which on a signed-in app is whatever real end-user data was on screen. Point this at a model with a data-handling guarantee before auditing behind a login — or at `off`, which is the safe default for an authenticated journey until a model has been chosen deliberately. |
| `AUDIT_CREDENTIAL_<REF>_USER` / `_PASS` | Per authenticated journey | Credentials for a client login. A journey step names a reference (`{ credentialRef: "acme", field: "pass" }`) and the value is resolved server-side, so the secret never travels in a request body, never persists with the journey, and never reaches a run log. Reference `acme` reads `AUDIT_CREDENTIAL_ACME_USER` / `AUDIT_CREDENTIAL_ACME_PASS`. Replaced the single global `AUDIT_DEMO_USER` / `AUDIT_DEMO_PASS` pair, which could only ever describe one login. Since the per-client credential store landed this is the *fallback*: a run resolves from the store first, then here — so these keep working untouched, and remain the answer for a journey whose client never stored values. |
| `AUDITOR_CREDENTIAL_KEY` | No — enables the per-client credential store | Encrypts the `client_credentials` rows the journey editor's "Set values" surface writes (AES-256-GCM; 64 hex chars). Generate with `openssl rand -hex 32` and set it once per environment. Unset means the store is disabled — the write API answers 503 `credential_store_not_configured`, the env fallback above carries every run, and `/api/ready` reports `credentialStoreConfigured: false` without warning, because env-var credentials are a supported configuration. **Losing the key means re-entering credentials through the UI — that is the designed recovery.** There is no export and no re-encryption path: the store is write-only from the outside, so nothing can read the old values out to migrate them. |

## Local development

```bash
cp .env.example .env.local
# Set AUDITOR_RUN_TOKEN and AUDITOR_SESSION_SECRET (or pull from Vercel — see below)
npm run migrate
printf '%s' 'your-password' | npm run operator -- add --email you@example.com --name "Your Name"
npm run dev
```

The password is read from stdin, or from `OPERATOR_PASSWORD` — never from argv, because `ps` shows
argv to every process on the box and shell history keeps it afterwards.

Open `http://localhost:3000` and sign in with that email and password. The session is a signed,
HttpOnly cookie good for 30 days. Pasting `AUDITOR_RUN_TOKEN` still works and still gets you in —
that is the bootstrap path, before any operator exists — but it signs you in as the machine, so
everything you do is attributed to `AUDITOR_OPERATOR_NAME` rather than to you.

### Why the console needs a session

`POST /api/audit/console` runs audits with the server's own token, so the operator never handles it
per run. That convenience needs a gate. A same-origin header check is not one: `sec-fetch-site` and
`Origin` are trustworthy from a browser but forged trivially by anything else, so on their own they
let any caller spend the server's token. The console therefore requires an operator session, and
keeps the same-origin check underneath it as CSRF defence.

The cookie carries a **subject** — `v2.<operatorId>.<expiresAt>.<hmac>`, signed with
`AUDITOR_SESSION_SECRET` (falling back to the run token). A cookie without a subject could only ever
answer "is somebody signed in?", which is why activity had no real actor and triage had nobody to
assign to. Every authenticated request resolves that id to a row and refuses it if `disabled_at` is
set: one indexed lookup is the price of revocation that actually revokes. Passwords are scrypt
(N=16384, r=8, p=1, 64-byte key) with the parameters stored in the hash, so they can be raised later
without invalidating existing rows.

Sign-in attempts are throttled per email rather than globally — a global counter means one attacker
locks out every operator.

### Sync token with Vercel (recommended)

```bash
# One-time: create a strong token and set it on Vercel (production + preview)
openssl rand -hex 32 | vercel env add AUDITOR_RUN_TOKEN production
openssl rand -hex 32  # if you need a separate preview value, or reuse the same:
# vercel env add AUDITOR_RUN_TOKEN preview

# Pull into local .env.local so local matches cloud
vercel env pull .env.local
```

Do **not** symlink env files — Vercel stores secrets in the cloud; `vercel env pull` is the sync.

## Persistence

**Neon Postgres, everywhere.** `createRunStore()` throws without `DATABASE_URL`
rather than falling back, so a misconfigured deploy fails where someone can see
it instead of writing runs to a filesystem that disappears with the invocation.
The filesystem and KV stores that used to sit behind this factory are gone;
their weaknesses went with them (a full-directory read and a JSON parse of
every record to answer one query; a two-deep `latest`/`previous` pointer chain
that could not answer "list runs" at all).

- **Schema:** `src/integrations/persistence/schema.sql`, applied by
  `npm run migrate`. Idempotent, so re-running it against a current database is
  a no-op. A run is a journey and a journey is several pages, so `run_pages` is
  a first-class table and every deterministic finding carries the page it was
  found on.
- **Tests:** the in-process `MemoryRunStore` backs the unit suite so it needs no
  database. Both stores are held to the same contract
  (`tests/support/run-store-contract.ts`) — a double that quietly disagrees
  with the real store means every handler test is green about behaviour
  production does not have. Run the real one with `npm run test:db`.
- **Artifacts** go to Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, keyed per
  audited page, and their URLs are stored on the run's page rows so a finding
  can always be traced back to the screenshot and DOM it came from. Locally and
  in CI they stay on disk, where they are already reachable. They are written
  **private**: a stored URL is a pointer, not a capability, so reading one back
  needs an authenticated fetch. That fetch is
  `GET /api/audit/runs/{id}/artifacts/{position}/{kind}`, which reads the URL
  from the database and never accepts one from the caller. A pruned artifact
  answers **410 `evidence_expired`** rather than 404: the run existed and its
  evidence aged out, and those are different facts.

## Running an audit

`POST /api/audit/run` is asynchronous by default: it records the run, returns
**202** with a `requestId` and a `pollUrl`, and finishes the work in the
background. Poll `GET /api/audit/runs/{id}` until `status` is `complete` or
`failed`.

Add `?wait=1` to block and get the result in one call — what CI wants, and what
the console uses.

Async unblocks the caller; it does **not** buy more compute. Background work is
bounded by the same `maxDuration` (300s, which is the ceiling on Hobby and the
default on every plan; Pro and Enterprise allow up to 800s). A run is recorded
as `running` before the work starts, so one that times out or crashes leaves a
trace rather than vanishing.

`GET /api/audit/runs/{id}/report.pdf` renders that run as a client-facing PDF.

## Auditing a real site

`POST /api/audit/run` takes an optional `targetUrl` plus `steps`. Absent a
`targetUrl` the run uses the built-in `file://` fixtures.

Every target is checked four ways before and during a run
(`src/integrations/browser/target-url.ts`): scheme and host up front; every
address the host resolves to, so a friendly name pointing into private space is
refused; the URL the page actually settled on after each navigation, which
catches a redirect; and the address the browser actually connected to, which is
what catches a rebinding host. That last one is separate because the settled URL
cannot catch a rebind — the hostname is unchanged, and it is the hostname the
allowlist was derived from. Blocked ranges include loopback, RFC1918,
carrier-grade NAT, IPv6 unique- and link-local, every IPv6 range that embeds an
IPv4 address (IPv4-mapped, IPv4-compatible, NAT64, 6to4), and
`169.254.169.254` — the cloud metadata endpoint.

A run's allowed hosts are the target's own host plus anything the journey names
in `allowed_hosts` — a union, so listing a provider cannot lock a run out of
the site it is auditing. Set it with `allowedHosts` on
`POST`/`PATCH /api/platform/clients/<id>/journeys[/<journeyId>]`, or per run on
`POST /api/audit/run`; all three validate against the same schema. Entries are
hostnames only — no scheme, port, path, wildcard, IP literal or bare public
suffix — and are matched host-or-subdomain, so one entry covers a provider's
tenants. It exists for third-party sign-in and nothing else.

A journey also carries an `environment` — `production` unless it says otherwise
— which decides what its steps may do: `submit-safe` and `mutate-test-data` are
refused in production, and both write routes refuse a journey whose steps and
environment disagree rather than letting the runner abort part-way through one.
Set it alongside `steps` on the same two routes.

Two rules govern where a run may go, and they answer different questions:

- **Passing through another host is permitted** on the way, provided every hop
  reaches a public address. An apex-to-www hop, a consent wall and an SSO
  redirect are all ordinary, and refusing them would break the normal case to
  stop an abnormal one.
- **The journey must come to rest on the site it is auditing**, and only pages
  on that site are captured. A host the journey merely passes through is walked
  and not audited: its pages are not the client's, and its accessibility
  defects are not the client's to fix. Ending on one aborts the run.

Both hold whatever the allowed-host list contains, which is what makes it safe
to name a third-party identity provider in it.

**CI/executive read:** `GET /api/audit/runs/latest?journeyId=&environment=` with
the run token returns the latest stored run plus optional regression against the
prior baseline.

## Function memory

`vercel.json` sets `memory: 3009` on the routes that launch Chromium or
LibreOffice and 2048 on the rest of the document routes and the PDF route. It
is the only place memory can be declared — `maxDuration` lives in the route
files and is deliberately not repeated here, so the number has one home.
`tests/deploy/browser-routes-are-packaged.test.ts` refuses a `maxDuration` in
`vercel.json`, because for three weeks there was one: 600 on the three
converting routes, beside route files exporting 300, and nothing said which
the platform honoured. Every timeout, stale-run window and reserve in the
tree is derived from 300 (`MAX_RUN_DURATION_MS`), and the same test holds
every route file to that ceiling.

3009 MB is the smallest Vercel size that reliably fits `@sparticuz/chromium`:
the binary is unpacked to `/tmp` on first use and a browser plus a page's DOM,
screenshot and accessibility tree live in the same invocation. The default is
smaller, and a Chromium that cannot allocate fails at launch rather than
degrading — so a too-small setting looks like "audits do not work" rather than
"audits are slow".

Nine entries get 3009 and each is named. Six launch Chromium: `/api/audit/run`,
`/api/audit/console`, the platform run and preview routes under
`clients/**/runs` and `clients/**/preview`, `/api/platform/discover`, which
crawls a site to propose its pages, and `clients/**/documents/discover`, which
crawls it for documents. Three launch LibreOffice beside a JVM:
`clients/**/documents/convert`, `/api/documents/remediate` and
`/api/documents/remediate-url`. The PDF route drives a browser too, but only
to print one already-stored report, so 2048 covers it; the remaining document
routes spawn only a JVM with a 512MB heap ceiling (`stage.ts`) and get 2048
through the `documents/**` catch-all.

The wildcard patterns are wildcards on purpose: `functions` keys are globs, and
`[clientId]` in a literal path would be read as a character class and match
nothing, which Vercel reports as a build error. `/api/platform/discover` has no
dynamic segment, so its key is literal — a wildcard there would buy nothing and
widen what it matches.

### These numbers are currently ignored, and the setting stays anyway

On **Active CPU billing** — which this project is on — Vercel discards the
`memory` values above. The deploy says so out loud:

> Provided `memory` setting in `vercel.json` is ignored on Active CPU billing.

Observed on a preview deploy on 2026-08-17. It applies to every entry in the
file, including the three that had carried the setting for weeks before anyone
read the warning. Under Fluid Compute, memory comes from the plan rather than from
this file, and what a Fluid instance actually gets is not stated anywhere in the
documentation we could find — so the paragraphs above describe an intent, not a
guarantee that is being enforced today.

The setting is kept rather than deleted, for two reasons. It is still correct
for any deployment not on Active CPU billing, and deleting it would silently
remove the record of *why* 3009 was chosen — which is the part worth keeping,
since the reasoning outlives the billing mode.

What this means in practice: **whether a browser route has enough memory is an
empirical question here, not a configured one.** If Chromium starts failing at
launch on a deployed function, this file is not where the fix lives.
`tests/deploy/browser-routes-are-packaged.test.ts` still asserts these keys — it
is checking that the config says what we mean, not that the platform obeys it.

Memory is only half of what a browser route needs; `next.config.mjs` has to
name the same route under `outputFileTracingIncludes` or the function deploys
with no browser binaries at all. Neither file can see the other, and neither
can see the code, so `tests/deploy/browser-routes-are-packaged.test.ts` holds
the three together.

## Scheduling

`vercel.json` points Vercel Cron at `GET /api/cron/tick`, hourly. Each tick:

1. Claims the journeys whose cadence is due, in one statement — a CTE
   carrying `for update skip locked`, so two overlapping ticks cannot both
   claim one and bill a client twice. The CTE is load-bearing, not stylistic:
   the `where id in (select … limit n for update skip locked)` form the query
   started as is re-executed per outer row and silently exceeds its limit.
2. Posts each to `/api/audit/run` with the machine token — it **dispatches**
   rather than audits, because one 300s function cannot walk N journeys through
   a browser, and each dispatch needs its own invocation and its own Chromium.
   The dispatches are awaited: a serverless function is frozen the moment it
   responds, so fire-and-forget `fetch` calls would never leave the box, and the
   failure mode is a scheduler that reports success and audits nothing.
3. Reconciles runs stuck in `running` past `AUDITOR_RUN_STALE_SECONDS`.

`last_scheduled_at` is stamped inside the claiming statement, before anything
is dispatched — the claim has to be atomic with the selection or two ticks
would both take the same journey. A dispatch that then fails **gives the claim
back** (`releaseJourneyClaim`), so a repeat tick in the same hour — including
the manual one in the checklist below — picks the journey up instead of
finding it stamped as done by a dispatch that never landed. It does not pull
the next *scheduled* attempt forward: the claim query also gates on
`schedule_hour`, so the following hourly tick skips the journey either way.
The self URL is resolved before any of this: a tick that cannot dispatch
claims nothing. Per-journey cadence lives
in our own code off one uniform tick — Hobby allows a limited number of cron
entries, and a per-journey cron expression would not survive that.

## Chaos and browser mode

- `npm run chaos` exercises the three Playwright fixture scenarios (incomplete → `inconclusive`, critical → `fail`, clean → `pass`). The HTML-stub variants were removed with the HTML audit path: their "clean" case was a bare `<main>` fragment, which a real rule engine correctly fails for having no page language and no title.
- Chromium runs everywhere. Locally and in CI it is the browser from `playwright install chromium`; on Vercel it ships with the function via `@sparticuz/chromium`. `src/integrations/browser/launch.ts` picks between them.

## Vercel

Set the same variables in the Vercel project dashboard (or via `vercel env add`):

- `AUDITOR_RUN_TOKEN` — Production + Preview
- `AUDITOR_SESSION_SECRET` — Production + Preview, a *different* value from the run token
- `DATABASE_URL` — injected by the Neon integration
- `BLOB_READ_WRITE_TOKEN` — injected by `vercel blob create-store <name> --access private`
- `CRON_SECRET` — Production; without it no schedule fires
- `AUDITOR_SELF_URL` — only if the inferred Vercel URL is not where runs should be posted
- Redis/KV REST URL + token — Production + Preview (durable sign-in throttle and run budget)
- `CHAOS_ENABLED` — Preview only (recommended); keep disabled in Production unless running controlled platform chaos

**Rotate `AUDITOR_RUN_TOKEN` at cutover.** It used to be the console password, so
every operator has historically known it. Until it is rotated and
`AUDITOR_SESSION_SECRET` is set, disabling an operator revokes nothing — they can
still sign in as the machine.

### Verify deploy checklist

1. `GET /api/health` → 200
2. `GET /api/ready` → 200, with an empty `warnings` array. It asks the throttle
   store whether it answers rather than trusting that the variables are set —
   a configured-but-dead Redis is reported as `unlock_throttle_unreachable`,
   which is the state that once returned `ready` with no warnings while every
   sign-in was failing. The probe is a read with no retries and a two-second
   ceiling, so a store that hangs slows nothing but itself. It gates only on the run token and the database; a shared session secret, a missing `CRON_SECRET`, in-memory counters and `CHAOS_ENABLED` are reported rather than gating, because none of them stops the control plane doing its job — but an empty array is the check, so every one of them has to appear there. Chaos in particular: it lets a caller request scripted audit outcomes and must never be set in production.
3. `npm run operator -- add` against the deployment's `DATABASE_URL` (`vercel env pull`), then sign in with that email and password
4. Run a fixture audit from the control plane, and open a piece of evidence from the findings list
5. Press **Run now** on a journey with a target URL and watch it reach a terminal status
6. Set a cadence on that journey, then tick by hand with the run token rather than waiting an hour: `curl -H "Authorization: Bearer $AUDITOR_RUN_TOKEN" https://<host>/api/cron/tick`
7. Optional: `GET /api/audit/runs/latest?journeyId=demo-login&environment=staging` with Bearer token after at least one successful run

## Security notes

- Never commit `.env`, `.env.local`, or real tokens.
- `CHAOS_ENABLED` applies to the **auditor platform** only; customer target chaos is out of scope.
