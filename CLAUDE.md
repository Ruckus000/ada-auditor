# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read `AGENTS.md` first

[`AGENTS.md`](AGENTS.md) is the project's operating manual: product definition, the
non-negotiable engineering philosophy, the **steady-state rules that must not
regress**, current status, and a long "Known gaps" section that records what is
*not* true yet. Read it before claiming anything works.
`.cursor/rules/netflix-philosophy.mdc` is a short summary of the same rules.

This file covers what `AGENTS.md` does not: how to run things, and the
cross-cutting traps that only show up when you read several files together.

## Commands

```bash
npm run dev              # next dev
npm run build            # next build
npm start                # next start — needed for the hydration + smoke suites
npm run lint             # eslint . (flat config; `next lint` is gone in Next 16)
npm run typecheck        # next typegen && tsc -p tsconfig.typecheck.json — NOT bare `tsc`
```

**Two suites run the compiled Java, and both fail loudly when it is stale.**
`dist/documents/classes` is gitignored and nothing rebuilds it on its own, so
either suite can otherwise report on class files compiled from a different
revision — a false red once, and a false green waiting to happen.
`staleStagesComplaint()` (`tests/support/compiled-stages.ts`) compares the
newest `.java` against the oldest `.class`; `vitest.documents.config.ts` throws
on it before collecting, and the two document cases in
`platform-hydration.test.ts` throw on it in their first line. A machine with no
JDK and no build still skips — that is a contributor's environment. A tree that
was compiled and then moved is not.

`npm run typecheck` is the CI gate and the **only** config that sees
`tests/integrations/**`. Bare `tsc` uses `tsconfig.json`, which excludes that
directory, so the two suites that drive a real browser would be type-checked by
nothing.

**It runs `next typegen` first, and that is load-bearing.** `next-env.d.ts` is
generated and gitignored, and the gate runs before anything builds — `ci.yml`
has its `npm run typecheck` step above its `npm run build` step, and localci's
`gate` phase precedes the `suite` that builds. Without the prefix a fresh
clone type-checks with the file absent, and it *passes*:
`next/types/global.d.ts` still arrives through the four
`import type { Metadata } from 'next'` lines in `src/app/**`. That is the
problem. Those four incidental imports are the only thing keeping
`NodeJS.ProcessEnv.NODE_ENV` a required `'development' | 'production' | 'test'`,
which two comments in `integrations/documents/` explain their `Env` type
against, and an app refactor that drops them weakens the check with nothing
turning red. `next typegen` is ~0.8s warm or cold and makes the gate mean the
same thing on a fresh clone as on a built tree.

### Test suites

Four Vitest configs, because they need different things. All four plus `chaos`
and `build` must be green before claiming done.

| Command | Config | Covers | Needs |
|---|---|---|---|
| `npm test` | `vitest.config.ts` | fast unit suite — 103 files under `tests/` | nothing (no browser, no socket) |
| `npm run test:browser` | `vitest.browser.config.ts` | `tests/integrations/browser/**` | Chromium (`npm run playwright:install`) |
| `npm run test:hydration` | `vitest.hydration.config.ts` | drives the **built** app under `next start`, runs a real audit, asserts pages hydrated | `npm run build` first, and `npm run build:documents` — two cases drive the Java stages through the app |
| `npm run test:db` | `vitest.db.config.ts` | `postgres-*.test.ts` — the store contract against real Neon | `DATABASE_URL`, `npm run migrate` |
| `npm run test:documents` | `vitest.documents.config.ts` | `java-*.test.ts` — the document stages against a real JVM | JDK 17+, `npm run build:documents` |
| `npm run chaos` | `scripts/chaos.ts` | steady-state assertions | `CHAOS_ENABLED=true` (hard-fails without it) |

Run a single test file or name:

```bash
npx vitest run tests/services/score.test.ts
```

```bash
npx vitest run -t 'rejects findings from incomplete evidence'
```

For the non-default suites pass the config too — e.g.
`npx vitest run --config vitest.browser.config.ts tests/integrations/browser/axe-scan.test.ts`.

The fast suite excludes `tests/integrations/browser/**` and
`postgres-*.test.ts`; that exclusion is what keeps it browser-free and
socket-free, so do not add either back into it.

### Operational scripts

```bash
npm run migrate                          # apply src/integrations/persistence/schema.sql
npm run operator -- add                  # create the first operator account
npm run smoke:real -- --url <site>       # one real audit through a running `next start`
npm run blind:test                       # audit three planted fixture sites, score against their answer keys
npm run prune:artifacts                  # delete evidence past its retention window
```

## Gates before a push

`.githooks/pre-push` runs `localci pre-push`, which executes the **gate** phase
of [`localci.yml`](localci.yml) — `npm run lint && npm run typecheck` — and a
non-zero exit blocks the push. The rest of the suite runs detached afterwards
and reports as a commit status. `localci.yml` deliberately mirrors
`.github/workflows/ci.yml` minus `npm ci`, which would wipe the tree you are
working in.

Lint is first in both because it is the cheapest failure and the only gate that
runs the React Compiler rules — `eslint-config-next` has sixteen `react-hooks/*`
rules at error severity that nothing else in the pipeline can see.

## Architecture

### Layering

`YAGNI → KISS → SRP → DRY`. Framework code at the edges, business rules in the
centre:

- **`src/domain`** — contracts, policy, evidence, platforms. No HTTP or
  framework imports beyond validation libs.
- **`src/services`** — orchestration: rule mapping, scoring, gating, reporting,
  AI advisory, ax-tree pruning. **Must not import Playwright or axe-core** —
  that is what keeps services in the fast unit suite.
- **`src/integrations`** — `browser/` (Playwright, axe, launch),
  `persistence/` (Postgres + memory stores, `schema.sql`), `artifacts/` (Blob),
  `platforms/` (WordPress/React/generic adapters), `documents/` (the Java/PDFBox
  document stages — see its own README).
- **`src/app`** — Next.js App Router only: 20 API routes under `api/`, the
  operator console under `(platform)/` (including `/remediate`, the one-off
  screen over the stateless `api/documents/*` routes — nothing recorded), and
  `r/[token]/` — the single public report surface outside the auth gate.

### How an audit flows

Worth tracing once, because no single file shows it:

1. `POST /api/audit/run` → `services/run-budget` refuses over-quota runs
   **without writing a row**.
2. `integrations/browser/run-browser-audit` → `journey-runner` walks the
   journey, scanning after **every** navigation, not just the last.
3. Per page: `axe-scan` (axe-core, ~105 rules), `ax-tree` pruning, artifacts
   (screenshot + DOM snapshot) to Blob under `runs/<requestId>/<pageKey>/`.
4. `services/deterministic-audit` maps axe's **plain-data** output — this is
   the seam that keeps axe out of services.
5. `services/ai-advisory` makes one model call through the Vercel AI Gateway
   over the **aggregate** (not per page) — `AUDITOR_ADVISORY_MODEL`, default
   `minimax/minimax-m3-free`, `off` to disable; auth is `AI_GATEWAY_API_KEY`
   or the deployment's own `VERCEL_OIDC_TOKEN`. Always `gateable: false`; with
   neither credential, or a free model on an authenticated journey, the run
   simply completes without it.
6. `services/reporting` decides the verdict (`blockingFindings` gates on the
   **WCAG success criterion**, not axe's impact rating), `services/score`
   computes the rate, `services/regression` diffs against the prior run.
7. `services/run-persistence` writes through `RunStore` to Postgres.

Two finding paths exist and must not be merged: deterministic findings gate a
run; advisory findings never do.

**Every surface renders through `services/presentation/verdict.ts`** —
including the client-facing `report-html.ts`. Keying report copy on `ciStatus`
instead once made the client's document disagree with every operator screen.

### Storage

Neon Postgres is required; there is no local fallback store.
`AUDITOR_STORE=memory` is an explicit opt-in for the hydration suite only —
never a fallback for a missing `DATABASE_URL`. The in-memory doubles and
Postgres are held to shared contracts in `tests/support/run-store-contract.ts`
and `platform-store-contract.ts`; **new store behaviour goes in the contract**,
not in one implementation.

## Traps that span several files

- **Adding a route that launches a browser** also means adding it to
  `outputFileTracingIncludes` in `next.config.mjs`. Nothing in the route file
  says so. `tests/deploy/browser-routes-are-packaged.test.ts` is what catches
  it. Likewise, `serverExternalPackages` must keep `axe-core` and
  `@axe-core/playwright` unbundled — axe is injected into the page as a
  *source string*, so bundling it breaks every run made through the app while
  every test stays green.
- **Never import a `scripts/*` entry point from a test.** They call `main()` at
  import. Importing `migrate.ts` for one helper silently migrated the real
  database on every local `npm test`. Extract the pure part.
- **Structured events go through `services/logger`.** Hand-built JSON envelopes
  drift; `tests/services/log-shape.test.ts` greps the tree for them.
- **Browser-suite assertions that read live DOM use `expect.poll`**, not a
  single read. Note Vitest takes `interval:`, Playwright takes `intervals: []`.
- **DB contract tests run against a database holding real rows.** Assert with
  `toContain`, never `toEqual`/`toHaveLength`, and build every identity from
  `CONTRACT_PREFIX` / `PLATFORM_PREFIX` — never a literal, because
  `operators.email` is unique and a literal collides outright.
- **eslint ignores `.claude/**`** because agent worktrees live there, each a
  full checkout with its own `.next`; without it one stale worktree turned 22
  real problems into 38,846.
- **TypeScript is pinned to `^6`.** `typescript-eslint` throws outright on TS 7,
  which kills lint entirely. See the note atop `eslint.config.mjs`.

## `experiments/`

`experiments/document-remediation/` is a **feasibility spike** — Java (PDFBox,
veraPDF) plus Node scripts exploring whether PDFs can be remediated to
PDF/UA deterministically. It deliberately ignores the `domain`/`services`/
`integrations` boundaries, and is outside the production `tsconfig` `include`
and inside `eslint.config.mjs` `ignores`, so it is typechecked and linted by
nothing. That is the trade a spike is allowed to make. **Anything graduating
into `src/` is held to the normal gates.** Findings live in
`docs/research/document-remediation/`; setup is in the spike's own `README.md`.

**Stages graduate by moving, not copying.** `Inspect.java` and `StructText.java`
now live in `src/integrations/documents/java/`, and the spike compiles against
them — `StructText` is shared with `Headings`/`Tables`, and two copies drift.
The spike may depend on `src/`; **`src/` must never resolve a path into
`experiments/`.**

## Environment

[`.env.example`](.env.example) documents every variable with the reasoning
behind it — read it rather than guessing. `docs/env.md` has more.

## Agent behaviour

- Commit only when asked; ask before destructive git operations.
- Do not edit plan files the user attached unless asked.
- Parallelize independent files; serialize shared-contract changes.
