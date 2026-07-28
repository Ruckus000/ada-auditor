# ADA Auditor V1 Design

## Goal

Design a continuous ADA/WCAG accessibility risk auditor for authenticated multi-step web applications that runs unattended within defined safety boundaries and produces executive, engineering, and CI/CD outputs.

## Product Shape

The product is a hybrid evidence-first system, not a pure AI agent. Deterministic browser automation and accessibility analysis establish what happened and what is objectively wrong. AI is then used to interpret evidence, prioritize issues, explain likely impact, and identify higher-judgment accessibility and UX risks that rules alone may miss.

The system targets:
- authenticated multi-step web applications
- preview/staging and production environments
- unattended operation inside a bounded operating contract
- three outputs from each audit run:
  - executive scorecard
  - developer findings with evidence and remediation guidance
  - CI/CD gating signals

## Recommended Architecture

The v1 architecture consists of six bounded parts:

1. Journey execution engine
   - logs in, navigates known flows, captures evidence, and enforces environment safety rules
2. Deterministic accessibility audit layer
   - runs repeatable rule-based checks for semantic, focus, keyboard, labeling, and structural issues
3. AI reasoning layer
   - interprets evidence, identifies likely higher-order accessibility risks, and drafts human-readable findings
4. Self-healing and change detection
   - performs bounded recovery from minor UI drift and reports degraded runs when confidence is low
5. Reporting and regression intelligence
   - clusters issues, tracks deltas across runs, and produces executive, engineering, and CI/CD views
6. Orchestration layer
   - schedules runs, manages retries, routes outputs, and integrates with surrounding systems

## Positioning

V1 should be positioned as an ADA/WCAG accessibility risk auditor for web applications, not a definitive legal-compliance certifier. It can provide strong evidence of accessibility failures and meaningful continuous monitoring, but it should not claim universal or final ADA compliance determination.

## V1 Scope

V1 must do the following well:
- execute bounded authenticated journeys reliably
- detect rule-based accessibility failures repeatably
- capture enough evidence for reproduction and trend analysis
- use AI to prioritize and explain findings without inventing unsupported claims
- recover conservatively from small UI drift
- track regressions across runs with low noise

## Explicit Non-Goals

V1 does not attempt to provide:
- universal zero-setup discovery of arbitrary application flows
- full autonomous adaptation to arbitrary auth or tenant changes
- unconstrained exploratory behavior in production
- legal certification or definitive ADA sign-off
- broad automated code modification
- full parity with real assistive technology behavior
- coverage for native mobile apps, PDFs, email templates, or non-web surfaces

## Operating Environments

The system should prefer preview or staging when available and use production for controlled verification. Environment capabilities should differ by policy:

- production
  - primarily read-only navigation and inspection
- preview/staging
  - richer interaction and safer completion of bounded flows
- isolated test environments
  - fuller mutation where required for safe end-to-end journey completion

## Seven Contracts

### 1. Autonomy Contract

The auditor runs unattended only inside a machine-enforced operating envelope. Each run must declare:
- `environment`
- `identity`
- `scope`
- `actionPolicy`
- `recoveryPolicy`
- `confidencePolicy`
- `failureMode`

If any element is violated, the run must stop, skip, or degrade rather than improvise.

### 2. Evidence Contract

Every finding must be backed by a stable evidence bundle. Minimum evidence per audited step:
- page identity: URL, route, title, app state marker
- run identity: environment, account/role, journey, step, timestamp
- screenshot
- DOM snapshot
- accessibility tree snapshot
- keyboard trace
- focus trace
- navigation events
- deterministic check outputs
- AI finding confidence with references to supporting artifacts
- recovery record, if any

Findings based on incomplete evidence must be downgraded or rejected.

### 3. Recovery Contract

Recovery in v1 is allowed only for bounded UI drift. Allowed recovery includes:
- selector fallback
- text or label similarity matching
- small layout movement
- route alias changes
- retry after transient overlays or loading issues

Recovery does not include:
- discovering new workflows
- inventing new auth paths
- changing role or tenant assumptions
- taking destructive actions to continue a flow

Every recovery attempt must record the failed step, chosen strategy, confidence score, and checkpoint proving the step still means the same thing.

### 4. CI Gate Contract

CI/CD outputs must be based on stable classes of findings:
- `deterministicFail`
- `highConfidenceRegressionWarn`
- `advisoryAiObservation`

Only deterministic failures should block CI in v1. High-confidence AI regressions may warn. Advisory AI findings should never block builds in v1.

### 5. Journey State Contract

Every journey must define:
- required role/account
- tenant or workspace context
- data fixture or precondition requirements
- allowed entrypoint
- expected checkpoints
- forbidden actions
- completion criteria

If the required state is absent, the run should be reported as an invalid execution context rather than an accessibility failure.

### 6. Production Safety Contract

Production execution must use a policy-enforced action model. Default production policy:
- allowed: login, navigation, open details, search, filter, paginate, inspect
- denied: create, update, delete, submit, send, invite, publish, purchase, upload, bulk actions
- conditional: explicitly approved read-safe form interactions

Each planned action must be classified before execution. Unclassified or forbidden actions must not run.

### 7. Scoring Contract

The scorecard must be explainable and derived from explicit inputs. V1 inputs should include:
- audited journey coverage
- deterministic issue counts by severity
- regression trend over time
- degraded or incomplete run percentage
- confidence-weighted AI advisory counts, if included

V1 should favor a simple and explainable scorecard over a pseudo-precise composite metric.

## Key Edge Cases to Design For

The implementation must account for:
- MFA, SSO redirects, session expiry, and token refresh loops
- role-based UI differences
- feature flags and experiments
- seeded data preconditions
- third-party widgets and iframes
- delayed hydration and loading states
- virtualized lists and lazy-loaded content
- route changes that drop focus
- modal and keyboard traps
- localized labels and content
- responsive layout changes
- cookie or consent banners
- degraded runs contaminating trend analysis

## n8n Recommendation

`n8n` is appropriate as an orchestration shell, not as the core audit engine. It may be useful for:
- scheduling
- fan-out and retries
- notifications
- routing outputs to other systems

It is not a strong foundation for:
- browser-stateful journey execution
- evidence generation
- bounded recovery logic
- regression intelligence
- CI/CD trust semantics

The core engine should live in application code. If `n8n` is used, it should remain outside the core audit logic boundary.

## Recommended Boundary Model

Keep framework code at the edges and business rules in the center:

- `/domain`
  - audit contracts, policies, scoring rules, finding models, platform capability model
- `/services`
  - run orchestration, journey execution coordination, evidence processing
- `/repos`
  - persistence for runs, findings, artifacts, and journey definitions
- `/api`
  - trigger endpoints, report endpoints, CI integrations
- `/integrations`
  - browser automation, AI provider, scheduler, notifications, platform adapters

## Multi-Platform Adapter Layer

Client platform differences are handled at the integration edge, not by forking the audit core.

### Platform Capability Contract

Each run may declare or detect a platform (`generic`, `react`, `wordpress`) with capabilities:

- `spaNavigationHints`
- `componentSourceHints`
- `cmsTemplateHints`

Unknown platforms fall back to `generic`.

### Adapter Responsibilities

Adapters enrich a shared rendered-web audit. They may:

- detect platform-specific markup or runtime signals
- annotate evidence with framework/CMS metadata
- contribute remediation/source hints when available

Adapters must not:

- redefine core finding semantics
- bypass environment safety or CI gate rules
- replace the generic browser evidence path

### First Adapters

1. `generic` — baseline rendered DOM audit for all clients
2. `react` — SPA navigation, hydration, and component-source hints
3. `wordpress` — theme/plugin boundaries and CMS template repetition hints

Source-aware mapping remains optional and only activates when code access exists.

## Proceed / No-Proceed Decision

Proceed with implementation planning after this spec. Do not proceed by jumping straight into coding a general autonomous agent. V1 is viable only if it remains bounded, evidence-first, and explicit about where AI is advisory versus authoritative.
