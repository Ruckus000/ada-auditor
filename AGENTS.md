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
- **A check axe could not decide never fails a run.** `incomplete` results map
  to `needs-review` through the same mapper as violations, so they carry a
  conformance level like anything else — and the gate keys on that level. They
  are the human-review queue, and counting them would invert the sentence that
  produces them: "axe could not reach a verdict on these, so they are never a
  failure." They are excluded from the score for the same reason
- Run contracts are enforced for **scope** and **confidence `minReport`**. This bullet
  also claimed `failureMode`, and that was not true: it is written to the contract
  (`run-browser-audit.ts:171`) and read by nothing. Same for `confidencePolicy.minContinue`,
  `recoveryPolicy.*` and `actionPolicy.mode` — all written, none read. Chaos asserts the
  two that are real (`empty_scope_denies_the_journey`, and `minReport` via the advisory
  tests); do not add the others to this list until something reads them
- Forbidden production actions never execute
- A run may only navigate to hosts in `scope.allowedDomains`; an empty scope
  denies everything rather than allowing it
- Credentials are referenced, never inlined — no secret in a request body, a
  stored journey, or a run log
- **There is no tenancy, and that is the design.** One organisation: every
  operator sees every client, and "any authenticated caller can read any run"
  is intended rather than a hole. No table has a tenant column. The dangerous
  version of this is not the design — it is somebody later assuming isolation
  exists, or half-introducing it — so the run-store contract pins that `getRun`
  takes a request id and nothing else. If this changes, it changes in
  `schema.sql` first, and the contract test is where you will notice

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
- Do not claim “done” without fresh `npm test`, `npm run test:browser`, `npm run test:db`, `npm run chaos`, `npm run build` and `npm run test:hydration` evidence
- `npm run typecheck`, not bare `tsc`, and it is a CI gate. `tsconfig.json`
  excludes `tests/integrations/**` so `next build` will not type-check a
  Playwright suite it never bundles — which meant the browser and hydration
  suites were type-checked by nothing, and “tsc clean” in a commit message was
  a claim about a config that could not see the files being changed. Turning it
  on found seven errors already sitting there, five of them `expect.poll` calls
  passing Playwright’s `intervals: [n]` to Vitest, which takes `interval: n`
- A browser-suite assertion that reads live DOM goes through `expect.poll`, not
  a single read. Three have now failed as one-shot reads of something that
  becomes true asynchronously, and each cost a red master and a follow-up PR.
  Polling the *scan* is the fix for an axe race; polling something else in
  front of a single scan only narrows the window
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

## Current status

Implemented and verified locally. What has and has not been exercised in the
deployed environment is recorded under "Known gaps" — in particular, whether
Chromium launches on a Vercel function:

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
  target is checked four ways: scheme and host; every resolved address; the URL
  the page settled on after each navigation; and the address the browser
  actually connected to. The fourth is not redundant — it is the only one that
  closes DNS rebinding, because after a rebind the hostname is unchanged and it
  is the hostname the allowlist was derived from. The check is bound to the
  browser *context*, so a `window.open` popup's navigations are checked too —
  but a popup is never audited, and the run does not report that one opened.
  Subresource requests are not checked at all.
- **Multi-page runs.** `runJourney` scans after every navigation and returns
  `{ pages, truncatedPages }`; each page carries its own axe results, AX tree
  and artifact set under `runs/<requestId>/<pageKey>/`. Findings carry
  `pageUrl`, evidence is per page and the run takes the worst, and pages per
  run are capped (`AUDITOR_MAX_PAGES_PER_RUN`, default 20) with a
  `audit_page_cap_reached` log when the cap truncates a journey. The AI
  advisory runs **once over the aggregate**, not per page — N× cost otherwise,
  and cross-page issues only exist in aggregate.
- Reporting (`pass|fail|inconclusive`), regression comparison keyed on
  rule + page + selector
- **Conformance score**: `passed / (passed + failed)` over the checks axe
  actually evaluated (`services/score.ts`, pure). Undecided checks are in
  neither term — they are the human-review queue — advisory findings never
  touch it, and a run without complete evidence scores `null` rather than
  zero, because the denominator is unknown. Stored with `score_version` so a
  formula change cannot silently reinterpret historical runs. Note a run can
  score well and still fail: the score is a rate and the verdict is not, so one
  unmet success criterion fails a run however many checks passed around it.
- **Conformance gate: the success criterion decides, not axe's impact**
  (`blockingFindings` in `services/reporting.ts`). A run fails when a
  deterministic finding cites a Level **A or AA** criterion. Impact is Deque's
  operational triage — how bad a thing is to hit — and WCAG conformance is
  binary per criterion, so gating on impact crossed two axes and was wrong both
  ways: of axe-core 4.12.1's 105 rules, 30 are best-practice and cite no
  criterion at all, so a `critical` recommendation asserted non-conformance,
  while a real Level AA failure rated `moderate` never did. Colour contrast is
  1.4.3 at Level AA; a page failing it does not conform, whatever the impact
  rating. Three exclusions carry weight — advisory findings (`gateable: false`),
  `needs-review` (a steady-state rule above), and rules citing no criterion.
  AAA is out because AA
  is the bar ADA claims are argued against. Stored with `gate_version`, for the
  reason `score_version` exists; **absent means not recorded**, never
  "version 1", the same stance `intent.ruleset` takes.
  **Expect most real sites to read "does not conform"** — most real sites do
  not conform to WCAG AA. `www.dsrfund.org`, the first real client audited
  (2026-08-21), returned **86 findings and `pass`** under the old gate, none of
  them rated `critical`. Re-audited under this one it returned `fail`, on 83 —
  the totals differ by a few between runs because it is a live site, not
  because the gate changed what was counted.
- **Vocabulary mapping lives in `services/presentation/`**, not beside the
  components: deciding whether the product says `pass` or "we could not tell"
  is a business rule with a steady-state contract behind it. `VerdictKind`
  carries `inconclusive` as a first-class outcome, and severity maps 5→5 —
  folding `needs-review` into a low-priority bucket would delete the
  human-review queue, and folding `advisory` anywhere would contradict
  `gateable: false`.
  **Every surface goes through `runVerdict`, including the client's report.**
  `report-html.ts` keyed its copy on `ciStatus` instead, which holds only
  `pass | fail | inconclusive` and which `risk` cannot reach — so a run with
  unresolved findings read "No blocking issues found" on the document a
  client's counsel reads while every operator screen said `risk`. Two
  definitions of one rule, and the softer one was on the copy that mattered.
- **Triage is keyed on finding identity, per client** (`finding_triage`), never
  on the per-run `findings` row: `saveRun` deletes and reinserts a run's
  children on every write — inside one transaction, so a reader never sees the
  gap — and triage stored there would not survive one run.
  `fixed` is derived from the next run's absence, never stored.
- **Persistence: Neon Postgres** (Vercel Marketplace), schema in
  `src/integrations/persistence/schema.sql`, applied by `npm run migrate`.
  `run_pages` is a first-class table because a run is a journey and a journey
  is several pages. `RunStore` gained `list` — the gap called out in the
  Phase 1 plan — served by `GET /api/audit/runs`. `FileRunStore` and
  `KvRunStore` are deleted, not deprecated; `MemoryRunStore` is a test double
  only, and both stores are held to one shared contract.
- `GET /api/audit/runs`, `runs/latest`, `runs/[requestId]`
- **Readiness distinguishes broken from degraded.** `/api/ready` gates on the
  run token and the run store — `createRunStore()` fails closed without
  `DATABASE_URL`, but only on the first audit, long after the deploy that broke
  it. Anything non-fatal is reported in `warnings` instead, and the console
  renders `needs-store` rather than "cannot reach the service", which would
  send an operator to check the wrong thing.
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

### Phase 2C — where it stopped

Slices 0, 1 and 3 are merged. Slice 2 onward is blocked on one product
decision nobody has made:

**How does a real client get into the system?** The database had one
`client-unassigned` row and whatever journeys runs had materialised, and the
screens read eight invented clients from `data.ts`.

**Answered:** the portfolio starts **empty** and an operator adds clients. The
alternative — seeding the eight fixture clients as real rows — is a faster demo
that puts invented client names in a real database, which is the exact thing
this phase exists to remove. Starting empty also makes the first-run state the
normal state rather than a screen nobody sees until the first real customer.
Slices 2 and 4-6 follow from that.

### Known gaps

Read this before claiming something works.

- **The unlock throttle and the run budget can both be memory-only.** Redis used to be required on
  Vercel because the run store needed it. The run store is Postgres now, so
  nothing forces Upstash to exist, and without it the throttle counts attempts
  in process memory — per-instance, reset on every cold start. No longer
  silent: `/api/ready` reports `unlockThrottleDurable` and warns, and the
  console shows it. It does not gate readiness, because a degraded security
  speed bump is not a reason to serve 503 to every operator. The real defence
  remains a high-entropy token.
- **The catalog tables still have no UI behind them.** `clients`, `journeys`,
  `client_config`, `reports`, `activity_events` and `finding_triage` now have a
  store and a tested contract, and `journeys` materialises on every run — but
  only the screens read or write the rest, and the screens land slice by slice
  through Phase 2C. Until then they are reachable but mostly empty.
- **`data.ts` and `derive.ts` are gone.** Every screen reads the database.
  What that cost is worth knowing: the fixture screens carried features that
  had nothing behind them, and rather than port them they were deleted — the
  report *builder* (audience tabs, section editor, live preview), the ⌘K
  search, notification rules, seats and SSO. Scan schedules and a second user
  are no longer among them: `/api/cron/tick` schedules runs and `operators`
  gives the system named people — see the scheduling and operator entries
  below.
- **`/r/<token>` is the only surface outside the auth gate.** The token is the
  entire access-control story: 32 random bytes, `noindex`, no navigation back
  into the console, and revocation nulls the token so the old URL 404s. A
  report pins a `requestId` and never "the latest" — a link sent to a
  regulator must not change meaning after tonight's run. Triage is
  deliberately not applied to it: publishing a dismissal would leak the note,
  and hiding the finding would make the shared document disagree with the
  audit it reports.
- **Settings is read-only, and that is the design.** These are deploy-time
  environment settings; a form that appeared to change them from a web page
  would be lying about where the truth lives. It marks a degraded run store,
  local-disk evidence, an in-memory throttle and enabled chaos injection.
- **A finding's words are all quoted, none authored.** `title` is axe's own
  sentence for the rule ("Images must have alternate text"), stored in its own
  column; `message` is what went wrong with *this* node;
  `services/wcag-reference.ts` names and levels every WCAG 2.2 A/AA criterion.
  The fix is quoted too: `remediation_any` / `remediation_all` hold axe's
  per-check messages. All of it is checkable against a source — which is why it
  is allowed to exist where the fixture screen's per-finding explanation, code
  fix and effort estimate were deleted. What is still absent is an **effort
  estimate**, and it should stay absent: nothing can measure it, so a number
  there would be a guess an operator would quote to a client.
- **The two fix groups must not be merged.** `remediation_any` is satisfied by
  doing **one** of its entries (`button-name` accepts inner text *or*
  aria-label *or* title); `remediation_all` has to be done in full. A screen
  that flattened them would ask for three fixes where one is the fix, and a
  list that overstates the work stops being read. `none` checks join
  `remediation_all`, matching how axe's own summary presents them.
- **Neither `title` nor the fix lists are backfilled, and should not be.**
  axe's wording changes between releases, so writing today's sentence onto last
  month's audit would put words in the mouth of a run that never said them.
  Older runs render their rule code and fall back to the failure summary; the
  store contract has a test that absent comes back absent, because `[]` (the
  engine had nothing to add) and missing (we never asked) are different facts.
- **The reference table is A and AA only.** This product audits to AA, so
  naming a AAA criterion would imply a claim it does not make. An unknown
  number renders as the bare number — a wrong criterion name in an audit report
  is worse than an unfamiliar one, because the number is checkable.
- **Triage can assign, now that there is somebody to assign to.** The control
  appears only when operator accounts exist, and the route refuses an assignee
  who does not exist or is disabled — a dangling assignee reads as handled by
  nobody. `assignee` keeps the name, `assignee_operator_id` the account, the
  same split as `activity_events`.
  Coverage gap: the hydration suite runs on the memory store with no accounts,
  so the zero-violation axe pass never renders this control.
- **A dismissal is free text, not a taxonomy.** The prototype offered five
  canned reasons ("handled elsewhere", "accepted risk, signed off"). Nobody has
  agreed to that vocabulary, and a wrong one becomes the record an auditor
  defends later, so the note stays free text until somebody has.
- **Run evidence can be read back.** `GET /api/audit/runs/<id>/artifacts/
  <position>/<kind>` streams it to an authenticated caller. The URL is read
  from the run record, never from the caller — `addRandomSuffix` means the
  stored URL is the only handle, which is also why there is no request-forgery
  surface. Streamed rather than redirected, because a redirect hands out a
  handle that outlives the session. DOM snapshots are served `attachment` +
  `nosniff` + sandbox: inline from our origin, a client's captured markup would
  execute there. Pruned evidence answers **410**, not 404, and
  `prune:artifacts` now clears the database pointers after deleting the bytes.
  Deliberately **not** linked from `/r/<token>`; the hydration suite asserts it.
- **Run evidence is written to a private Blob store.** Screenshots and DOM
  snapshots of a client's *authenticated* pages hold whatever real end-user
  data was on screen, and their URLs are stored in the database and travel
  through logs — so `access: 'public'` would make the URL itself the only
  protection. `blob-store.ts` uploads with `access: 'private'` and a test
  asserts it. Reading evidence back therefore needs an authenticated fetch,
  which `findings-list.tsx` does — it links each artifact through
  `/api/audit/runs/<id>/artifacts/<position>/<kind>`, a route that reads the
  blob URL from the run record and never from the caller.
- **`client-unassigned` is a foreign-key anchor, not a client.** `saveRun`
  materialises a journey for any `journeyId` it has never seen, and
  `journeys.client_id` is a foreign key, so the row has to exist. It is left
  out of `listClients()` in both stores — it was appearing on the portfolio as
  a client called "Unassigned" that nobody had added, on a screen whose whole
  premise is that it starts empty. `getClient()` still resolves it, so
  `/clients/client-unassigned` stays reachable for an operator who knows the
  id: hidden from the catalog, not from the product. The store contract tests
  both halves; do not "fix" one without the other.
- **A run not attached to a client is still visible, just not in the
  portfolio.** `/console` and `/api/audit/runs` report it. Registering the
  journey against a client first (`POST /api/platform/clients/<id>/journeys`)
  is what puts a run on a client's screens.
- **A page cap of 20, with one measurement behind it.** Runs record
  `started_at` and `phase_ms`; every page records `duration_ms` and `scan_ms`;
  `audit_run_log` carries `pagesAudited`, `slowestPageMs` and `headroomMs`
  (what was left of the 300s budget). `npm run smoke:real -- --url <site>`
  against a running `next start` prints all of it and suggests a cap.
  A four-page run of the W3C BAD demo through the deployed function
  (`d62f13f4-4a33-4f14-b592-4b243c4f3e62`, 2026-08-15) took 23.0s: journey
  20.5s, upload 1.5s, slowest page 4.0s of which 2.9s was the axe scan. Twenty
  such pages is about 80s.
  **That is a floor, not a budget.** Four small static documents with no
  framework, no login and nothing deferred are the easy case; a real client app
  renders more and waits longer, and no run against one has happened. Re-decide
  the cap from `slowestPageMs` on a client run, not from this one. `smoke:real`
  still cannot be driven from a sandbox with allowlisted egress, and it cannot
  be pointed at localhost — the SSRF guard correctly refuses loopback and
  private addresses.
- **The unit suites still do not exercise the app's own bundle — but the
  hydration suite does.** Vitest loads modules unbundled, so a packaging fault
  is invisible to it; that is how `@axe-core/playwright` shipped with its
  injected source mangled while every suite stayed green. `npm run
  test:hydration` now closes that: it drives the built app under `next start`
  and runs a real audit through `POST /api/audit/run`, asserting the findings
  render. A bundler fault that breaks axe injection fails there.
  What it does **not** cover is a real third-party site — see the page cap
  above. Run `npm run smoke:real` before claiming a change works against one.

- **A run still cannot outlive one function invocation.** `maxDuration` is 300s
  (the Hobby ceiling; Pro allows 800s). The 202 + poll shape unblocks the caller
  but does not add compute — background work is bounded by the same limit. A
  real site-wide crawl needs a container worker, not a bigger number here.
- **The console still blocks.** It calls `?wait=1`, because its run flow renders
  a result rather than polling. The async shape is there for API and CI callers.
- **Named operators, one organisation.** People sign in with an email and a
  password (`operators`, scrypt from `node:crypto`); the session cookie carries
  the operator id and a `session_epoch`, so bumping the epoch revokes one
  person's sessions and nobody else's. `AUDITOR_RUN_TOKEN` survives as a
  *machine* credential — CI, scripts, the scheduler, and the way in before the
  first account exists (`npm run operator -- add`). Set `AUDITOR_SESSION_SECRET`
  separately, or rotating the machine token still signs every human out;
  `/api/ready` warns while they are the same value.
  There is still **no tenancy**, and that is the design: one organisation, every
  operator sees every client, so "any authenticated caller can read any run" is
  intended rather than a hole. No table has a tenant column. If that changes, it
  changes in `schema.sql` first.
  **At cutover, rotate `AUDITOR_RUN_TOKEN`.** If operators still know it,
  disabling an operator revokes nothing.
- **A run starts from the client's journeys screen.** `POST /api/platform/
  clients/<id>/journeys/<id>/runs` walks the stored journey. It requires a
  `targetUrl` even though `/api/audit/run` does not: without one the runner
  resolves every `goto` against the fixture directory over `file://`, which
  through this route would file a green audit of our own demo pages under a
  real client's name. Recording a journey is still console and API work.
- **Journeys re-run on a schedule.** `off | daily | weekly` plus a UTC hour on
  the journey, an hourly Vercel Cron at `/api/cron/tick`. The tick claims due
  journeys in one `update … returning` — one statement, so two overlapping
  ticks cannot both claim the same journey — and
  *dispatches* each to `/api/audit/run` so every run gets its own invocation —
  it never audits anything itself. Needs `CRON_SECRET`; without it the tick
  refuses everything and `/api/ready` says so.
- **Runs are capped.** `AUDITOR_MAX_RUNS_PER_HOUR` / `_PER_DAY`, global rather
  than per-operator because the bill is shared, enforced inside `startRun` so
  every caller inherits it. It **fails open**: a cost control that becomes an
  outage has made things worse.
- **A run refused before it is recorded is invisible to everything.** Not just
  to a screen — to every query there is. `run_budget_exceeded` deliberately
  leaves no row (`audit-run-handler.ts`: "a refused run must leave no row
  behind, because it never started... nothing failed, the run was declined"),
  and when `/api/cron/tick` cannot dispatch — a 429, a 400, a network error —
  it calls `releaseClaim` and writes nothing either. So a client's scheduled
  audit can fail to happen with no run record, no activity event, nothing on
  the journey row, and nothing for `.github/workflows/failed-runs.yml` to find.
  That workflow covers runs that **executed** and failed, plus runs reconciled
  to `run_timed_out`, and says so rather than implying more.
  Recorded here rather than fixed because the fix is a decision, not a patch:
  a row for a run that never started needs an answer for what it means to
  regression baselines, to the score, and to the portfolio's newest-run-per-
  journey read. Do not add one without that answer.

## Agent behavior

- Do not invent Netflix process that isn’t grounded in these rules
- Prefer multitask/parallel agents for independent files/phases; serialize shared contract changes
- Do not edit plan files the user attached unless asked
- Ask before destructive git operations; commit only when asked (unless the user explicitly requests committing as part of the phase)
