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
- Every identity a contract writes is built from `CONTRACT_PREFIX` or
  `PLATFORM_PREFIX`, never a literal — ids *and* emails, because
  `operators.email` is unique and a shared literal collides outright. The
  prefixes are random per process, so runs sharing one `DATABASE_URL` cannot
  see each other; a literal reintroduces the failure that reddened master over
  a documentation-only diff. Cleanup lives in `tests/support/contract-cleanup.ts`
  and `postgres-contract-isolation.test.ts` is what keeps it confined
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
- **Second opinion: HTML_CodeSniffer (WCAG2AA) over the same live page.**
  Injected beside axe (`integrations/browser/htmlcs-scan.ts`, main frame only,
  bounded by `AUDITOR_HTMLCS_TIMEOUT_MS`), mapped by `services/htmlcs-audit.ts`
  under the same seam rule. **Everything it emits is `needs-review`** — codes
  prefixed `htmlcs:`, never gating, never in the score — so its technique-level
  coverage widens the human-review queue without moving any verdict. Where axe
  already reported the same element and criterion the echo is dropped, by
  element identity resolved in the page (selector strings differ between
  engines); notices collapse to one counted finding per technique per page. A
  failed or timed-out scan degrades to "no second opinion"
  (`htmlcs_scan_unavailable`), never to degraded evidence. Named in
  `RUN_RULESET`, so the first run after this change diffs as an instrument
  change rather than a site regression.
- **AI advisory: a real model call through the Vercel AI Gateway**, with forced
  tool use, over the pruned accessibility tree plus axe's undecided checks.
  Judges what rules cannot — alt text that says nothing, headings used for
  size, error text that does not say what to fix. Always `gateable: false`.
  The model is a `provider/model` string (`AUDITOR_ADVISORY_MODEL`, default
  `minimax/minimax-m3-free`), not a vendor SDK, so changing model is
  configuration rather than a rewrite. Auth is the gateway's:
  `AI_GATEWAY_API_KEY` if set, otherwise the `VERCEL_OIDC_TOKEN` a deployment
  mints for itself — so a deployed run needs no key at all. No way to reach the
  gateway, an expired token, a gateway error, a refusal, or a tool call that
  does not match the schema all degrade to *no advisory*, never to a failed run.
  The response is validated with zod rather than trusted: the previous
  implementation relied on one vendor's `strict` tool mode, and the gateway
  routes to models that do not all honour it.
  **The default model is free and that has a boundary.** Free gateway models
  advertise neither zero data retention nor a no-training guarantee, and this
  pass sends the accessibility tree of every page a journey walked. On a public
  site that is public text; on an authenticated client app it is whatever real
  end-user data was on screen — the same reasoning that put run evidence in a
  private blob store. Point `AUDITOR_ADVISORY_MODEL` at a model with a
  data-handling guarantee before running the advisory behind a login — or at
  **`off`**, which disables the pass outright. The off switch exists because
  the gateway's auth is ambient on Vercel (the deployment's own OIDC token), so
  after #103 unsetting keys stopped being a way to say no, and the pass would
  otherwise run on every production audit with whatever the default model is.
  `off` wins over everything, including the injected test seam: it is a
  statement about where evidence may go, and a test double is still a place.
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
  **What a real site actually returns, measured rather than expected.** This
  bullet used to say `www.dsrfund.org` was audited on 2026-08-21, returned 86
  findings and `pass` under the old gate, and `fail` on 83 under this one. That
  claim has no run behind it: there is **no dsrfund run in the database** — not
  under any request id, and no `run_pages` row on that host — and the newest run
  at the time of writing predated the cited date by six days. It did not
  reproduce either. Corrected rather than deleted, because the number was used
  to justify `gate_version` 2 and somebody will otherwise cite it again.
  The reproducible measurement is `dbc70bff-d036-409f-ad17-497f472ded77`
  (2026-08-26), a fixed twelve-page set on the same site — `/`, `/governance`,
  `/white-paper`, `/research`, `/resources`, `/about`, `/team`, `/contact`,
  `/press`, `/privacy`, `/terms`, `/solutions`, chosen so it can be run again
  and compared. Complete evidence, no truncation. It returned **`pass`, score
  99, 97 findings — and zero gating findings.**
  The shape of those 97 is the part worth knowing, because it is not what
  "expect most real sites to fail" predicts. Eighty-eight are `needs-review`:
  54 citing 1.4.3 at AA and 34 citing 1.4.1 at A, almost all colour contrast
  axe could not resolve against the backgrounds behind it. Nine are real
  violations and every one cites **no criterion at all** — best-practice rules,
  which this gate deliberately excludes. So the run conforms on the automated
  evidence not because the site is clean but because **the checks that would
  have decided it came back undecided**, and an undecided check never fails a
  run (a steady-state rule above).
  Read that as a limit on what a deterministic gate can claim on a real site,
  not as a clean bill of health: the human-review queue is where this site's
  conformance question actually lives, and it is 88 items long. A verdict of
  `pass` with a large `needs-review` count is the normal shape of a real audit,
  and the report should never be read as "no barriers".
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

### Phase 2C — complete

**Every screen in the 2C table is merged against real data, and the phase's
own definition of done — `data.ts` deleted wholesale — is met** (the known-gaps
entry below records what that deletion cost). The onboarding wizard
(`docs/superpowers/plans/2026-08-19-onboarding-wizard.md`) closed the last
slices, and the hydration suite walks the whole chain through screens against
the built app: empty portfolio → add the first client → setup wizard →
discovery → journey from ticked pages → first run → findings and triage →
issue a shareable report → read it anonymously → revoke it.

The product decision that unblocked it, kept for the record: **the portfolio
starts empty and an operator adds clients.** The alternative — seeding the
eight fixture clients as real rows — was a faster demo that put invented
client names in a real database, the exact thing this phase existed to remove.
Starting empty also made the first-run state the normal state rather than a
screen nobody sees until the first real customer.

Not yet done anywhere: the same walk on **production** by a signed-in
operator. The suites prove the screens against `next start`; a production
click-through requires the operator credential and is a person's action.

### Known gaps

Read this before claiming something works.

- **The 120-document remediation test is run and scored**
  (`docs/research/document-remediation/remediation-test-2026-08-27-results.md`,
  predictions pre-registered). The sentence that matters: **conversion
  delivers and its claims survive audit; repair produces conformance whose
  claims do not.** Arm A: 31/31 real municipal Word documents delivered
  (legacy .doc included), 13/31 green on both instruments, gap order exactly
  as predicted, zero invented claims after the import-language fix the test
  itself caught (#140). Arm B (the PDF-repair STOP, deliberately reopened):
  real 2/31 conformance-deliverable — inside the registered 0–2 band — and on
  the generated half 23/28 "green" collapses to 2/28 semantically true, with
  62 false assertions across 20 documents. The STOP stands, strengthened:
  conformance and truth are different properties, and only the second is
  remediation.

- **The remediation-gaps campaign re-scored the same corpora** (dated
  follow-up in the same results doc, predictions re-registered first):
  real corpus 13 → **23/31 green on both instruments**, zero invented
  claims, heading fidelity 31/31 — the original heading-loss and list-count
  opens are closed (empty headings were the whole loss; lists are compared
  as items). The eight non-green documents are the product working, not
  failing: five need a heading-level decision and three need a
  human-written figure description, and every one carries its punch-list
  item (`needs` on the summary, INSTRUMENT_VERSION 3). The campaign's
  registered ≥ 26/31 bar was **missed** — those eight cannot go green
  without inventing content — and the promise (conformant on both
  instruments, or a per-item human punch list; never a silent gap, never an
  invented claim) holds 31/31 real. PDFs whose Word source shares a stem in
  the same inventory are paired at read time (#149): the offered remediation
  is converting the source, never repairing the PDF. Known instrument
  vocabulary gap, deliberately unchased: UA-1 7.21.7 glyph-to-Unicode
  (emoji embedding) fails one *generated* stratum silently; zero real
  documents hit it.

- **PDFs are repaired by transcription, or refused — never tagged by
  inference.** `services/document-repair.ts` decides; `Finish` writes; the
  result is read back and `contentChanges` must be empty or the repair is
  discarded. `[V]` Twenty real municipal PDFs through the shipping path
  (`pdf-repair-2026-08-28-results.md`): 11 repaired, 9 refused as untagged,
  32 failing UA-1 clauses removed, **1 fully green**. Read that last number
  before claiming anything — repair removes about three clauses per document
  and names the rest; it does not make municipal PDFs conformant. What
  remains is human work (figure descriptions), the producer's (fonts never
  embedded), or structural (untagged page content — inferring it is what the
  Arm B STOP forbids). One document gained a clause because fixing its links
  surfaced a latent language failure; it is recorded rather than hidden, and
  its root cause is already the document's reported 3.1.1 gap.
  Open follow-up: "declare the document's language" is a gap string but not
  yet a punch-list item, and one missing language blocked three clauses.

- **Rule-shaped audit gaps: measured, then closed, then re-measured.**
  The 2026-08-27 milestone run
  (`docs/research/blind-test/2026-08-27-rule-gaps-closed.md`): barriers seen
  went 19→26 of 37 across the three planted sites, the deterministic core
  14→18 of 30, with all seven `clean` rows still quiet and zero false
  positives. Three custom checks did it (`services/page-checks.ts`, facts
  collected in `integrations/browser/page-facts.ts` across the same
  plain-data seam axe crosses) — after measuring that enabling axe's nearest
  experimental rules produced zero output on their exact target defects.
  Every surface now renders the score as **Checks passed** with its
  denominator in words, subordinated to the verdict
  (`services/presentation/verdict.ts`; `tests/app/score-copy.test.ts` keeps
  it so). Still open there: C5 (ARIA widget state), and the judgement half
  floats with the advisory's measured variance.
- **Three planted sites now say what the audit misses, in numbers.**
  `npm run blind:test` walks `fixtures/blind-test/` — a dentist's brochure, a
  township, a SaaS signup, four pages each — carrying 44 barriers and correct
  implementations recorded in an answer key written *before* the first run,
  from the WCAG criterion rather than from axe's rule list. The 2026-08-26 run
  (`docs/research/blind-test/2026-08-26-three-fixture-sites.md`): all three
  sites `fail`, 16 of 19 predicted violations reported and 14 of those by the
  predicted rule, both planted undecided cases in the human-review queue, two
  real barriers nobody planted, and **zero false positives across seven correct
  implementations** — that last is the number the seven `clean` rows exist to
  produce, and the guard on any future decision to enable a noisier rule.
  What it missed is the part to read: a field labelled only by its placeholder
  counts as a pass (axe accepts placeholder as an accessible name, while
  `label-title-only` catches the tooltip case — the product inherits that
  asymmetry silently); `<div onclick>` navigation is invisible on both sites
  that use it, because `focus-order-semantics` ships disabled; a broken skip
  link surfaced only as `region`, so the report names content outside landmarks
  and not the broken bypass; 2.5.3 is unchecked for inputs, whose label is
  external to them; and a video with no captions is `incomplete`, so a Level A
  1.2.2 barrier cannot gate — correct under the undecided-never-fails rule, and
  worth saying out loud for a client publishing recordings.
  **Fourteen of the 44 need reading comprehension**, which is the advisory's
  half, and the advisory did not run — no gateway credential and no egress on
  the machine that ran it — so those are unanswered, not answered wrongly. The
  sites exist so that one run with a credential produces a comparable
  scorecard. Every site also scored 97-98 while failing: correct by the
  score's own definition, and still the number a client quotes back.

- **The AI advisory has run — once, locally, and it is a sample rather than a
  measurement.** First execution 2026-08-27, over the three blind-test sites
  (`docs/research/blind-test/2026-08-27-advisory-first-run.md`): barriers seen
  went 19→24 of 37, the judgement class went 1→6 of 14, **zero false positives
  across all seven `clean` rows held under a live model**, verdicts and scores
  were unchanged because advisory findings cannot gate, and the walk-budget
  advisory reserve got its first measurement — 6.6–8.8s per four-page site
  against the 60s line. The default model honoured the findings tool on every
  call that was made.
  Read before quoting any advisory number: **the free model is high-variance**
  — 9, 0 and 5 findings reported on three runs over identical evidence — so a
  single run's advisory count is a sample with wide error bars, and the
  scorer's cue-based matcher under-credits prose that describes an element by
  its labels rather than its id. What it catches is text quality (useless alt,
  purposeless links, unhelpful errors, undeclared language); what it misses is
  structure (`<div onclick>`, table headers, placeholder-only labels), so the
  remaining blind-test misses are rule-shaped and a stronger model is not the
  answer to them.
  Still unproven: the pass on a **deployed** function — no run in the
  production database has exercised it, `phaseMs.advisory` is still `0` on
  every stored run — and the free model carries no data-retention guarantee,
  so `AUDITOR_ADVISORY_MODEL` must be repointed or set `off` before any
  authenticated journey runs it. The twelve-page dsrfund baseline left 88
  checks the rules could not decide, which is exactly the queue this pass
  exists to work — the first production advisory run should be over that same
  fixed page set, where there is something specific to compare against.
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
- **A dismissal is free text, and now it says which kind of dismissal.** The
  prototype offered five canned reasons ("handled elsewhere", "accepted risk,
  signed off"). That vocabulary is still not adopted and should not be:
  "handled elsewhere" is a claim about a system nobody audited, and a wrong
  reason becomes the record an auditor defends later. **The note stays free
  text, and stays required.** What changed is the *state*. `accepted-risk` had
  been in `TriageState`, the route's enum, the SQL CHECK and
  `findingDisplayStatus` since Phase 2C with no control able to produce it — a
  state reachable everywhere except the product — so three consumers branched
  two ways over a three-member union and an accepted barrier both rendered and
  logged as "dismissed". The distinction it records is the one WCAG already
  forces rather than one invented for a dropdown: conformance is binary per
  criterion, so *this is not a barrier* (`dismissed`) and *this is a barrier
  the client accepts* (`accepted-risk`) are different facts, and only the first
  is a claim about the page. The note asks a different question of each —
  "Why is this not a barrier?" against an accepted risk produces a note that
  contradicts the state stored beside it — and that wording lives in
  `services/presentation/triage.ts`, while the activity feed's wording stays in
  the route, because an append-only audit record must not be re-worded by a UI
  copy edit. Every mapping over `TriageState` is now a `Record`, never a
  ternary, so the next member fails the build instead of quietly reusing
  "dismissed". An accepted risk is still counted, still shown, still in the
  shared report, and still cannot move a verdict — `buildSharedReport`'s deps
  are a `Pick` that excludes the triage store, so that is the compiler's
  guarantee and not a discipline. No schema change: `accepted-risk` was always
  inside the CHECK.
  Still absent, deliberately: **an expiry on an accepted risk.** Reviewing an
  acceptance annually is good practice, but it needs a column, a scheduler
  decision, and an answer for what an expired acceptance does to the verdict —
  a decision, not a patch.
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
- **Two bounds on a walk: 20 pages and 180 seconds.** A count cap cannot bound
  a duration, and until recently nothing bounded the duration at all — the walk
  had no clock, and `MAX_RUN_DURATION_MS` said so itself ("a run is not stopped
  at this number — the platform stops it, and rather more abruptly"). So a slow
  real site had its invocation killed mid-flight and was reconciled to
  `run_timed_out` up to six minutes later by the cron sweep, **with no evidence
  and no findings**. A truncated run is a real audit of what it saw; a killed
  run is nothing, and tuning the cap only changed which one you got by luck.
  The walk now carries a wall clock — `AUDITOR_WALK_BUDGET_MS`, default 180s:
  the 300s `maxDuration` less a 120s reserve for the advisory call, the
  evidence upload, persistence and the one page that may still be in flight
  when the deadline passes. The reserve is the named constant and the budget is
  derived from it, so raising `maxDuration` does not silently re-plan what
  happens after the walk. The two bounds stop different things, exactly as they
  do in link discovery (`DISCOVERY_BUDGET_MS`): the budget stops a slow site,
  the cap stops a fast one with a long journey, and the cap is asked first when
  both are spent.
  Truncation now says which (`truncationReason`, `'page-cap' | 'budget'`,
  stored on the run; absent means not recorded, never "page cap"). Two log
  event names, not one with a reason field: `audit_page_cap_reached` already
  means "raise the cap" to anything watching, and a time truncation reported
  under it sends an operator to change a number that was not the problem.
  `audit_time_budget_reached` means the journey needs a container worker.
  **The walk always audits at least one page**, whatever the clock says — a run
  that captures nothing is the evidence-free outcome the budget exists to
  remove, and a cold `@sparticuz/chromium` launch can spend the budget before a
  page is ever opened. The budget bounds when new work *starts*, not when
  in-flight work finishes; Playwright's per-step timeouts are deliberately not
  clamped to it, because a wait that hits the deadline should truncate the walk
  rather than fail the run naming a selector that was fine. Keep
  `AUDITOR_WALK_BUDGET_MS` comfortably above `AUDITOR_EXPECT_TIMEOUT_MS`.
  **None of this changes a verdict.** A truncated run is evidence per page, the
  run takes the worst, the gate unchanged; it just stops claiming to be the
  whole journey. `browser_time_budget_truncates` pins that, with the violations
  page walked first so truncation cannot hide a finding.
  **The cap is still 20, and still has one measurement behind it.** A four-page
  run of the W3C BAD demo through the deployed function
  (`d62f13f4-4a33-4f14-b592-4b243c4f3e62`, 2026-08-15) took 23.0s: journey
  20.5s, upload 1.5s, slowest page 4.0s of which 2.9s was the axe scan. That is
  a floor, not a budget — four small static documents with no framework, no
  login and nothing deferred are the easy case, and no run against a real
  **authenticated** client app has happened. Re-decide the cap from
  `slowestPageMs` on such a run.
  A second, larger measurement now exists and it is a real third-party site,
  though still an unauthenticated one:
  `dbc70bff-d036-409f-ad17-497f472ded77` (2026-08-26), twelve pages of
  `www.dsrfund.org` in 17.6s — journey 10.1s, upload 7.1s, slowest page 1.16s.
  Upload is the phase that scales with pages, at roughly 0.6s each, so the 25s
  the reserve allows it covers twenty pages about twice over. **The advisory
  line of the reserve is still unmeasured at zero**, because the advisory has
  never run — see the advisory gap below. Twelve pages
  used 17.6s of a 300s ceiling, so neither bound came close to binding here;
  that is a fact about a marketing site, and says nothing yet about an app that
  signs a user in and renders behind it. The budget is what makes it safe to wait for that run rather than guess
  now, and `smoke-real.yml` now keeps its numbers (a job summary and an
  uploaded `smoke-real.json`) instead of losing them to log retention, so
  several client sites can be compared when the time comes. The 120s reserve is
  one-third measurement and two-thirds judgement — the advisory line especially,
  where the only observed number is 1.0s from a pass that had nothing to say —
  and it is falsifiable from `phaseMs.advisory`, which is now recorded on the
  failure path too. Revisit it with the cap, from the same evidence.
  `smoke:real` still cannot be driven from a sandbox with allowlisted egress,
  and still cannot be pointed at localhost — the SSRF guard correctly refuses
  loopback and private addresses, and nothing here weakens it.
  `phase_ms` is written on both paths and **read by nothing**. Kept because the
  dataset gets read by hand when the cap is re-decided, and `run_pages.
  duration_ms` does not say where the non-page time went. Said out loud rather
  than left to imply it is live.
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
- **A run refused before it is recorded still leaves no row — and the
  scheduler now says so anyway.** `run_budget_exceeded` leaves no run record
  and should not (`audit-run-handler.ts`: "a refused run must leave no row
  behind, because it never started... nothing failed, the run was declined").
  That stands, and the reason it stands is the answer the old version of this
  bullet asked for: `getLatestRun` has no status filter, and four "latest run"
  reads are deliberately unfiltered (`portfolio.ts`, `client-detail.ts`,
  `findings-view.ts`, `report-view.ts`), so a synthetic row would become the
  last run on every screen and the next run's regression baseline, forcing
  `incomparable` through `walkedTheSamePath`. **A run that never started is not
  a run.**
  What was actually being lost was the *scheduler's* knowledge, not a row.
  `/api/cron/tick` is the only unattended caller — every other one receives the
  429 and can act on it — and when it could not dispatch it called
  `releaseClaim` and discarded the outcome. It now writes one activity event,
  `SCHEDULED_RUN_NOT_STARTED` ("could not start a scheduled run"), attributed
  to `Scheduler` with the journey name as subject and
  `{ journeyId, status?, code }` as metadata, beside the event it already wrote
  on success. One action string rather than one per cause: the feed renders it
  as a sentence and one unattended reader queries it exactly, so the cause is
  data. This does not contradict "a run is deliberately not an activity event"
  (`services/activity-view.ts`) — that rule exists because two records of one
  run can disagree, and a run that never started has no row to disagree with.
  **Nothing from the dispatch response reaches a log line or a jsonb column
  verbatim**: `code` is accepted only as a short snake_case token, so a
  platform error page, an echoed credential, or a newline forging a second log
  line cannot get through. The write is best-effort like `releaseClaim` — a
  record of what happened must not cost the journeys that did start.
  `GET /api/platform/activity` reads it back (`authorizePrincipal`, zod at the
  boundary, exact `action`, `since`, clamped `limit`, no tenancy scoping
  because there is none), and `.github/workflows/failed-runs.yml` asks it a
  second question every morning. **What that workflow publishes is a count per
  cause and nothing else** — an activity event carries the client id and the
  journey's name, and this repository is public; the Activity screen has both.
  Fixed in passing, because it was found here: the success-path `recordEvent`
  sat inside the dispatch `try`, so a store hiccup after a dispatch that landed
  marked a started run as failed *and released the claim on a run that was in
  flight*.
  **Still deliberately invisible:** a direct API caller's budget refusal, which
  leaves no row and no event because the caller was told; and a tick that never
  authorized at all, which `/api/ready`'s `cron_secret_not_configured` warning
  covers instead. The workflow still never reports "all is well", only what it
  actually checked.

- **Client credentials can now be stored per client, encrypted, write-only.**
  `client_credentials` holds AES-256-GCM ciphertext under
  `AUDITOR_CREDENTIAL_KEY` (`credential-cipher.ts`; the cipher lives inside
  `PostgresPlatformStore`, so the shared contract sees plaintext-in/out and the
  memory double needs no key). The journey editor's credential mode writes it
  (`PUT /api/platform/clients/<id>/credentials/<ref>`) and reads back
  *presence only* — no endpoint ever returns a value, and activity events
  carry the ref alone. Runs resolve store-first with the
  `AUDIT_CREDENTIAL_<REF>_<FIELD>` env vars as the untouched fallback
  (`resolveCredentialFrom`), so every pre-store journey and deployment keeps
  working; without the key the write API answers 503 and the fallback carries
  everything. Losing the key means re-entering credentials — designed
  recovery, no export.

## Agent behavior

- Do not invent Netflix process that isn’t grounded in these rules
- Prefer multitask/parallel agents for independent files/phases; serialize shared contract changes
- Do not edit plan files the user attached unless asked
- Ask before destructive git operations; commit only when asked (unless the user explicitly requests committing as part of the phase)
