# Environment Variables

Required for Phase 1 Vercel control plane operation.

| Variable | Required | Description |
|---|---|---|
| `AUDITOR_RUN_TOKEN` | Yes (for audit runs + readiness) | Server secret. Control plane UI (`POST /api/audit/console`) uses it automatically. External callers use `POST /api/audit/run` with `Authorization: Bearer <token>` or `x-auditor-run-token`. |
| `CHAOS_ENABLED` | No | Set to `true` to allow chaos scenario injection via API (`chaosScenario` body field) and to run `npm run chaos`. Default: disabled. |
| `RUN_STORE_PATH` | No | Directory for persisted audit run records (filesystem adapter). Default: `data/runs` under project root. On Vercel serverless, use a mounted path in preview or swap to Blob/KV when configured. |

## Local development

```bash
cp .env.example .env.local
# Set AUDITOR_RUN_TOKEN (or pull from Vercel — see below)
npm run dev
```

Open `http://localhost:3000` and click **Run fixture journey**. No token paste — the console uses `.env.local`.

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
