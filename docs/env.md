# Environment Variables

Required for Phase 1 Vercel control plane operation.

| Variable | Required | Description |
|---|---|---|
| `AUDITOR_RUN_TOKEN` | Yes (for audit runs + readiness) | Server secret, and the console's unlock password. Must be at least 16 characters — use `openssl rand -hex 32`. The operator enters it once per browser to unlock the console; external callers send it to `POST /api/audit/run` as `Authorization: Bearer <token>` or `x-auditor-run-token`. Rotating it locks every console session. |
| `CHAOS_ENABLED` | No | Set to `true` to allow chaos scenario injection via API (`chaosScenario` body field) and to run `npm run chaos`. Default: disabled. Preview only recommended. |
| `RUN_STORE_PATH` | No | Directory for persisted audit run records (filesystem adapter). Default: `data/runs` under project root. Used for local/CI when Redis/KV is not configured. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Required on Vercel | Upstash Redis REST credentials (also set by Vercel Redis/KV marketplace). When both are set, run metadata uses durable `KvRunStore` instead of the filesystem. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | No | Alternate Upstash env names; accepted if `KV_REST_API_*` is unset. |
| `BLOB_READ_WRITE_TOKEN` | Required on Vercel | Vercel Blob credentials, for run evidence (screenshot, DOM snapshot, accessibility tree). Unset means artifacts stay on local disk — fine locally and in CI, but on serverless the filesystem disappears with the invocation, so evidence would be unreachable. Provision Blob from the Vercel dashboard and the token is injected automatically. |
| `ARTIFACT_RETENTION_DAYS` | No | How long run evidence is kept. Default 30. These are screenshots of authenticated pages on client systems and contain real end-user data, so `npm run prune:artifacts` sweeps anything older; a missing or nonsensical value falls back to the default rather than to keeping them forever. |
| `ANTHROPIC_API_KEY` | No | Enables the AI advisory pass, which judges what a rule engine cannot — alt text that exists but says nothing, headings used for size rather than structure, error messages that do not say what to fix. Unset means the run completes with deterministic findings only; it is never a run failure. Advisory findings are always `gateable: false` and never affect `ciStatus`. |
| `AUDIT_CREDENTIAL_<REF>_USER` / `_PASS` | Per authenticated journey | Credentials for a client login. A journey step names a reference (`{ credentialRef: "acme", field: "pass" }`) and the value is resolved server-side, so the secret never travels in a request body, never persists with the journey, and never reaches a run log. Reference `acme` reads `AUDIT_CREDENTIAL_ACME_USER` / `AUDIT_CREDENTIAL_ACME_PASS`. Replaced the single global `AUDIT_DEMO_USER` / `AUDIT_DEMO_PASS` pair, which could only ever describe one login. |

## Local development

```bash
cp .env.example .env.local
# Set AUDITOR_RUN_TOKEN (or pull from Vercel — see below)
npm run dev
```

Open `http://localhost:3000`. The console asks for `AUDITOR_RUN_TOKEN` once to unlock, then stores a
signed, HttpOnly cookie for 30 days — every run after that needs no paste.

### Why the console needs unlocking

`POST /api/audit/console` runs audits with the server's own token, so the operator never handles it
per run. That convenience needs a gate. A same-origin header check is not one: `sec-fetch-site` and
`Origin` are trustworthy from a browser but forged trivially by anything else, so on their own they
let any caller spend the server's token. The console therefore requires an operator session, and
keeps the same-origin check underneath it as CSRF defence.

The cookie is an HMAC over its own expiry keyed on `AUDITOR_RUN_TOKEN` — it cannot be forged or
extended without the token, and the token itself is never stored in the browser.

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

- **Local/CI:** `FileRunStore` under `RUN_STORE_PATH` (default `data/runs`).
- **Vercel:** Redis/KV is required. `createRunStore()` fails closed when `VERCEL` is set and neither `KV_REST_API_*` nor `UPSTASH_REDIS_REST_*` is configured (no silent ephemeral filesystem). Provision Upstash Redis from the [Vercel Marketplace](https://vercel.com/marketplace?category=storage&search=redis) and link it so credentials are present. Run JSON metadata is durable. Artifacts go to Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, and their URLs are stored on the run record so a finding can always be traced back to the screenshot and DOM it came from. Locally and in CI they stay on disk, where they are already reachable.

## Auditing a real site

`POST /api/audit/run` takes an optional `targetUrl` plus `steps`. Absent a
`targetUrl` the run uses the built-in `file://` fixtures.

Every target is checked three ways before and during a run
(`src/integrations/browser/target-url.ts`): scheme and host up front; every
address the host resolves to, so a friendly name pointing into private space is
refused; and the URL the page actually settled on after each navigation, which
is what catches a redirect or a rebinding host. Blocked ranges include loopback,
RFC1918, carrier-grade NAT, IPv6 unique- and link-local, IPv4-mapped IPv6, and
`169.254.169.254` — the cloud metadata endpoint.

A run may only navigate to the target's own host. Off-origin navigation aborts
the run rather than following it. If a temporary agent-provisioned Redis was used for gate closing, claim it at the Upstash console URL before it expires, or replace with a Marketplace store.
- **KvRunStore concurrency (YAGNI):** single-writer / best-effort under concurrent saves (last writer wins on `latest`/`previous`). A crash between pointer updates can leave an orphaned `run:*` until the next successful save. Acceptable for v1 control-plane write rates; transactional MULTI is deferred. `getLatestRun` falls back to `previous:*` when `latest` points at a missing run.
- **CI/executive read:** `GET /api/audit/runs/latest?journeyId=&environment=` with the same run token returns the latest stored run plus optional regression vs the prior baseline.

## Chaos and browser mode

- `npm run chaos` exercises the three Playwright fixture scenarios (incomplete → `inconclusive`, critical → `fail`, clean → `pass`). The HTML-stub variants were removed with the HTML audit path: their "clean" case was a bare `<main>` fragment, which a real rule engine correctly fails for having no page language and no title.
- Chromium runs everywhere. Locally and in CI it is the browser from `playwright install chromium`; on Vercel it ships with the function via `@sparticuz/chromium`. `src/integrations/browser/launch.ts` picks between them.

## Vercel

Set the same variables in the Vercel project dashboard (or via `vercel env add`):

- `AUDITOR_RUN_TOKEN` — Production + Preview
- `CHAOS_ENABLED` — Preview only (recommended); keep disabled in Production unless running controlled platform chaos
- Redis/KV REST URL + token — Production + Preview (durable run store)

### Verify deploy checklist

1. `GET /api/health` → 200
2. `GET /api/ready` → 200 when `AUDITOR_RUN_TOKEN` is set and at least 16 characters (same bar as API auth / console unlock)
3. Unlock the console with the run token
4. Run a fixture audit from the control plane
5. Optional: `GET /api/audit/runs/latest?journeyId=demo-login&environment=staging` with Bearer token after at least one successful run

## Security notes

- Never commit `.env`, `.env.local`, or real tokens.
- `CHAOS_ENABLED` applies to the **auditor platform** only; customer target chaos is out of scope.
