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

- Incomplete evidence → `ciStatus: 'inconclusive'` (never `pass`, never `fail`)
- Deterministic findings from incomplete evidence are **rejected**
- Explicit `platformHint` wins over HTML heuristics
- AI advisory is independent of deterministic hits; `gateable: false` in v1
- Run contracts are enforced (scope, confidence `minReport`, `failureMode`)
- Forbidden production actions never execute

### Full-cycle expectations

Anyone shipping a feature also ships:

- tests (prefer TDD: red → green → refactor)
- structured observability for new failure modes
- chaos/steady-state coverage when the change affects reliability semantics
- operable deploy path on **Vercel** (no “ops later”)

## Architecture boundaries

Follow `YAGNI → KISS → SRP → DRY`.

- `/src/domain` — contracts, policy, evidence, platforms (no HTTP/framework imports beyond validation libs)
- `/src/services` — orchestration (`runAudit`, reporting, deterministic + AI)
- `/src/integrations` — browser, AI providers, platform adapters, schedulers
- `/src/app` or `/src/api` — Next.js / Vercel edges only
- Framework code at the edges; business rules in the center

`n8n` may orchestrate around the core; it must not become the audit brain.

## Testing policy

- Domain/service unit tests required for contract and reporting changes
- Chaos-style regressions required for steady-state claims (incomplete evidence, hint conflicts, scope fail-closed, complete-evidence CI fail path)
- Do not claim “done” without fresh `npm test` and `npm run build` evidence
- When adding Vercel routes: add route/handler tests or chaos script assertions for terminal statuses

## Current kernel status (as of 2026-07-28)

Implemented and verified locally + on Vercel preview:

- Domain contracts, evidence, policy, platforms
- Services: deterministic audit, AI advisory, reporting (`pass|fail|inconclusive`), `runAudit`
- Platform adapters: generic / react / wordpress
- Phase 1 control plane: Next.js App Router, `/api/audit/run`, `/api/health`, `/api/ready`, console session unlock, structured run logs, `npm run chaos` (HTML + browser fixtures), GitHub Actions CI
- Phase 2: Playwright authenticated demo journey (credential form + fill), real DOM/ax/screenshot evidence, `AUDIT_TARGET_BASE_URL` staging seam
- Phase 3: `FileRunStore` (local/CI) + Upstash Redis `KvRunStore` (Vercel), regression comparison, `GET /api/audit/runs/latest`
- Tests: Vitest unit suite + browser suite green; chaos boringly green including browser scenarios

### Phase 4 — Scale breadth (NEXT)

- More journeys/adapters only after Phase 1–2 chaos stays boringly green

## Roadmap (execute in order; multitask only independent work)

### Phase 1 — Vercel control plane — DONE
1. Git baseline commit of current kernel
2. Next.js App Router shell wrapping existing core
3. `POST /api/audit/run`, `GET /api/health`, `GET /api/ready` + `AUDITOR_RUN_TOKEN`
4. Structured JSON run logs
5. Auditor-platform chaos inject + `npm run chaos` (preview/CI); customer sites out of scope
6. Deploy to Vercel

### Phase 2 — Real browser journey — DONE
- One Playwright authenticated journey + real DOM/ax/screenshot evidence
- Same contracts; staging-first for customer targets (`AUDIT_TARGET_BASE_URL`)

### Phase 3 — Persistence + regression — DONE
- Store runs/findings (filesystem + Redis/KV); compare baselines; `GET /api/audit/runs/latest` for CI/executive consumers

### Phase 4 — Scale breadth (NEXT)
- More journeys/adapters only after Phase 1–2 chaos is boringly green

## Agent behavior

- Do not invent Netflix process that isn’t grounded in these rules
- Prefer multitask/parallel agents for independent files/phases; serialize shared contract changes
- Do not edit plan files the user attached unless asked
- Ask before destructive git operations; commit only when asked (unless the user explicitly requests committing as part of the phase)
