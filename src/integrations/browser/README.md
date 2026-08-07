# Browser integration (Phase 2)

Playwright journey runner that captures real evidence artifacts for `createEvidenceBundle` / `runAudit`.

## Seam for Phase 1

After Phase 1 lands, wire **one call site** in `src/app/api/_lib/audit-run-handler.ts` (or equivalent):

```typescript
import { runBrowserAudit } from '@/integrations/browser';
import { join } from 'node:path';

// When request body includes browserMode: true (or similar):
const report = await runBrowserAudit({
  journeyId: body.journeyId,
  environment: body.environment,
  stepId: 'dashboard',
  fixtureDir: join(process.cwd(), 'fixtures/journey-app'), // replace with customer URL in prod
  artifactsDir: join(process.cwd(), 'artifacts', requestId),
  // steps: optional; defaults to mock-login → dashboard
});
```

Return `report` fields (`ciStatus`, `evidenceStatus`, `findings`, etc.) in the API JSON response.

### Files Phase 1 should touch

| File | Change |
|------|--------|
| `src/app/api/_lib/audit-run-handler.ts` | Import `runBrowserAudit`; branch on browser vs stub HTML mode |
| `src/app/api/audit/run/route.ts` | Pass through optional `browserMode` / journey options from body |
| `package.json` | Merge `playwright` devDep; add `postinstall` or CI step: `npx playwright install chromium` |
| `.gitignore` | Ensure `artifacts/` is ignored (runtime capture output) |

Do **not** duplicate journey logic in the route — call this module only.

## Local usage

```bash
npx playwright install chromium
npm test -- tests/integrations/browser
```

## Contracts

- Every planned step is checked with `isActionAllowed(environment, action)` before Playwright executes it.
- **Every navigation is scanned**, not just the last one. `runJourney` returns
  `{ pages, truncatedPages }`; consecutive steps that leave the URL unchanged
  are captured once.
- Evidence is per page. Missing `axTreePath` (or `omitAxTree: true`) → that
  page is degraded, its deterministic findings are rejected, and the run takes
  the worst status → `ciStatus: inconclusive`.
- Pages per run are capped (`maxPages`, else `AUDITOR_MAX_PAGES_PER_RUN`, else
  20). Truncation is logged as `audit_page_cap_reached` and reported as
  `truncatedPages` — a partial audit never presents as a complete one.
- Customer production: denied actions throw before any click.

## Merge / rebase

1. Merge Phase 1 to `master` first.
2. `git checkout feat/playwright-journey && git rebase master`
3. Resolve `package.json` / lockfile additively (keep both `next` and `playwright`).
4. Wire the API call site above.
