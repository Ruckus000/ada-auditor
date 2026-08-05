# Environment Variables

Required for Phase 1 Vercel control plane operation.

| Variable | Required | Description |
|---|---|---|
| `AUDITOR_RUN_TOKEN` | Yes (for audit runs + readiness) | Server secret, and the console's unlock password. Must be at least 16 characters — use `openssl rand -hex 32`. The operator enters it once per browser to unlock the console; external callers send it to `POST /api/audit/run` as `Authorization: Bearer <token>` or `x-auditor-run-token`. Rotating it locks every console session. |
| `CHAOS_ENABLED` | No | Set to `true` to allow chaos scenario injection via API (`chaosScenario` body field) and to run `npm run chaos`. Default: disabled. Preview only recommended. |
| `RUN_STORE_PATH` | No | Directory for persisted audit run records (filesystem adapter). Default: `data/runs` under project root. Used for local/CI when Redis/KV is not configured. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Required on Vercel | Upstash Redis REST credentials (also set by Vercel Redis/KV marketplace). When both are set, run metadata uses durable `KvRunStore` instead of the filesystem. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | No | Alternate Upstash env names; accepted if `KV_REST_API_*` is unset. |
| `AUDIT_DEMO_USER` / `AUDIT_DEMO_PASS` | Required when `AUDIT_TARGET_BASE_URL` is set | Credentials for the demo authenticated journey. Local fixtures default to `auditor` / `demo-pass` (must match `fixtures/journey-app/login.html`). Never send secrets in the public HTTP body. |
| `AUDIT_TARGET_BASE_URL` | No | Optional http(s) origin for staging-first journeys. When unset, browser mode uses local `file://` fixtures. When set, `AUDIT_DEMO_USER` and `AUDIT_DEMO_PASS` are required. |

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
- **Vercel:** Redis/KV is required. `createRunStore()` fails closed when `VERCEL` is set and neither `KV_REST_API_*` nor `UPSTASH_REDIS_REST_*` is configured (no silent ephemeral filesystem). Provision Upstash Redis from the [Vercel Marketplace](https://vercel.com/marketplace?category=storage&search=redis) and link it so credentials are present. Run JSON metadata is durable; screenshot/DOM/ax artifacts stay on local disk / ephemeral function FS until a later Blob pass (regression does not need binaries). If a temporary agent-provisioned Redis was used for gate closing, claim it at the Upstash console URL before it expires, or replace with a Marketplace store.
- **KvRunStore concurrency (YAGNI):** single-writer / best-effort under concurrent saves (last writer wins on `latest`/`previous`). A crash between pointer updates can leave an orphaned `run:*` until the next successful save. Acceptable for v1 control-plane write rates; transactional MULTI is deferred. `getLatestRun` falls back to `previous:*` when `latest` points at a missing run.
- **CI/executive read:** `GET /api/audit/runs/latest?journeyId=&environment=` with the same run token returns the latest stored run plus optional regression vs the prior baseline.

## Chaos and browser mode

- `npm run chaos` exercises HTML stub scenarios **and** Playwright fixture browser scenarios (incomplete → `inconclusive`, critical → `fail`, clean → `pass`).
- Browser chaos and `npm run test:browser` are **CI/local** gates. Vercel serverless does not run Playwright Chromium; cloud control-plane runs use the HTML/`runAudit` path (or a future dedicated browser runner).

## Vercel

Set the same variables in the Vercel project dashboard (or via `vercel env add`):

- `AUDITOR_RUN_TOKEN` — Production + Preview
- `CHAOS_ENABLED` — Preview only (recommended); keep disabled in Production unless running controlled platform chaos
- Redis/KV REST URL + token — Production + Preview (durable run store)

### Verify deploy checklist

1. `GET /api/health` → 200
2. `GET /api/ready` → 200 when `AUDITOR_RUN_TOKEN` is set and at least 16 characters (same bar as API auth / console unlock)
3. Unlock the console with the run token
4. Run a fixture HTML audit from the control plane
5. Optional: `GET /api/audit/runs/latest?journeyId=demo-login&environment=staging` with Bearer token after at least one successful run

## Security notes

- Never commit `.env`, `.env.local`, or real tokens.
- `CHAOS_ENABLED` applies to the **auditor platform** only; customer target chaos is out of scope.
