# Handoff — ADA Auditor multitask continuation

Generated for context reset. Read `AGENTS.md` first.

## Paste into next chat

```text
You are continuing ADA Auditor at /Users/jphilistin/Documents/Coding/ADA Auditor.

MANDATORY FIRST READS:
1. AGENTS.md (Netflix philosophy + roadmap + testing policy)
2. docs/superpowers/specs/2026-07-28-ada-auditor-design.md
3. .cursor/rules/netflix-philosophy.mdc

LOCKED DECISIONS (do not reopen unless I say so):
- Principles: Chaos/steady-state + full-cycle operate-what-you-build
- Production surfaces: BOTH auditor platform AND customer targets, different blast radius
- Auditor platform host: Vercel (Next.js App Router wrapping existing core)
- Incomplete evidence → ciStatus inconclusive; reject deterministic findings
- platformHint wins over heuristics; AI advisory non-gateable; contracts enforced
- n8n optional wrapper only, never the brain
- YAGNI → KISS → SRP → DRY

CURRENT STATE:
- TypeScript/Vitest kernel exists under src/domain, src/services, src/integrations
- Adversarial remediations already landed; suite was green (~28 tests)
- Repo may still be untracked / no first commit — check git status
- NOT done: Vercel/Next shell, Playwright, persistence, live customer audits

GOAL THIS SESSION: Tackle as many roadmap phases as possible using multitask/parallel subagents (composer models only for subagents per user rule). Prefer:
Phase 1 (must complete): Vercel control plane
Phase 2 (if Phase 1 verified): one Playwright journey + real evidence capture
Phase 3 (if Phase 2 verified): persistence + regression comparison
Stop at phase boundaries if blocked on credentials (Vercel login, secrets).

PHASE 1 REQUIREMENTS:
1. If no commits yet and I approve: create baseline git commit of kernel (ask first if AGENTS.md says commit-only-when-asked — I APPROVE baseline + phase commits in this session)
2. Add Next.js App Router shell; keep domain/services/integrations as paved-road core
3. Routes: POST /api/audit/run (AUDITOR_RUN_TOKEN), GET /api/health, GET /api/ready
4. Structured JSON run logs (journey, env, platform, evidenceStatus, ciStatus, durationMs, failureReason, requestId)
5. Chaos: token-gated inject or npm run chaos asserting omit_ax_tree→inconclusive, complete+critical→fail, complete+clean→pass; CHAOS_ENABLED gate; NO live customer-site chaos
6. Deploy/link to Vercel; document env vars
7. Testing: TDD where practical; do not claim done without fresh npm test + next/vercel build evidence
8. Update docs/superpowers/specs with a short steady-state doc if missing

MULTITASK STRATEGY:
- Parallelize independent work: (A) Next app scaffolding + routes, (B) chaos script/tests, (C) docs/steady-state, (D) Playwright fixture app only after Phase 1 APIs exist
- Serialize shared contract changes to reporting/run-audit
- Use verification-before-completion: no success claims without command output

CONSTRAINTS:
- Do NOT edit attached Cursor plan files unless asked
- Do NOT expand React/WordPress into separate products
- Do NOT claim ADA legal certification
- Customer production audits remain policy-constrained (read-only-ish)

Start by reading AGENTS.md and git status, then execute Phase 1 with parallel subagents where safe. Continue into Phase 2/3 only after Phase 1 verification passes.
```

## Quick status checklist for the next agent

- [ ] `AGENTS.md` present with Netflix philosophy
- [ ] `.cursor/rules/netflix-philosophy.mdc` alwaysApply
- [ ] Kernel tests green
- [ ] Phase 1 Vercel APIs + chaos
- [ ] Phase 2 Playwright
- [ ] Phase 3 persistence/regression
