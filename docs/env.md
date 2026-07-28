# Environment Variables

Required for Phase 1 Vercel control plane operation.

| Variable | Required | Description |
|---|---|---|
| `AUDITOR_RUN_TOKEN` | Yes (for audit runs + readiness) | Secret token for `POST /api/audit/run`. Send as `Authorization: Bearer <token>` or `x-auditor-run-token`. |
| `CHAOS_ENABLED` | No | Set to `true` to allow chaos scenario injection via API (`chaosScenario` body field) and to run `npm run chaos`. Default: disabled. |
| `RUN_STORE_PATH` | No | Directory for persisted audit run records (filesystem adapter). Default: `data/runs` under project root. On Vercel serverless, use a mounted path in preview or swap to Blob/KV when configured. |

## Local development

```bash
cp .env.example .env.local
# Edit AUDITOR_RUN_TOKEN
npm run dev
```

## Vercel

Set the same variables in the Vercel project dashboard (or via `vercel env add`):

- `AUDITOR_RUN_TOKEN` — Production + Preview
- `CHAOS_ENABLED` — Preview only (recommended); keep disabled in Production unless running controlled platform chaos

## Security notes

- Never commit `.env`, `.env.local`, or real tokens.
- `CHAOS_ENABLED` applies to the **auditor platform** only; customer target chaos is out of scope for Phase 1.
