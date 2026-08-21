# ADA Auditor

The project operating manual is @AGENTS.md — read it before changing anything.
Status and known gaps: [`docs/status.md`](docs/status.md).

## Setup

```bash
npm ci
npx playwright install chromium
cp .env.example .env.local   # DATABASE_URL is required; every variable is documented in docs/env.md
npm run migrate              # applies src/integrations/persistence/schema.sql
npm run dev
```

## Verification

Do not claim a change works without fresh evidence from all of these:

```bash
npm run lint && npm test && npm run test:browser && npm run test:db && npm run chaos && npm run build && npm run test:hydration
```

- `npm run chaos` needs `CHAOS_ENABLED=true`.
- `npm run test:hydration` drives the built app, so it needs a prior `npm run build`.
- `npm run test:db` needs a `DATABASE_URL` pointed at a scratch Neon branch, never production — the store contract writes and deletes rows.
- Before claiming a change works against a real site, run one audit through
  `next start` with `npm run smoke:real -- --url <site>`. Vitest loads modules
  unbundled, so packaging faults reach production with every suite green.
