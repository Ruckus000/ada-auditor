# Environment Variables

Required for Phase 1 Vercel control plane operation.

| Variable | Required | Description |
|---|---|---|
| `AUDITOR_RUN_TOKEN` | Yes (for audit runs + readiness) | Server secret, and the console's unlock password. Must be at least 16 characters — use `openssl rand -hex 32`. The operator enters it once per browser to unlock the console; external callers send it to `POST /api/audit/run` as `Authorization: Bearer <token>` or `x-auditor-run-token`. Rotating it locks every console session. |
| `CHAOS_ENABLED` | No | Set to `true` to allow chaos scenario injection via API (`chaosScenario` body field) and to run `npm run chaos`. Default: disabled. |
| `RUN_STORE_PATH` | No | Directory for persisted audit run records (filesystem adapter). Default: `data/runs` under project root. On Vercel serverless, use a mounted path in preview or swap to Blob/KV when configured. |

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

## Vercel

Set the same variables in the Vercel project dashboard (or via `vercel env add`):

- `AUDITOR_RUN_TOKEN` — Production + Preview
- `CHAOS_ENABLED` — Preview only (recommended); keep disabled in Production unless running controlled platform chaos

## Security notes

- Never commit `.env`, `.env.local`, or real tokens.
- `CHAOS_ENABLED` applies to the **auditor platform** only; customer target chaos is out of scope for Phase 1.
