# ADA Auditor — Agent Guide

This file is the project-level operating manual for coding agents (Cursor `AGENTS.md` / Claude.md equivalent). Follow it unless the user explicitly overrides it.

## Product

Evidence-first ADA/WCAG **accessibility risk auditor** for authenticated multi-step web apps. Hybrid system: deterministic checks + AI advisory. Not a legal certification authority.

Primary sources of truth:

- Spec: [`docs/superpowers/specs/2026-07-28-ada-auditor-design.md`](docs/superpowers/specs/2026-07-28-ada-auditor-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-07-28-ada-auditor.md`](docs/superpowers/plans/2026-07-28-ada-auditor.md)

## Netflix-aligned engineering philosophy (non-negotiable)

User-locked principles for this repo:

1. **Chaos / steady-state confidence**
2. **Full-cycle: operate what you build**

Supporting Netflix practices we adopt:

- **Context, not control** — encode contracts and steady-state definitions; avoid process theater
- **Paved road** — one audit core; platform adapters enrich at the edge; opt-in adapters, not forked products
- **Minimize blast radius** — especially on customer production
- **Automate experiments continuously** — chaos hypotheses live as tests/scripts, not one-off manuals
- **Data over opinion** — CI/chaos results decide readiness to scale breadth

### Dual production surfaces

| Surface | Meaning | Blast radius |
|---|---|---|
| **Auditor platform** | Our Vercel-hosted control plane (APIs, cron, runners) | Chaos allowed with gates (`CHAOS_ENABLED`), auto-stop, structured logs |
| **Customer targets** | Sites/apps we audit | Production = strict action policy (mostly read-only); preview/staging richer; never exploratory destructive self-healing in customer prod |

### Steady-state rules (must not regress)

- Incomplete evidence → `ciStatus: 'inconclusive'` (never `pass`, never `fail`).
  Evidence is per page and the run takes the worst: one page missing an
  artifact makes the whole run inconclusive
- Deterministic findings from incomplete evidence are **rejected**, per page
- Every page a journey navigates to is audited — never only the last one — and
  every deterministic finding carries the `pageUrl` it was found on
- Explicit `platformHint` wins over rendered-DOM heuristics
- AI advisory is independent of deterministic hits; `gateable: false` in v1
- Run contracts are enforced (scope, confidence `minReport`, `failureMode`)
- Forbidden production actions never execute
- A run may only navigate to hosts in `scope.allowedDomains`; an empty scope
  denies everything rather than allowing it
- Credentials are referenced, never inlined — no secret in a request body, a
  stored journey, or a run log

### Full-cycle expectations

Anyone shipping a feature also ships:

- tests (prefer TDD: red → green → refactor)
- structured observability for new failure modes
- chaos/steady-state coverage when the change affects reliability semantics
- operable deploy path on **Vercel** (no “ops later”)

## Architecture boundaries

Follow `YAGNI → KISS → SRP → DRY`.

- `/src/domain` — contracts, policy, evidence, platforms (no HTTP/framework imports beyond validation libs)
- `/src/services` — orchestration (rule mapping, reporting, AI advisory, ax-tree pruning). Must not import Playwright or axe-core: browser work belongs in integrations, and keeping services framework-free is what keeps them in the fast unit suite, which excludes `tests/integrations/browser/**`.
- `/src/integrations` — browser, AI providers, platform adapters, schedulers
- `/src/app` or `/src/api` — Next.js / Vercel edges only
- Framework code at the edges; business rules in the center

`n8n` may orchestrate around the core; it must not become the audit brain.

## Testing policy

- Domain/service unit tests required for contract and reporting changes
- Chaos-style regressions required for steady-state claims (incomplete evidence, hint conflicts, scope fail-closed, complete-evidence CI fail path)
- Do not claim “done” without fresh `npm test`, `npm run test:browser`, `npm run chaos` and `npm run build` evidence
- Keep browser launches out of the unit suite. Handler tests mock the audit; the real browser is covered by `tests/integrations/browser/**` and by chaos.
- When adding Vercel routes: add route/handler tests or chaos script assertions for terminal statuses
- Before claiming a change works end to end, run one real audit through
  `next start` (not just `next dev`). Vitest loads modules unbundled, so
  packaging faults reach production with every suite green

## Current status

Implemented and verified locally + on Vercel preview:

- Domain contracts, evidence, policy, platforms
- **Rule engine: axe-core (~100 rules) against the live page.** One finding per
  offending element, each carrying a selector, WCAG success criteria, a
  conformance level, a help URL and a snippet. The scan runs in
  `integrations/browser/axe-scan.ts`; `services/deterministic-audit.ts` maps its
  plain-data output and imports neither Playwright nor axe-core.
- **AI advisory: a real `claude-opus-5` call** with strict tool use, over the
  pruned accessibility tree plus axe's undecided checks. Judges what rules
  cannot — alt text that says nothing, headings used for size, error text that
  does not say what to fix. Gated on `ANTHROPIC_API_KEY`; absent or failing, the
  run completes without it. Always `gateable: false`.
- **Real targets.** `POST /api/audit/run` takes `targetUrl` and `steps`. Every
  target is checked on scheme, host, all resolved addresses, and again on the
  URL the page settled on after each navigation.
- **Multi-page runs.** `runJourney` scans after every navigation and returns
  `{ pages, truncatedPages }`; each page carries its own axe results, AX tree
  and artifact set under `runs/<requestId>/<pageKey>/`. Findings carry
  `pageUrl`, evidence is per page and the run takes the worst, and pages per
  run are capped (`AUDITOR_MAX_PAGES_PER_RUN`, default 20) with a
  `audit_page_cap_reached` log when the cap truncates a journey. The AI
  advisory runs **once over the aggregate**, not per page — N× cost otherwise,
  and cross-page issues only exist in aggregate.
- Reporting (`pass|fail|inconclusive`), regression comparison keyed on
  rule + page + selector, `FileRunStore` + Upstash `KvRunStore`,
  `GET /api/audit/runs/latest`
- Chromium everywhere: the installed browser locally and in CI,
  `@sparticuz/chromium` on Vercel (`integrations/browser/launch.ts`).
  `@axe-core/playwright` and `axe-core` are in `serverExternalPackages`
  alongside them: axe is injected into the page as a *source string*, so
  bundling it breaks every run made through the app.
- **Console: findings grouped by page.** `groupFindingsByPage` in
  `app/components/audit-types.ts` (pure, unit-tested) drives the grouping; the
  evidence panel lists each audited page with its own artifact checklist, and
  a truncated run says so.
- Tests: Vitest unit + browser suites green; `npm run chaos` green

### Known gaps

Read this before claiming something works.

- **`RunStore` cannot list.** The interface is `saveRun` / `getRun` /
  `getLatestRun`; there is no way to enumerate run history. It lands with the
  Postgres store in Phase 2B — see
  `docs/superpowers/plans/2026-08-07-phase-2.md`.
- **A page cap of 20 is a guess, not a measurement.** No real journey has been
  run against it. If real journeys exceed it, that is the signal for a
  container worker rather than a bigger number.
- **Neither test suite exercises the app's own bundle.** Vitest loads modules
  unbundled, so a packaging fault in the Next build is invisible to all 344
  tests — which is exactly how `@axe-core/playwright` shipped with its
  injected source mangled by the bundler and every run through the app failing
  while the suites stayed green. The only thing that catches this class of bug
  is running a real audit through `next start`. Do that before claiming a
  change works end to end.

- **A run still cannot outlive one function invocation.** `maxDuration` is 300s
  (the Hobby ceiling; Pro allows 800s). The 202 + poll shape unblocks the caller
  but does not add compute — background work is bounded by the same limit. A
  real site-wide crawl needs a container worker, not a bigger number here.
- **The console still blocks.** It calls `?wait=1`, because its run flow renders
  a result rather than polling. The async shape is there for API and CI callers.
- **No tenancy.** One shared `AUDITOR_RUN_TOKEN`, a flat `journeyId:environment`
  keyspace, and `accountId: 'acct-demo'` hardcoded. Any authenticated caller can
  read any run by guessing a journeyId.
- **The UI at `/` is a fixture prototype.** Roughly 7,000 lines with no `fetch`
  calls, no persistence and no auth. The working surface is `/console`.

## Agent behavior

- Do not invent Netflix process that isn’t grounded in these rules
- Prefer multitask/parallel agents for independent files/phases; serialize shared contract changes
- Do not edit plan files the user attached unless asked
- Ask before destructive git operations; commit only when asked (unless the user explicitly requests committing as part of the phase)
