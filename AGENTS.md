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
- `npm run typecheck`, not bare `tsc`, and it is a CI gate. It runs
  `next typegen` first because `next-env.d.ts` is generated and gitignored and
  the gate runs before anything builds — see `CLAUDE.md`. `tsconfig.json`
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
  **The queue it widens is now reported, and it had not been.** Every summary
  counted `must fix` and `should fix` and stopped, and the only nearby number —
  `checksNeedingReview` — is `sum(pages, 'incomplete')`, axe's undecided
  *checks*, to which this engine contributes nothing. `[V]` The 2026-08-28
  blind-test run printed `2 undecided` beside **130** needs-review findings of
  139 (124 of 142, 123 of 135 on the other two sites): the queue understated
  sixty-five-fold on the line an operator reads first, and absent entirely from
  the client's shared report. `executiveSummary.needsReviewFindings` counts the
  findings, `checksNeedingReview` keeps counting the checks, and
  `presentation/severity.ts` owns the one `severityCounts` both screens use —
  the portfolio and the client detail each held their own copy of that filter,
  and the second is what the shared report renders.
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
- **Documents: Word converted, PDFs repaired by transcription.** The half of
  the product that hands back a fixed file rather than a report. A `.docx`,
  `.doc` or PDF reaches it from an upload, a URL, or the client's inventory
  screen; LibreOffice and a JVM ship beside the function
  (`scripts/prepare-libreoffice.ts`, `prepare-jvm.ts`), so this runs on
  production and not only on a laptop.
  - **Conversion** (`integrations/documents/convert.ts`) produces a tagged
    PDF, correcting the exporter's language claim and deriving a title the
    source already carries — its metadata, its first heading, or the filename
    its author saved it under.
  - **Repair** (`services/document-repair.ts`) writes back what a PDF already
    states — title, declared language, its links' own destinations — and
    **refuses an untagged PDF** rather than inferring structure. Delivery is
    gated on reading the result back: `contentChanges` must be empty or the
    repair is discarded.
  - **Neither invents.** Every provenance kind is a transcription, VLM alt
    text is banned, `/Lang` has no default, and what cannot be transcribed
    becomes a **punch-list item** on the summary — the per-document work a
    person still has to do, rendered on the operator screen and the client's
    shared report alike.
  - A PDF whose Word source sits in the same inventory is **paired** at read
    time (`services/document-pairing.ts`): converting that source is offered
    ahead of repairing the PDF, because it reaches structure repair never can.
  - What this does and does not achieve is measured, not asserted — see the
    known-gaps entry and `docs/research/document-remediation/`.

- **Two ways for a person to sign in, one session.** A password, or a
  **passkey** (WebAuthn) — both mint the identical v2 operator cookie through
  `createOperatorSessionValue`, so `resolvePrincipal`, the screen guards and
  `operator -- revoke-sessions` are unchanged by the second method existing.
  Passkeys are discoverable credentials: no email is typed, and the sign-in
  challenge endpoint does no lookup at all, so unlike the password path it has
  no enumeration surface. Registering one **re-verifies the password** even
  though the operator is already signed in — a credential outlives the session
  that made it, so a stolen cookie must not become access `revoke-sessions`
  cannot reach. Off unless `AUDITOR_RP_ID` and `AUDITOR_RP_ORIGIN` are set,
  which is correct for local and preview work; passwords stay a full peer and
  remain the recovery route when every device is lost. Ceremony verification
  is `@simplewebauthn` behind `integrations/webauthn/`, and the clone-detection
  counter rule is the library's alone — a synced passkey reports zero forever,
  a device that counted and then reports zero is a clone, and one security
  rule with two homes drifts.
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

- **`7.21.4` is a FAMILY, and its two members say opposite things.**
  `7.21.4.1` is a font with NO data — the fix is the source. `7.21.4.2` is an
  EMBEDDED font whose CIDSet does not list every character used. Matching the
  prefix printed the never-embedded sentence for both, so a CIDSet failure
  would tell a client their fonts are missing and send them to re-export a
  source to fix a problem they do not have. Both now get their own sentence,
  and an unrecognised member of the family is voiced by id rather than
  inheriting either.

  **It is latent, and a first write-up of this got it wrong.** Thirteen
  documents fail only `7.21.4.2-2` *in the answer keys*, and I reported that
  all thirteen had been told the wrong thing — a source-side number asserted as
  a delivery-side consequence, the same mistake as the outline-level
  retraction. `[V]` Of 52 delivered documents carrying a `7.21.4` clause, **all
  52 carry `7.21.4.1-1` and none carries `7.21.4.2`**: `stripCidSets` removes
  the CIDSet before delivery, so the keys record what the SOURCE failed and the
  clause is gone by the time a client sees the file. The path that reaches it
  is a font `stripCidSets` cannot read, which has not happened in 148
  documents. **Read the delivered summaries, never the keys, before saying what
  a client was told.**

  **The criterion label stays `PDF/UA 7.21.4` for all three** — `score.ts`
  accounts for the clause by that family and the keys carry
  `mustVoice: ["7.21.4"]`, so splitting the label would turn every one of these
  clauses silent and buy nothing a reader can see. When an item's TEXT is what
  is wrong, change the text.

- **The four ways of not earning the identifier are now tested, and the title
  is trimmed before any punch item is.** `earnUaIdentifier` had NO fast-suite
  coverage at all — the function whose silent bail-out once took conformant
  deliveries from 19 to 0 while the corpus reported every promise held. All
  four are covered now, and each was checked against a deliberately broken
  gate: two of them passed at first because a later bail-out masked the one
  under test, which is worth knowing when writing the next one.

  `boundSummary` bounded `needs` only. `titleText` is the document's OWN title
  and has no bounded length, so it could take the header over the client's
  limit after every punch item had already been dropped — and an oversized
  header is rejected whole, leaving the client the file and NO summary: no
  counts, no verdict, no punch list. The title is now trimmed **first**, before
  a single item goes, because the punch list is the deliverable and the title is
  decoration beside it. A first attempt trimmed it last and cost a client an
  item to save a title; the test that caught that is in the file.

  And the operator console kept its own hand-written copy of the summary type,
  a contract in two places by hope — already behind (no `contrast`). It imports
  `RemediationSummary` now, so the shape moves with its producer.

- **The XMP packet is REBUILT, so anything not written again is gone.**
  `Finish` calls `setMetadata` with a packet it constructs, which replaces
  whatever the document declared. `[V]` Of 52 real PDFs in the blind corpus, 46
  carry an XMP packet and **35 declare `dc:creator`** — every repair dropped the
  author of the document. `contentChanges` cannot see it, because metadata is
  not a content field, so nothing disclosed it either. The author is now carried
  the way the title already is: **from DocInfo, which this pass preserves**,
  rather than by parsing and merging the old packet — a bad merge writes WRONG
  metadata where a rebuild writes none. `[V]` 13 of 13 authored documents keep
  it; a document with no author must not gain one, and a test holds both
  directions.

  `[V]` Measured on the delivered corpus afterwards — 42 real PDFs through the
  repair path: 34 sources declare an author, 34 deliveries declare one, **32
  carry it straight through**. The two differences in each direction are both
  explained and neither is a defect:

  - **2 lost.** Their author lives in XMP and NOT in DocInfo, so the rebuild has
    nothing to carry. Recovering these means parsing the old packet, which is
    the merge this deliberately avoids.
  - **2 gained**, and this is the one that could be misread as invention. Their
    author is in DocInfo and was absent from the source's XMP. Writing it into
    the packet is the move the TITLE already makes — `7.1-11` requires DocInfo
    and XMP to agree — so it is a transcription within the document, not a new
    claim about it. The document said it; it now says it in both places.

  The PDF/A identifier (1 of 52) is dropped ON PURPOSE: we do not check PDF/A,
  and carrying an unverified conformance claim through a rewrite is the exact
  conduct the PDF/UA identifier is withheld to avoid.

- **A caption keyword is not a caption, and `languageToCarry` now guards both
  lanes.** Two conversion-lane defects, one of each class the product cares
  about.

  `deriveAltFromCaptions` required only that a paragraph START with a caption
  word, so `[V]` "Map of the district was circulated to members." became an
  image's description — a sentence about a meeting, asserted as a description
  of a picture. Worse than no description, because it also silences the `1.1.1`
  item that would have reported the figure as undescribed, so nobody finds out.
  A LABEL is now required: a number or letter ("Figure 3", "Exhibit A") or a
  delimiter ("Photo —", "Image:"). The trade is stated rather than hidden — a
  bare "Map of the district" is no longer transcribed and that figure reaches
  the punch list undescribed. Separating it from "Map of the district was
  circulated" needs a finite verb, which is the judgement `1.4.1` and heading
  promotion both refused to make. **Adjacency was already strict** and is now
  pinned by a test: an intervening heading or body paragraph blocks derivation,
  contrary to an audit finding that claimed otherwise.

  And `w:lang w:val` — an arbitrary attribute from an untrusted `.docx` —
  reached `finishDocument` unvalidated, which refuses a non-BCP-47 tag and
  surfaces as `converter-failed`. **One unparseable metadata field cost the
  client the entire conversion**: no document, no punch list. The repair lane
  had already fixed exactly this (blind corpus, `/Lang ()` and `/Lang (en US)`),
  so `languageToCarry` moved to `domain/document-structure.ts` beside the schema
  it asks and both lanes use it. An unusable tag carries nothing and `3.1.1`
  asks a person to name the language.

  **Two things deliberately NOT changed.** The legacy `.doc` fodt fallback still
  carries LibreOffice's inflated reading (declared-nothing arriving as `en-US`),
  because for `.doc` it is the only reading there is — a documented decision
  with `w02-legacy-doc` pinned to it; changing it needs its own evidence and a
  key correction. And the `3.1.1` gap still reads "the source declares no
  language" when the source declared something unusable, which is slightly
  false on both lanes; fixing it means distinguishing "declared nothing" from
  "declared junk" in the summary contract.

- **`counts.headings` on a Word row is a FIDELITY expectation, not the category
  error the levels are.** The comment forbidding source-predicts-output in
  `author-real-keys.mjs` is attached to heading LEVELS, and it is right about
  them: whether r28's H1/H1/H3 skip survives depends on what the exporter does
  with the heading that made it. The COUNT is a different claim — carrying an
  author's headings across is the conversion's whole job — and it is graded
  asymmetrically for exactly that reason: **more** than the source had is
  `invented-structure` and fatal, the corpus's only guard against the converter
  fabricating structure; **fewer** is a non-fatal note. Do not delete the check
  to silence the notes.

  **The two standing notes are NOT explained.** `second-corpus-results.md` says
  r28 (key 13, delivered 12) and r32 (key 5, delivered 4) are headings lost in
  conversion. A crude re-read of the sources counts 11 and 4 — so on r32 the
  source and the delivery agree with each other and not with the key, which is
  not "a heading was lost". That re-read is a throwaway script and settles
  nothing; what it establishes is that the recorded explanation was never
  verified. Open, and to be answered with the key author rather than another
  quick probe.

- **A partial structure collapse has no guard, and that is a measured choice.**
  `convert.ts` refuses only `structureElements === 0`, so a half-lost structure
  tree would ship. `[V]` Across 148 documents the delivered heading counts track
  the keys exactly except r28 and r32, each off by one — no collapse occurs. A
  source-vs-output bound is also the category error `author-real-keys.mjs`
  names in its own comments. Left unbuilt on the evidence rather than on
  principle; build it when a document shows the shape.

- **An encrypted PDF is refused BY NAME, and it was never a data-loss bug.**
  A PDF encrypted with an empty user password and an owner password — the
  common municipal shape, restricting printing rather than reading — opens
  without a password and inspects completely, so nothing else in the reading
  says it is locked. `[V]` Verified directly against the corpus fixture:
  `Inspect` reads it as tagged with a full structure tree, and `Finish` throws
  `IllegalStateException: PDF contains an encryption dictionary` — PDFBox will
  not save a document holding one. **It has always failed safely: nothing is
  delivered and no permissions are stripped.** An audit claimed the opposite —
  that `doc.save` silently wrote it decrypted — and running it disproved that
  before any code was written. Do not "fix" that bug; it does not exist. What
  was actually wrong is that the refusal arrived as an unnamed stage crash an
  operator could not tell from a corrupt file, so `structure.encrypted` now
  feeds a named refusal beside `signed`. The encryption is deliberately NOT
  removed to proceed: the restrictions are the owner's decision.

- **Two Java defects that only fire off the developer's machine.** `Contrast`
  formatted its one float with the JVM's default locale, so a host whose locale
  writes decimals with a comma emitted `"ratio":4,50` — not valid JSON — and
  contrast was dropped from the entire delivery, on those hosts only. The ratio
  is emitted for FAILING pairs only, so such a host could run clean documents
  indefinitely before anything went wrong. `Locale.ROOT` fixes it.
  **Reproducing it needs `-Duser.language`, not `LC_ALL`**: `childEnv` forwards
  LANG/LC_ALL, but macOS JVMs take their locale from OS preferences and ignore
  both, so an environment-based test passes whether the bug is present or not —
  the first version of that test did exactly that. And `Finish.escape()` passed
  C0 control characters through into the XMP packet, which XML 1.0 forbids
  outright even as numeric references; the title is never ours (a heading from
  the client's document, or the document's own info dictionary on the repair
  path) and nothing validates it anywhere else. Both new tests were checked
  against the unfixed code and both fail there.

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
  An undeclared language is both a gap and a punch-list item (3.1.1,
  `INSTRUMENT_VERSION` 4): one missing declaration failed three UA-1 clauses
  on a real document, and "so none is claimed" is not something anybody can
  act on.

- **The product ships two instruments, and the second is the reference
  checker itself.** Every reading — a conversion, a repair, an inspection —
  now carries veraPDF's own UA-1 verdict (`conformance` on the summary,
  `INSTRUMENT_VERSION` 6): compliant, the failing clause ids, or
  `checker: 'none'` — which every surface renders as "not checked", **never
  as clean**, because a silent clause was the defect three incidents in a row.
  Two clause families translate into punch items a person can act on (fonts
  never embedded → supply the Word source; untagged page content → needs the
  source or a person); everything unrecognized rolls into a catch-all naming
  the clause ids, so no clause present or future fails silently. A report that
  says `compliant: false` and names NO failing clause is read as `checker:
  'none'`, not as a non-conformance: the items are built from the clause list,
  so that shape delivered a document marked not conformant whose punch list
  said nothing about why. Families our
  own vocabulary already voices (language, figures, headings, title,
  annotation nesting) are left to the items that voice them.
  `[V]` On the twenty-document real corpus: the product's verdicts agree with
  an independent veraPDF run on all 11 repaired documents (the runner fails
  loudly on drift), green unchanged at 2, silent deliveries 0, invented
  claims 0. The checker is ~15MB of jar (`prepare-verapdf.ts`, pinned and
  checksummed) on the JVM already shipped; `java.management` joined the jlink
  modules for it. Older stored readings cannot gain the field and render as
  "not checked". Font *substitution* remains cut: measured twice, it greens
  zero documents.
  **Suppression is earned, not assumed.** Families our own vocabulary voices
  are left to the items that voice them **only when the item is actually
  present** — checked per family. It used to be unconditional, and the blind
  corpus found two documents delivered with no items, no gaps, and
  `compliant: false` naming two annotation clauses: neither conformant nor
  punch-listed, which is the one outcome this product promises never to
  produce.

- **Contrast is detected and flagged — the first blocking condition is met.**
  `decision-2026-08-24.md` said *"No document goes to a client until contrast is
  at least detected and flagged"*, and that stood unmet for a week.
  `Contrast.java` graduated from the spike: foreground exactly from the graphics
  state, background sampled from the rendered page at 150 DPI with anti-aliasing
  off (WCAG 1.4.3 Note 2 sanctions that explicitly). `[V]` Across the blind
  corpus's 23 real documents, **5 fail 1.4.3**, worst 1.49:1 — every one of them
  was being delivered in silence. Three buckets that are never merged: failing,
  undetermined (no background could be read), and decorative (the document marks
  it `/Artifact` or `/Figure`).
  **It never gates.** Contrast is a source-design problem this pipeline cannot
  fix, and it is the one detector with a false-positive class it cannot rule out.
  **1.4.1 Use of Color did NOT move with it** — the same fee schedule marks
  changed values in red, which is meaning carried by colour alone, and nothing
  here detects that.

- **The document pipeline reaches SEVEN WCAG criteria, and says so.**
  The vocabulary can emit `1.1.1`, `1.3.1`, `1.4.3`, `2.4.2`, `2.4.10`, `3.1.1`
  and `4.1.2` — seven of the roughly fifty in 2.1 AA. Every reading carries
  `scope.criteria` and every surface renders it through
  `services/presentation/document-verdict.ts`.

  **`scope` states what RAN, not what the instrument owns.** `1.4.3` is the one
  criterion no reading can claim on its own: contrast is a separate stage,
  `withMeasuredContrast` deliberately never refuses when it fails, and the
  inspect-only path never runs it at all. So `summarise` emits the other six
  and `withContrast` adds `1.4.3` when a reading exists. Before this, `scope`
  was the whole constant unconditionally — a delivery whose contrast stage died
  told the client "Checked here: … 1.4.3 …" while the `contrast` field beside
  it was absent and every surface rendered that absence as "not checked". The
  same overstatement `checker: 'none'` exists to prevent, reintroduced through
  the field added to state the limits. **Do not assemble `scope` from a
  constant: a stage that can fail must add its own criterion.**

  **All three criteria the pipeline does not reach have been MEASURED and
  declined, rather than left unexamined.** `1.3.2` Meaningful Sequence is on
  `legal-standard.md`'s pass mark; `1.4.1` Use of Color and `2.4.6` Headings and
  Labels are not. None ships:

  - `1.4.1` — 17 of 23 real documents carry a saturated minority accent, and
    the overwhelming majority are hyperlinks and Word theme heading colours, so
    a detector would be right about roughly four.
    See `docs/research/document-remediation/use-of-color-feasibility.md`.
  - `1.3.2` — a page-monotonicity check over the structure tree fires on 7 of
    23 and has **zero true positives**. Two were the probe reading a container's
    `/Pg` as content, four were stories or footnotes ordered correctly, and the
    two survivors are letterhead logos and a full-page cover image, whose place
    in the reading order does not affect meaning.
    See `docs/research/document-remediation/meaningful-sequence-feasibility.md`.

  - `2.4.6` — a heading that IS a sentence is a real barrier, and one corpus
    document carries 49 of them (longest: 77 words) because its author
    outline-levelled body paragraphs. The signal is clean — the share of a
    document's headings ending in sentence punctuation, one comparison, no
    exemptions — and at ≥30% it fires on **exactly that document** across 118
    delivered documents, with zero false positives.

    **Refused for a third and different reason: it fires ONCE.** 1.4.1 was
    refused for imprecision and 1.3.2 for being wrong; this one for
    insufficient evidence. One document cannot distinguish a rule that works
    from a rule fitted to the document it was written against — and it was
    written knowing what that document looked like. Two more above 30% in a
    later corpus meets the registered criteria; the threshold is already in
    `experiments/document-remediation/prose-headings.mjs`.
    See `docs/research/document-remediation/prose-headings-feasibility.md`.

  All three stay in `NOT_CHECKED_CRITERIA`, which is disclosure, not silence.
  **Do not add a fourth without registering decline criteria first.** The 2.4.6
  measurement's first pass narrowed on four stacked conditions to get 13
  documents down to 1 — the `/Artifact` contrast mistake in miniature — and was
  discarded for a single comparison that does the same work honestly.

- **The summary header is BOUNDED, and the bound is a safety net rather than a
  routine trim.** The summary travels in `x-remediation-summary` with one item
  per undescribed figure and per unnamed form field — a list with no upper
  limit. A real municipal document carrying 101 figures once produced a
  22,743-byte header, and every client on Node's 16KB default rejected the whole
  response with `Headers Overflow Error`: the file arrived, the punch list did
  not. `boundSummary` now fits it to `SUMMARY_HEADER_BUDGET` (14,000 of the
  16,384, leaving the balance for the rest of the block) by keeping one item of
  every criterion, then as many of the rest as fit, then ONE item saying how
  many are not shown. Never a silent cap.

  Two things to know before touching it. **It bounds the punch list only** —
  counts, title and clause list are facts, not a list to shorten, so a document
  whose title alone exceeded the budget would still overflow. And **the budget
  must not be tuned down to make the bound fire**: at 12,000 the blind test
  reported 12 punch items missing, twelve of r05's figures dropped from a
  client's list, and the bound's own property is already proved by unit tests
  driving 5,000 items.
  See `docs/research/document-remediation/summary-header-bound.md`.

- **Reading order is ordered by STORY, not by page, and a page-monotonicity
  check is measuring the wrong thing.** Every backward page jump in the corpus's
  InDesign exports (r09, r15, r33, r34) falls exactly at a container boundary —
  one story or section ending on a later page than the next begins — which is
  the correct order for a reader and looks like a defect to the metric. A
  1.3.2 detector built on page order would report correct documents as broken.
  See `docs/research/document-remediation/meaningful-sequence-feasibility.md`.

- **The corpus cannot see reading-order defects, structurally.** The pipeline
  refuses untagged PDFs rather than tagging them by inference — 13 documents
  come back `repair_refused` — so every PDF delivered was tagged by a real
  tagger, and real taggers get sequence right. The documents whose order would
  actually be scrambled are the ones never delivered. Any future reading-order
  work needs evidence from a population this corpus does not contain.

- **A heading in Word is an OUTLINE LEVEL, not a style called `HeadingN`.**
  A style name is the commonest way to acquire one, and matching the name misses
  two shapes that occur in the wild: a direct `w:outlineLvl` in a paragraph's
  `w:pPr` (a township's minutes declared all 84 of its headings that way, with
  zero `HeadingN` in the body), and a custom style carrying no level of its own
  that inherits one through `w:basedOn` (`contactheading` based on `Heading2`).
  Count only paragraphs that carry text, because `removeEmptyHeadings`
  (`flat-odf.ts:200`) deletes the blank ones — that is what makes a source
  reading agree with the delivered document instead of approximating it.
  `w19-outline-level-headings` plants both shapes; before it, the corpus could
  not express either.

- **The second blind corpus's 8 "invented claims" were all instrument, and I
  published the opposite before checking.** 50 real documents from 44 unseen
  hosts, first run: five PDFs disagreed because the key ignored `/RoleMap`, one
  because a table sat in `word/footnotes.xml`, and two because of the heading
  rule above. I reported that the converter had fabricated 49 headings and
  called it a manufactured barrier. It had not; the document's own author
  outline-levelled 49 body sentences. Four campaigns in, the keys have been
  wrong far more often than the product — assume the instrument first.
  See `docs/research/document-remediation/second-corpus-results.md`.

- **A key file is not what the scorer reads.** `score.ts` applies
  `corrections.json` over the key, so `r05.key.json` says `needs: []` while the
  scorer expects 101 `1.1.1` items from the overlay. A design validated against
  the key alone was wrong about what the corpus would accept, and only the run
  caught it.

- **The blind corpus could not notice the product losing certification
  entirely.** Gating the PDF/UA identifier briefly took conformant deliveries
  from 19 to 0, and the run still reported every promise held — because not one
  answer key claimed a document should come back conformant. `w01-baseline` now
  asserts `conformance: { compliant: true }` and that exact failure now fails
  the run, but the general shape stands: the corpus grades what is CLAIMED, and
  a capability nobody registered a claim about is invisible to it.

- **The corpus title bias is CLOSED — the runner posts real filenames now, and
  a synthetic one is still forbidden.** For four campaigns every real document
  was posted under its generated id, the id matched `JUNK_FILENAMES`, and the
  filename rung of the title chain never fired on a real document — so the
  blind test failed 23 documents on a `7.1-9`/2.4.2 their production upload
  would not have raised. Since `3117d72` the runner posts each real document
  under the basename of its harvest URL, read from the tracked provenance
  manifests (`blind-corpus/real-names.txt`, `new-names.txt`); bytes, ids on
  disk, hashes and keys are unchanged. `[V]` Exactly the ten predicted
  documents became conformant (16/78 → 26/78; Word 21/26), every clause delta
  was `7.1-9` and/or the earned `5-1`, and all five promises held. What
  remains true: **never post a synthetic filename** — a title we invented at
  the door, then graded ourselves on, is the conduct the junk table exists to
  refuse; the real name is a fact the harvest had hidden, which is the
  opposite thing. One stale-number lesson is on the record: the registered
  "22 of 23" came from a measurement made before the title chain improved,
  and all 23 titled — a prediction that cites a measurement inherits that
  measurement's date. See
  `docs/research/document-remediation/real-filenames-results.md`.

- **`isTagged` is a floor of one — now MEASURED, and the standing policy is
  DECLINED, by decision.** The MCID-reachability probe the previous entry
  named was built and run: `[V]` 19 of 19 documents failing `7.1-3` parsed
  with zero stream errors, and the negative control — 8 delivered documents
  that do not fail the clause — sat at exactly **zero untagged text ops on 8
  of 8**, where the discarded `order[].text` proxy had put its control at
  0.56 against a 0.80 gate. The population splits three ways, and the axis is
  not the one the clause number suggests: **tree reachability is near-perfect
  almost everywhere** (17 of 19 at ≥0.93); what varies is how much text ever
  gets an MCID at all. Three to four documents have genuinely decorative
  trees (r14: a 47-page document whose tree reaches 16 text ops — untagged
  ratio 0.993; r10 0.924; n30 0.863; r06 0.600); two have real gaps (n05
  0.191 at 578 pages, n28 0.158); and thirteen have **fully-tagged text** —
  their `7.1-3` failures are untagged GRAPHICS, out of the probe's deliberate
  text-only scope. A tree-emptiness floor would catch r14 alone; only a
  content-side ratio can see the other three.

  The user's decision, probe in hand: **no standing policy.** Artifacting the
  untagged graphics is content-stream surgery worth about one document (n33)
  in the direction the product has refused twice; refusing decorative trees
  would UN-deliver four documents and conform none. The six blocked documents
  stay honestly blocked, and this gets revisited when a client engagement
  makes the trade concrete — not before. Tables and method:
  `docs/research/document-remediation/mcid-reachability-results.md`; the
  discarded proxy stays in `tree-coverage-declined.md`.

- **A link description read from the URI covers half the links in a real
  document, and the half it misses is the table of contents.** `Finish` has
  described `/Link` annotations since the annotation work, transcribing the
  URI as the author's stated destination. `linkUri` reads `PDActionURI` and
  nothing else, and an INTERNAL link has no action at all — a Word table of
  contents exports as a direct `/Dest` array naming a page. `[V]` One real
  delivered document: 70 link annotations, 35 with a URI and described, 35 with
  a `/Dest` and silent, and `7.18.5-2`/`7.18.1-2` failing on the strength of
  those 35. The fix takes the link's OWN TEXT — the glyphs its `/Link`
  structure element already references, via `StructText`, which `Inspect` and
  `Headings` use for the same purpose — and never the destination, which
  resolves to a page index or an exporter's `__RefHeading___Toc12345`. A link
  with no text keeps its silence and its punch item; naming an image link from
  its destination would silence the item that asks a person for a real
  description. `[V]` Two real Word documents whose ONLY residual clauses were
  those two are now fully PDF/UA-1 conformant: the Word lane moved 12/26 to
  14/26, with 0 regressed and no other delivered fact changed across 148
  documents.

  **Two things this cost that were not obvious.** `Finish` had never parsed a
  content stream — every other write there reads the catalog — so `StructText`
  introduced a way for a malformed stream to crash a document that used to be
  delivered; it is caught, degrading to exactly the previous silence. And an
  annotation `/Contents` is TEXT, so `7.2-24` wants a language for it: on a
  document that declares none, and we never default `/Lang`, this names links
  that had no name AND adds a clause. Empty on this corpus — all six documents
  touched declare a language — and right either way, but it is a clause
  appearing because we wrote something.

- **A description library is DECLINED on evidence, and the claim that it needed
  "a client with repeat documents" was half wrong.** The proposal was that a
  description written once be reused for the same image. `[V]` Two measurements
  killed it. First, the cross-document case cannot be tested here at all: all
  24 delivered documents failing `7.3-1` come from **24 different hosts**, and
  the corpus's six real multi-document organizations contribute **zero**
  description-blocked figures between them. Second, the within-document case —
  which needs no client and no invented repeat rate — was measured over 250
  undescribed figures and clears **fewer than 3% of items** (2 documents met
  the registered ≥30% bar against a threshold of 3).

  The finding worth carrying: **page furniture accounts for 25 of the 35
  figures that share an image at all** — a logo on every page, tagged `/Figure`
  rather than `/Artifact`. r09 carries 20 of them behind 4 images. That is the
  artifacting question above, not a description problem, and the registered
  criterion excluding furniture is the only reason this run did not read as a
  positive result.

  Two things about the instrument, stated because they bound the conclusion:
  it resolves only **44.8%** of undescribed figures to an image (8 of 24
  documents resolve none), and the decline criterion was written per-DOCUMENT
  (8/24, exactly a third, does not fire) when the question is per-FIGURE. A
  better instrument is the only thing that could overturn this, and it would
  have to find sharing in the 138 unmapped figures at a rate the mapped ones do
  not show. **Do not re-propose reuse without clearing that bar first.** If it
  is ever reopened, it is approval-gated and never automatic: the same
  photograph is "the town hall" in a directory and "the property showing the
  unpermitted addition" in an enforcement notice. See
  `docs/research/document-remediation/image-reuse-declined.md`.

- **Artifacting decorative figures is DECLINED, and the code for it already
  exists.** `experiments/document-remediation/Figures.java` (302 lines)
  implements the whole technique: the two-part edit that PDF/UA requires — the
  content stream's `/Figure <</MCID n>> BDC` becomes `/Artifact <<>> BDC` *and*
  the element leaves the tree, because doing only the second orphans the marked
  content and fails 7.1 — with a thin-band test (`MIN_RULE_RATIO = 20f`) and a
  byte-identical-repeat test, and area explicitly refused as a criterion.
  **It stopped as part of a LINE of work rather than on its own defect, and both
  halves of that are easy to quote wrongly.** `experiment-2-decision.md` STOPPED
  deterministic-only remediation at a reachable rate of 25% against an 80% gate
  — and its own header then records that 25% **FALSIFIED**: a later abstention
  pass took it to 40%, still short of the gate. Quote 40%, not 25%. Artifacting
  was one of the last two techniques added, and the pair moved holdout 1 from 2
  deliverable documents to 3.

  Its residue in that comparator is two assertions reading "Figure elements for
  decorative or repeated graphics" — decorative graphics the pipeline still
  tagged as **content**. That is the detector UNDER-reaching. Nothing on the
  record says this technique artifacted something it should not have, and an
  entry claiming it did would be arguing against the feature with the wrong
  evidence. The argument below stands on its own.

  The price of leaving it declined is **+2 of 78** real documents. `[V]` `n07`
  and `r27` are the only two whose residual is `7.3-1` plus `5-1`, and `5-1` is
  earned rather than failed, so clearing the figures would conform them both.

  **Two blockers, and the first is a safety gate rather than an oversight.**
  `contentChanges` (`document-structure.ts:289`) compares `structureElements`,
  `figures` and `order`; artifacting moves all three, so the repair lane refuses
  the file. The comment above it names this exact scenario — "four meaningful
  images artifacted out of the structure tree look identical, in the PDF, to
  four images that were never there" — and `Inspect.java:136-145` records the
  document that lost all four of its meaningful images and scored DELIVERABLE
  with zero defects. Shipping this means punching a hole in the check that
  caught that. Second, `StructText.boxOf` returns **null** for an image-only
  figure: boxes register only for MCIDs that harvested text glyphs, so a
  geometry classifier is blind to precisely the population it would target.
  A probe over the delivered corpus could locate only 109 of 249 undescribed
  figures for that reason.

  What would reopen it is a **declared-change channel** — a way for a repair to
  state an intended structural change so `contentChanges` records it instead of
  refusing — which is architecture, not a fix. Until then the standing rule from
  `repair-results.md` holds: **a gap a reviewer can see beats a deletion nobody
  can.** Do not re-measure the spike to reopen the question; the measurement is
  the thing that already exists.

- **The empty-table-row collapse is PROVEN and DECLINED.** r04 and r05 fail
  `7.2-43` on one table each: producer-written formatting-only continuation
  rows — a TR with zero TD/TH children under RowSpan'd cells — which veraPDF
  scores as spanning 0 columns unconditionally (RowSpan carry is never
  consulted for the has-cells test; read out of `GFSETable#checkRegular`'s
  bytecode). `[V]` A deterministic collapse — delete each cell-less TR after
  asserting the grid fully covers it, decrement crossing RowSpans — was
  applied to scratch copies and re-checked: `7.2-43` gone on both, **every
  other clause and check-count byte-identical**. Declined anyway: it deletes
  structure elements, which is the repair charter's kill criterion, and it
  buys **zero verdicts** — both documents stay blocked by font shapes the
  embedding pass correctly refuses (r04: invalid ToUnicode CMaps; r05:
  descriptor-less Type0). A second charter exception for zero conformance
  fails the ladder's first rung. What reopens it is the same declared-change
  channel as figure artifacting — and a document whose residual it would
  actually finish.

- **The annotation clause family prices at ZERO conformance at any charter
  level — verified, not assumed.** Every carrier of 7.18.4-1 (7 docs),
  7.18.5-1 (4), 7.18.1-3 (5), 7.18.3-1 (2), 7.18.4-2, 7.1-1/2, 7.9-1, 7.10-1
  and 7.1-7 is co-blocked by clauses outside the family, so even fixing all
  eleven — charter-breaking Form/Link element creation included — conforms
  nothing. `[V]` The old "7.18.5-1 clears 0" pricing re-verified true on the
  current corpus. Three fixes are charter-COMPATIBLE and verdict-free, kept
  on the shelf as punch-list accuracy: `/TU` from the field's own `/T`
  (every failing field has one, but most are exporter junk — a junk-name
  predicate is the real work), overwriting a producer's `/Tabs W` (the two
  failing documents carry that PDF 2.0 value, which Finish's absent-only
  guard skips), and the OC configuration `/Name`. r04's `7.18.1-2` residue
  is two drawn Square annotations with nothing stating their meaning — a
  human item, not a mechanical one.

- **The 7.2 family is TWO families, and the language half is already won
  everywhere it can be.** Read out of the veraPDF UA-1 profile itself: tests
  7.2-2/-21/-22/-24/-25/-33/-34 are natural language, and every one accepts
  catalog `/Lang` — which `Finish` already writes. `[V]` Zero language-test
  failures exist on any delivered document that declares a language. All 28
  remaining instances sit on **7 documents that declare none** (n05, n22,
  n23, n30, r06, r10, r14) — a permanent floor under the never-default rule,
  and the rule holds: r14 is one `/Lang` plus the declined `7.1-3` from
  conformant, and supplying it would be asserting a language nobody chose.
  Tests 7.2-10/-20/-42/-43 are STRUCTURE tests (table/list nesting) wearing
  the same clause number; pricing them as language work was the error this
  entry exists to stop. One coupling became live: the described links on one
  undeclared document now fail `7.2-24` — two checks against 32,399 `7.2-34`
  failures in the same file; the trade stands and is noted in `Finish`.

- **Route a CLAUSE, never a family — suppression is earned per criterion, so a
  family route lets one item silence everything beside it.** `alreadyVoiced`
  drops a veraPDF clause from the catch-all only when one of our own items is
  present, which is right. But `VOICED_BY_OUR_INSTRUMENT` used to route all of
  `/^7\.18\./` to 1.3.1, and `7.18` holds unrelated questions: a form field's
  name (7.18.1-3), a page's `/Tabs` (7.18.3-1), a widget's `Form` nesting
  (7.18.4-1), a link's `Link` nesting (7.18.5-1). Any document carrying the
  annotation item suppressed the whole family with it.

  This bit twice. First: r13 delivered with 135 unnamed form fields named
  nowhere. Splitting `7.18.1-3` out fixed that one clause and left the rule.
  Then `[V]` a sweep of the corpus found **four more instances still reaching
  nobody** — r13 with `7.18.3-1` and `7.18.4-1`, p15 with `7.18.4-1`, p30 with
  `7.18.5-1` — in no gap, no need and no catch-all. Documents where the 1.3.1
  item happened to be absent voiced their clauses correctly, which is what
  showed the mechanism was sound and the route was not. The family route is now
  gone; only `7.18.1-3` is suppressed, because the 4.1.2 item genuinely says it.

  **The corpus cannot catch this class.** `SUPPRESSED` in `score.ts` mirrors the
  domain route, so a suppressed-but-unvoiced clause is neither `silent` nor
  `suppressedButQuiet` — the scorecard read `Silent gaps 0` the whole time.
  Verify a routing change by diffing veraPDF's clauses against our items
  directly, never by the scorecard. And move the mirror in the same commit.
  See `docs/research/document-remediation/annotation-clauses-results.md`.

- **`PDPage` does not override `equals`, so never key a map on it.**
  `PDStructureElement.getPage()` builds a fresh wrapper around the page's
  dictionary. A `Map<PDPage, Integer>` misses every time: all 101 of r05's
  figures reported no page while qpdf showed every one carrying `/Pg`. Key on
  `page.getCOSObject()`, which is the same object. `StructText.java` has a
  `Map<PDPage, Integer>` of its own that works only because it never looks up
  with a wrapper obtained elsewhere.

- **A count read from the AcroForm field tree is not a count of form fields.**
  PDFBox's `getFieldTree()` resolves inherited `/TU` correctly and returns
  NOTHING for a document whose widgets are on the page but in no field tree —
  which a planted corpus row is, and real PDFs are. The first implementation of
  the 4.1.2 pass read that document as having no form at all. The population has
  to come from the page annotations; the field tree is only good for resolving
  inheritance. Caught by scanning the whole corpus with the compiled stage, not
  by a test.

- **The pipeline has been measured on documents it had never seen.**
  `experiments/document-remediation/blind-corpus/` — 97 documents (69 planted,
  28 real from 25 hosts sharing no domain with any training manifest), keys
  hash-locked before first contact, scored by `scripts/doc-blind-test/`.
  Results in `docs/research/document-remediation/blind-test-2026-08-29-*.md`.
  `[V]` 82 documents past the door: 67 delivered, 15 refused; 19 fully
  conformant on both instruments; **48 of 48 non-conformant deliveries carry a
  punch list, and 0 came back as neither**. Invented claims 0, silent gaps 0,
  drift 0, door leaks 0, punch items missing 0, disposition 38/38 on core
  rows. It found four product defects — an unusable source `/Lang` costing the
  client the entire repair, the suppression assumption above, a producer's
  placeholder title outranking the document's own heading, and attachments
  nobody examined — and six defects in
  itself, which is why 40 corrections across 18 of 28 real keys (64%) are
  recorded in `corrections.json` and print on every scorecard. Keys
  for real documents are authored by qpdf, unzip and the veraPDF CLI and by
  nothing in `src/`, enforced by
  `tests/scripts/blind-corpus-keys-are-independent.test.ts`.
  **Attachments are now named** (`INSTRUMENT_VERSION` 8): a portfolio is a
  cover sheet with other documents inside it, and neither instrument opens one,
  so an unremediated payload used to fail no clause and produce no finding.
  `Inspect` counts the EmbeddedFiles name tree and the punch list says so,
  labelled `PDF/UA 7.11` rather than a WCAG criterion — the opposite choice
  from the annotation item, and deliberately: there the defect is known, here
  the attachment was never opened, so naming a success criterion would assert
  a failure nobody checked. Counted, never opened; each attached document goes
  through the pipeline on its own. **A placeholder is no longer a title**
  (`INSTRUMENT_VERSION` 7): a producer stamp is what Word writes when a
  document has none, so `isPlaceholderTitle` declines it on provenance and the
  chain continues to the document's own heading, then the filename, then the
  honest gap. It is a predicate, never a rewriter, delegates to the junk table
  the filename chain already used, and governs all three paths that decide a
  title so no two surfaces disagree about one document. `[V]` Exactly one
  document of 92 changed. **Proven on the deployed function:** a nine-document
  spot-check — one row per fix above, both refusal kinds, the ordinary good
  case — came back **9/9 identical** to the local run against production built
  from `dce358b`. The numbers are no longer local-only.

- **23 municipal PDFs are in git history, deliberately.** `git add -A` on a
  results branch swept them onto public master on 2026-08-27 (`6228d41`);
  they were removed from the tree two commits later (`2f534d2`) and the
  directory was gitignored. The blobs remain reachable in history, and on
  2026-08-31 the decision was to leave them. **This is a recorded gap, not a
  pending task** — do not "fix" it without re-reading this.
  The rewrite was built and fully verified before the decision, so the cost is
  measured rather than guessed. `git filter-repo --path
  experiments/document-remediation/real-pdf --invert-paths` produces a master
  whose tree hash is **byte-identical** (`dffedf33`), same 408 commits, lint,
  typecheck and 1834 tests green, 16MB → 7.1MB. But it rewrites **628 of 638
  commits, not the ~96 the leak spans**, and strips **all 173 commit
  signatures** — filter-repo drops `gpgsig` by design, every GitHub merge
  commit carries one, and each stripped signature cascades to its descendants.
  133 of those signatures predate the leak and would be collateral. Weighed
  against that: these are public municipal records already published on
  government websites with their URLs in `real-sources.md`, the current tree
  is already clean, and a force-push does not remove anything from GitHub
  anyway — unreachable objects stay fetchable by SHA until GitHub garbage-
  collects, which needs a Support request. Hygiene, not containment.
  Two traps for anyone who revisits this: `src/app/api/audit/runs/[requestId]/
  report.pdf/` is a live route DIRECTORY, so a `*.pdf` glob filter deletes a
  production endpoint; and verifying a purge by fetching the pre-purge history
  into the purged repo re-introduces every blob you just removed — compare
  tree hashes across repositories instead.

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
- **The catalog tables all have screens now.** `clients`, `journeys`,
  `client_config`, `reports`, `activity_events` and `finding_triage` have a
  store, a tested contract and an operator surface — the clients, reports,
  activity and settings screens under `app/(platform)/`, walked end to end by
  the hydration suite against the built app.
  This entry used to say they were "reachable but mostly empty … until the
  screens land slice by slice through Phase 2C", which stopped being true when
  2C completed — recorded a few lines above in this same file. Third stale
  status claim found here (after #138 and #157), and the pattern is the same
  each time: an entry written during a transition and never revisited once the
  transition finished. **A gap entry that describes finished work is worse
  than no entry** — it sends a reader looking for something to build.
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

- **The document punch list is a work system, and a person's answer is the
  only way a claim reaches a delivered file.** (2026-09-01/02, PR #196 and
  its successor.) Every punch item has an identity: `summary.asks[i]` is
  emitted positionally beside `needs[i]` from one `punch()` helper
  (`domain/document-remediation.ts`), so the two cannot disagree; `asks` and
  the `excerpt` (the document's own words around each open figure, for the
  operator who will describe it) stay off the response header
  (`transportSummary`), the public report (`buildDocumentReport` is field by
  field) and the logs (`logSafe`). Repair blockers — signed, encrypted,
  untagged — are asks on the inspection's own reading (`withRepairability`),
  so a refusal is on the record before anybody clicks Repair.
  **Answers are rows** (`document_answers`): append-only, latest per
  (document, `input_sha256`, ask), three dispositions kept apart —
  `declared` (a value written into the file), `decided` (a judgement that
  changes no bytes), `requested` (asked of the client) — attributed to the
  principal who made them and keyed to the exact bytes they were given for.
  Revised bytes at the same address expire every answer loudly: the items
  come back open. Answers attach to the row that was answered; a paired
  PDF's state merges its Word source's answers, and converting the source
  consumes both.
  **One derived state per document** (`services/document-state.ts`):
  not-reviewed → stale → needs-answers → conformant → ready →
  waiting-on-client → closed, first match wins, computed at read time over
  the 200-row universe the inventory already fetches — no status column
  until a client exceeds that. `running` is a fact about a browser tab, not
  a row; `refused` folded into the repair asks. A document whose run is
  refused is never `ready`. Labels live in `presentation/document-verdict.ts`
  (never "done": `closed` means nothing is open and the file still fails the
  checker); chips map onto the five run palettes.
  **The pipeline writes what a person declared and nothing else.** `Finish
  --alt-file` writes a description onto the figure at the ordinal `Inspect`
  reported, from the walk both stages share (`FigureOrder.inOrder`) — the
  second standing exception to "no structure element altered", and like the
  first it infers nothing. The fidelity gate became
  `contentChanges(applyDeclarations(before, answers), after) === []`: the
  reading plus exactly the declared deltas (a description moves `figures[i].alt`
  AND that figure's reading-order text, because `StructText.of` reads Alt),
  so a description on the wrong figure refuses the run. Every declaration is
  checked against its preimage first — bytes, type, page, the shape of the
  prior description, and the image digest where both sides know it — and a
  mismatch refuses the whole run with `answer-mismatch`, records the bytes on
  the row so the answers read as stale, and delivers nothing.
  **Decorative is record-only.** Empty `/Alt` passes veraPDF's presence test
  while saying nothing — the r34 shape — and artifacting is a structural
  delete that was priced and declined; a decorative decision is `decided`,
  stays on the punch list, and the UI says so. Acrobat and Equidox artifact
  in-app; this is the one place v1 is behind the market, on purpose.
  **Figure geometry was measured and fell short of its prediction**
  (`figure-geometry-results.md`): the image-only pass locates 44 % of open
  figures on the real corpus — the same as the probe — because the worst
  documents have far more `Figure` elements than images (r05: 101 vs 62).
  Digest grouping stays (r09: 38 → 22 acts); crops stay deferred and now
  name path geometry as their precondition; the language hint, AI drafts and
  artifacting on a decision are deferred with triggers in the plan.
  **The harness holds the channel to the charter:** `keys/<id>.answers.json`
  sidecars are posted as the `answers` part; every `/Alt` on the delivered
  bytes is read by qpdf and must be one the source carried or one a person
  declared, else `invented-claim/invented-alt` (always fatal); the tamper row
  `p70-answers-old-bytes` must refuse. `verify.mjs` reports a pre-existing
  `w19` heading-count mismatch untouched here.

## Agent behavior

- Do not invent Netflix process that isn’t grounded in these rules
- Prefer multitask/parallel agents for independent files/phases; serialize shared contract changes
- Do not edit plan files the user attached unless asked
- Ask before destructive git operations; commit only when asked (unless the user explicitly requests committing as part of the phase)
