# Handoff — Phase 2 parallel track (Playwright)

Use this in a **separate chat/branch** while Phase 1 builds the Vercel control plane.
Goal: Phase 2 is merge-ready when Phase 1 lands, with minimal conflict.

## Merge strategy (required)

1. Phase 2 works on branch `feat/playwright-journey` (or equivalent).
2. Phase 1 owns: Next.js/`src/app`, Vercel config, `/api/*` routes, chaos HTTP inject, deploy docs.
3. Phase 2 owns: `src/integrations/browser/**`, journey fixtures, Playwright tests, evidence capture adapter.
4. **Do not** modify Phase 1 files unless unavoidable: `src/app/**`, `vercel.json`, `/api/**`, chaos HTTP routes.
5. Allowed shared touches only at a **stable seam**:
   - consume existing `createEvidenceBundle`, `runAudit` inputs, domain contracts
   - add `src/integrations/browser/journey-runner.ts` that outputs artifacts + html for `runAudit`
6. Merge order: **Phase 1 first → rebase Phase 2 → wire one call site** (`/api/audit/run` optional browser mode).

## Paste into Phase 2 chat

```text
You are on the PARALLEL Phase 2 track for ADA Auditor at /Users/jphilistin/Documents/Coding/ADA Auditor.

MANDATORY FIRST READS:
1. AGENTS.md
2. docs/superpowers/specs/2026-07-28-ada-auditor-design.md
3. docs/superpowers/handoffs/2026-07-28-multitask-continuation.md (Phase 1 scope — DO NOT duplicate it)
4. .cursor/rules/netflix-philosophy.mdc

YOU OWN PHASE 2 ONLY: Playwright journey runner + real evidence capture.
Phase 1 (another chat) owns Vercel/Next APIs. Avoid their files.

LOCKED:
- Chaos + full-cycle Netflix philosophy
- Dual production blast radius (customer prod mostly read-only)
- Existing contracts: inconclusive on incomplete evidence; platformHint precedence; AI non-gateable
- YAGNI → KISS → SRP → DRY
- Subagents: composer models only

BRANCH: create/use feat/playwright-journey. Do not merge to master until Phase 1 is in.

BUILD:
1. Add Playwright as a dependency for browser integration/tests
2. Create src/integrations/browser/ with:
   - journey-runner that executes ONE seeded authenticated (or mock-login) journey
   - captures screenshotPath, domSnapshotPath, axTreePath (real files under artifacts/ or tmp)
   - returns { html, artifacts, page meta } compatible with createEvidenceBundle / runAudit
3. Add a tiny local fixture app OR use a static HTML fixture server for the journey (keep minimal)
4. Enforce customer-target action policy via existing isActionAllowed before clicks
5. Tests (TDD):
   - unit/integration: runner produces complete evidence bundle fields
   - chaos: kill capture of ax tree mid-run → downstream must be able to call runAudit with omit/missing ax → inconclusive
   - policy: denied action in production environment never executes
6. Do NOT build Next routes, Vercel deploy, or persistence (Phase 1 / Phase 3)
7. Optional thin composer: runBrowserAudit() = journeyRunner → runAudit(html, artifacts)
8. Document how Phase 1 should call the seam in a short README under src/integrations/browser/README.md

MULTITASK: parallelize fixture app, Playwright runner, and tests if independent.
VERIFY: npm test + any Playwright test script; no success claims without output.
When done: leave branch merge-ready; list exact files Phase 1 must touch to wire the API (one PR note).
```

## Conflict hotspots to avoid

- `package.json` / lockfile — coordinate: Phase 2 may add `playwright`; Phase 1 adds `next`. Prefer additive deps; rebase carefully.
- `src/services/run-audit.ts` — Phase 2 should wrap it, not rewrite Vercel concerns into it.
- `tsconfig.json` — keep changes minimal and compatible with both Vitest and Next.
