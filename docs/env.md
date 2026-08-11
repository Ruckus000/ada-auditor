# Environment Variables

Required for Phase 1 Vercel control plane operation.

| Variable | Required | Description |
|---|---|---|
| `AUDITOR_RUN_TOKEN` | Yes (for audit runs + readiness) | The **machine** credential: CI, scripts, the scheduler, and the way into the console before the first operator account exists. Must be at least 16 characters — use `openssl rand -hex 32`. Callers send it to `POST /api/audit/run` as `Authorization: Bearer <token>` or `x-auditor-run-token`. People sign in with an email and a password instead (`npm run operator -- add`), so this should stop being something operators know — while they know it, disabling an operator revokes nothing. Rotating it signs every human out **only** while `AUDITOR_SESSION_SECRET` is unset. |
| `AUDITOR_SESSION_SECRET` | Recommended | Signs operator session cookies. Keep it separate from `AUDITOR_RUN_TOKEN`: while they are the same value, rotating the machine token signs every human out, which is the exact coupling operator accounts exist to break. Unset falls back to the run token and `/api/ready` warns (`session_secret_shared_with_run_token`) rather than failing — a deployment driven entirely by CI is still a working one. Rotating this *is* the deliberate "sign everyone out" lever. |
| `AUDITOR_OPERATOR_NAME` | No | Who activity is attributed to when the caller is a **machine** — CI, a script, the scheduler. A signed-in operator is recorded under their own name and `operators.id` instead, so this no longer stands in for a person. Unset renders as `Operator`. It replaced a hardcoded `"Jules Reyes"` that read as though the product knew who was signed in. |
| `AUDITOR_STORE` | No | Set to `memory` to run against ephemeral in-process stores instead of Postgres. For harnesses that boot the real server without a database — the hydration and accessibility suites in CI. It is an explicit opt-in, never a fallback for a missing `DATABASE_URL`: a fallback would let a misconfigured deploy serve an empty portfolio and discard every run silently. Nothing persists, and the process logs `store_memory_mode` on the way past. Never set it in a deployed environment. |
| `CRON_SECRET` | Required for schedules | Vercel Cron sends `Authorization: Bearer $CRON_SECRET` to `/api/cron/tick` every hour (`vercel.json`). Unset means the tick refuses every request and no journey schedule ever fires — reported by `/api/ready` as `cron_secret_not_configured`, and reported rather than gating, because an auditor driven entirely by hand is a working deployment. The run token is also accepted, so an operator can tick by hand instead of waiting an hour to find out whether a new schedule works. |
| `AUDITOR_SELF_URL` | No | Where the tick posts its dispatched runs, e.g. `https://auditor.example.com`. Inferred from `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL` when unset. **Never** taken from a request header: `host` and `x-forwarded-host` are attacker-controlled and the tick attaches the machine token to whatever it posts to, so trusting them would hand the token to anyone who could reach the endpoint with a spoofed header. With neither set, the tick claims nothing and says so. |
| `CRON_MAX_STARTS_PER_TICK` | No | Most journeys dispatched per hourly tick. Default 3. Each dispatch is a separate invocation with its own Chromium, so this and the run budget are what stop one tick launching a fleet. When it truncates, the tick logs how many were deferred — they are picked up next hour, not dropped. |
| `AUDITOR_MAX_RUNS_PER_HOUR` / `_PER_DAY` | No | Ceiling on audits started per window. Defaults 20 and 100. A run launches a browser and makes a model call, so without this a loop in a caller spends real money unattended. Global rather than per operator — the bill is shared. Both windows are counted even when the first already refuses, because the counters describe demand, not permitted demand. Fails **open** if the counter is unreachable: a cost control that becomes an outage has made things worse. |
| `AUDITOR_MAX_PAGES_PER_RUN` | No | Pages audited per run before the journey is truncated. Default 20 — a starting point, not a measurement; `audit_page_cap_reached` records when it bit, and `run_pages.duration_ms` is what will eventually replace the guess with a number. Read by the code since long before it was documented anywhere. |
| `AUDITOR_RUN_STALE_SECONDS` | No | How long a run may sit in `running` before it is treated as abandoned. Default 360 — `maxDuration` plus a minute of grace. A run whose function times out or crashes never gets to overwrite its own row, so without this a dead run is displayed as "scanning" forever. Derived on read so screens are honest immediately, and written back durably by the hourly tick. |
| `CHAOS_ENABLED` | No | Set to `true` to allow chaos scenario injection via API (`chaosScenario` body field) and to run `npm run chaos`. Default: disabled. Preview only recommended. |
| `DATABASE_URL` | Yes | Neon Postgres connection string, injected by the Vercel Marketplace integration (`vercel integration add neon`). The run store needs it everywhere, including locally — there is no filesystem fallback, because one would mean a misconfigured deploy quietly writing runs to a disk that disappears with the invocation. Apply the schema with `npm run migrate`. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | No | Upstash Redis REST credentials. The console sign-in throttle and the run budget both count here. Unset means both count in process memory, which on serverless resets on every cold start and is per-instance — so the effective run ceiling becomes the limit times however many instances are warm, and the throttle is a speed bump rather than a limit. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | No | Alternate Upstash env names; accepted if `KV_REST_API_*` is unset. |
| `BLOB_READ_WRITE_TOKEN` | Required on Vercel | Vercel Blob credentials, for run evidence (screenshot, DOM snapshot, accessibility tree). Unset means artifacts stay on local disk — fine locally and in CI, but on serverless the filesystem disappears with the invocation, so evidence would be unreachable. Provision with `vercel blob create-store <name> --access private` and the token is injected automatically. **The store must be private**: this evidence is authenticated pages on a client's system, and uploads are written with `access: 'private'` — a public store would leave the stored URL as the only thing protecting it. |
| `ARTIFACT_RETENTION_DAYS` | No | How long run evidence is kept. Default 30. These are screenshots of authenticated pages on client systems and contain real end-user data, so `npm run prune:artifacts` sweeps anything older; a missing or nonsensical value falls back to the default rather than to keeping them forever. |
| `ANTHROPIC_API_KEY` | No | Enables the AI advisory pass, which judges what a rule engine cannot — alt text that exists but says nothing, headings used for size rather than structure, error messages that do not say what to fix. Unset means the run completes with deterministic findings only; it is never a run failure. Advisory findings are always `gateable: false` and never affect `ciStatus`. |
| `AUDIT_CREDENTIAL_<REF>_USER` / `_PASS` | Per authenticated journey | Credentials for a client login. A journey step names a reference (`{ credentialRef: "acme", field: "pass" }`) and the value is resolved server-side, so the secret never travels in a request body, never persists with the journey, and never reaches a run log. Reference `acme` reads `AUDIT_CREDENTIAL_ACME_USER` / `AUDIT_CREDENTIAL_ACME_PASS`. Replaced the single global `AUDIT_DEMO_USER` / `AUDIT_DEMO_PASS` pair, which could only ever describe one login. |

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

A run may only navigate to the target's own host. Off-origin navigation aborts
the run rather than following it.

**CI/executive read:** `GET /api/audit/runs/latest?journeyId=&environment=` with
the run token returns the latest stored run plus optional regression against the
prior baseline.

## Scheduling

`vercel.json` points Vercel Cron at `GET /api/cron/tick`, hourly. Each tick:

1. Claims the journeys whose cadence is due (`for update skip locked`, so two
   overlapping ticks cannot both claim one and bill a client twice).
2. Posts each to `/api/audit/run` with the machine token — it **dispatches**
   rather than audits, because one 300s function cannot walk N journeys through
   a browser, and each dispatch needs its own invocation and its own Chromium.
   The dispatches are awaited: a serverless function is frozen the moment it
   responds, so fire-and-forget `fetch` calls would never leave the box, and the
   failure mode is a scheduler that reports success and audits nothing.
3. Reconciles runs stuck in `running` past `AUDITOR_RUN_STALE_SECONDS`.

`last_scheduled_at` is written only after a dispatch is accepted, so a dropped
tick retries next hour rather than being marked done. Per-journey cadence lives
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
2. `GET /api/ready` → 200, with an empty `warnings` array. It gates only on the run token and the database; a shared session secret, a missing `CRON_SECRET` and in-memory counters are reported rather than gating, because none of them stops the control plane doing its job.
3. `npm run operator -- add` against the deployment's `DATABASE_URL` (`vercel env pull`), then sign in with that email and password
4. Run a fixture audit from the control plane, and open a piece of evidence from the findings list
5. Press **Run now** on a journey with a target URL and watch it reach a terminal status
6. Set a cadence on that journey, then tick by hand with the run token rather than waiting an hour: `curl -H "Authorization: Bearer $AUDITOR_RUN_TOKEN" https://<host>/api/cron/tick`
7. Optional: `GET /api/audit/runs/latest?journeyId=demo-login&environment=staging` with Bearer token after at least one successful run

## Security notes

- Never commit `.env`, `.env.local`, or real tokens.
- `CHAOS_ENABLED` applies to the **auditor platform** only; customer target chaos is out of scope.
