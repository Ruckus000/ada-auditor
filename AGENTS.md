# ADA Auditor — Agent Guide

This file is the project-level operating manual for coding agents (Cursor `AGENTS.md` / Claude.md equivalent). Follow it unless the user explicitly overrides it.

## Product

Evidence-first ADA/WCAG **accessibility risk auditor** for authenticated multi-step web apps. Hybrid system: deterministic checks + AI advisory. Not a legal certification authority.

Primary sources of truth:

- Spec: [`docs/superpowers/specs/2026-07-28-ada-auditor-design.md`](docs/superpowers/specs/2026-07-28-ada-auditor-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-07-28-ada-auditor.md`](docs/superpowers/plans/2026-07-28-ada-auditor.md)
- Environment variables: [`docs/env.md`](docs/env.md)
- Status and known gaps: [`docs/status.md`](docs/status.md)

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
- Do not claim “done” without fresh `npm run lint`, `npm test`, `npm run test:browser`, `npm run test:db`, `npm run chaos`, `npm run build` and `npm run test:hydration` evidence
- Structured events go through `services/logger`. `tests/services/log-shape.test.ts`
  greps the tree for hand-built JSON envelopes, because five call sites had
  already drifted — one keyed its event `event` instead of `type`, so a pipeline
  filtering on `type` silently missed the loudest warning in the product
- The fast suite launches no browser and opens no socket. New store behaviour
  goes in a shared contract (`tests/support/run-store-contract.ts`,
  `platform-store-contract.ts`) so the in-memory doubles and Postgres cannot
  drift apart — a double that quietly disagrees makes the fast suite green
  about behaviour production does not have
- Shared contracts run against a database that already holds real rows, so
  scope every assertion. `listClients()` and `listEvents()` take no filter that
  can isolate them: assert with `toContain`, never `toEqual`/`toHaveLength`
- Keep browser launches out of the unit suite. Handler tests mock the audit; the real browser is covered by `tests/integrations/browser/**` and by chaos.
- When adding Vercel routes: add route/handler tests or chaos script assertions for terminal statuses
- Before claiming a change works end to end, run one real audit through
  `next start` (not just `next dev`). Vitest loads modules unbundled, so
  packaging faults reach production with every suite green
- Never import a `scripts/*` entry point from a test. They call `main()` at
  import, so the test runs the script: importing `migrate.ts` for one pure
  helper silently migrated the real database on every local `npm test`, and
  failed CI outright where no database exists. Extract the pure part into its
  own module and test that
- `npm run test:hydration` also runs our own axe engine against our own
  screens, asserted at **zero** violations. A threshold would be a budget for
  shipping barriers, which is not a position this product can hold. It found
  two real defects the first time it ran
- `AUDITOR_STORE=memory` is the only way to run the built server without a
  database, and exists for the hydration suite in CI. It is an explicit opt-in,
  never a fallback for a missing `DATABASE_URL` — a fallback would let a
  misconfigured deploy serve an empty portfolio and discard runs in silence.
  The ephemeral stores hang off `globalThis`, because Next bundles route
  handlers and pages separately and a module-level singleton would give each
  its own store
- UI changes additionally need `npm run test:hydration` (after `npm run
  build`). It drives the built app in a real browser and asserts the pages are
  *alive* — React attached, navigation changes the URL. An entirely inert UI
  once passed `tsc`, 453 unit tests and a clean build, because none of them
  can see whether a page hydrated

## Status and known gaps

What is built, what has only been exercised locally, and every gap you should
read before claiming something works: [`docs/status.md`](docs/status.md).
Update it in the same change that makes it wrong.

## Agent behavior

- Do not invent Netflix process that isn’t grounded in these rules
- Prefer multitask/parallel agents for independent files/phases; serialize shared contract changes
- Do not edit plan files the user attached unless asked
- Ask before destructive git operations; commit only when asked (unless the user explicitly requests committing as part of the phase)
