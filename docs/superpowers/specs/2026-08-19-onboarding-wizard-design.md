# Client Onboarding Wizard — Design

**Date:** 2026-08-19
**Status:** Approved design, pre-implementation
**Origin:** Onboarding-flow audit, Finding 1 — journey creation is API-only, and the UI
teaches operators to use the machine bearer token, against the cutover security model.

## Problem

The onboarding flow dead-ends in the middle. An operator can add a client from the UI,
but the next step — recording a journey — is documented only as a curl command with the
`AUDITOR_RUN_TOKEN`, a machine credential humans are supposed to stop holding at
cutover. Three screens promise a step the UI cannot deliver. Journey authoring also
assumes selector literacy, so even with a form, a non-technical operator has no path to
a first audit.

## Decisions (settled with the user, 2026-08-19)

1. **Scope:** a guided onboarding wizard, not a bare journey form.
2. **Onboarded means:** the first audit has completed and its results are on screen.
3. **Authoring:** replay-verified authoring — save steps, then verify them with a
   bounded server replay in our own Chromium. No co-browsing, no extension.
4. **The machine token leaves the UI.** The API path remains for CI, documented in
   `docs/`, never in product copy.
5. **The wizard replaces the Add Client modal** — one way to add a client.
6. **Delivery:** phased, on existing rails. Real rows written as each stage completes;
   no draft tables, no wizard state machine.

## Flow

Two guarded routes. The wizard has no memory: every screen derives its stage from the
record, so resume, refresh, and deep-linking are free and cannot disagree with the data.

### `/clients/new` — Stage 1: the client

The stage indicator renders here too — "1. Client" current, the later stages muted —
so the operator sees the whole journey from the first field (decided 2026-08-19,
after reviewing the mockup). The modal's two fields (name, owner) with the fixes
the modal never got:

- `maxLength={120}` on the name input, matching the server schema.
- A human `MESSAGES` map (see Error handling) — raw codes never render.
- Inline duplicate hint: the form checks the loaded client list; a matching name shows
  "You already have a client named X" with *continue anyway* / *go to theirs*. The
  server still suffixes on true collision; the hint prevents the accidental ones.
- On success, navigate to `/clients/<id>/setup` **with `replace`**, so browser-back
  returns to the portfolio, not to an empty create form that reads as "edit."

### `/clients/<id>/setup` — Stages 2–5, derived from the record

| Record state | Stage rendered |
| --- | --- |
| Client has no journey | **2 — Where do we audit?** |
| Journey exists, `journeyRunRefusal` non-null | **3 — Steps** |
| Journey runnable, no run exists | **4 — First audit** |
| Newest run in flight (`running`) | **4 — live progress (poll)** |
| Newest run failed, no completed run yet | **4 — failure state** |
| A **completed** run exists | **5 — Results summary** (terminal) |

**Stage 2 — Where do we audit?** One URL field (schemeless input normalized to
`https://` client-side) and a choice:

- **"Start with the homepage" (recommended, default):** the wizard creates the journey
  itself — name "Homepage", the given `targetUrl`, and a single `goto` step to the
  target URL's **own path** (not `/`, which would discard a pasted path like
  `/shop`) — via the existing `POST .../journeys` route. The operator never sees the
  step editor.
  This is the fast path: first audit in minutes, selector literacy not required.
- **"Record a multi-page journey":** creates the journey with a name and `targetUrl`,
  no steps, and advances to Stage 3.

Environment sits behind an "Advanced" disclosure, defaulting to `production` (the
strictest policy). It is not a question the fast path asks. No schedule here — cadence
is offered at Stage 5, after the operator has seen what a run is.

**Stage 3 — Steps.** The existing structured step editor (`journey-steps-editor`),
embedded, with the existing credential-presence panel beside it, plus **"Verify so
far"** (see Preview endpoint). Copy distinguishes the two actions explicitly: *verify*
"walks the path in a real browser — no audit, nothing saved"; *run* "the real audit —
saved, scored, on the record." Credentials are `credentialRef` only, exactly as the
editor already enforces; no secret is ever typed into the wizard.

**Stage 4 — First audit.** The path stays editable until it is on the record: the
first-run stage renders the step editor, the credential-presence panel, and
"Verify so far" below the run control (amended 2026-08-19 — the stage machine
flips `steps → first-run` the moment valid steps save, so without this the
"save, then verify" flow was unreachable and multi-page authoring got exactly
one save inside the wizard). "Run the first audit" reuses the run-start + poll pattern
from `RunJourneyButton` (202, poll URL, ceiling, `role="status"` live region, elapsed
time with "usually under a minute" expectation-setting). A run in flight renders here
on reload. A **failed** first run renders the classified reason through
`describeRunFailure` plus two affordances — the operator's first failure must not
dead-end:

- **"Edit the steps"** → Stage 3.
- **"Start over with a different URL"** → archives the wizard-created journey and
  returns to Stage 2. Journey PATCH deliberately refuses `targetUrl` changes (a stored
  journey must not be re-aimed at somebody else's site), so a URL change is
  archive-and-recreate; if no archive route exists yet, the plan adds one.

**Stage 5 — Results summary (terminal).** Verdict, score, must-fix count, pages
audited; "Go to findings" into the client screens; the schedule select (existing
component) as the closing action; and the enrichment prompt: "Real users sign in and
check out — record that journey to audit what they actually hit" (links to Stage 3
authoring for a new journey; the prompt itself is Phase 2). Revisiting `/setup` after
onboarding shows this stage — idempotent, never stale, no redirect trickery.

### Resume

"Setup incomplete" is **derived, never stored**: client has no journeys, or no journey
is runnable, or no **completed** run exists (a failed-only history is still
incomplete — onboarded means the first audit *finished*). While true, the portfolio
row and the client overview
show a "Finish setup" link into `/setup`. Leaving the wizard at any point loses
nothing — every stage already wrote real rows, and the existing screens render those
states honestly ("Never audited", refusal reasons). No new columns, matching how
`fixed` is derived from a run's absence.

## Preview endpoint (replay-verified authoring)

`POST /api/platform/clients/<clientId>/journeys/<journeyId>/preview`

- **The runner minus the audit.** Same `authorizePrincipal`, same journey-ownership
  check as the runs route, same SSRF/target checks, same `allowedHosts`, same
  environment action policy. Replays the journey's **stored** steps 1..N in one bounded
  invocation (`runtime nodejs`, `maxDuration 300`), skipping the axe scan, the AI
  advisory, and all persistence. The editor saves first, then verifies — one source of
  truth; there is no "preview unsaved steps" variant.
- **Returns** per-step outcome (reached/failed, classified via the existing failure
  classifier) and a final screenshot **inline in the authenticated response, never
  stored** — throwaway pixels of authenticated pages stay out of the blob store and
  its lifecycle.
- **No run row is written.** Verdicts, baselines, regression comparison, and the
  portfolio never see previews.
- **Spends the shared run budget** (`AUDITOR_MAX_RUNS_PER_HOUR` / `_PER_DAY`): browser
  time against a client's live site is the cost the budget caps, and a preview is
  that. Fails open, like the run budget, for the same reason. Budget refusal renders
  the same human sentence the run button uses.
- Emits a structured `journey_preview` log event (duration, outcome, step count)
  through `services/logger`.

## Deletions and copy changes

- **Delete `add-client-modal.tsx`** and the `addClient` modal state in `state.ts`.
  Header "Add a client" and the empty portfolio's button become links to
  `/clients/new`.
- **Remove every bearer-token instruction from the UI.** The journeys empty state's
  curl text becomes a "Finish setup" link; the client-overview empty state gets the
  same link instead of its pointer-to-nowhere. The API path is documented in `docs/`
  for CI and scripts.
- **Correct stale comments in passing** where the wizard touches them: the header's
  "no per-user identity" comment; the modal's "server's message" claim dies with the
  modal.
- "Journey" is taught once, at first mention, in one sentence of inline prose
  (amended 2026-08-19: the `InfoTip`/glossary mechanism this originally named
  did not survive into the platform screens; the sentence did).

## Error handling standard

Every wizard fetch surface ships with a `MESSAGES` map (the `RunJourneyButton` /
`JourneySchedule` pattern). Raw codes never render. New entries include:

- `invalid_request_body` (client create) → "Check the client's name — up to 120
  characters."
- `unauthorized` → "Your session expired. Reload and sign in again."
- Preview-specific: budget exhausted, SSRF/target refusal, credential not configured.

`aria-invalid` marks a field only when the field's **value** is wrong — never for
transport or session failures.

## Accessibility requirements

This wizard ships inside an accessibility auditor; it goes through the same axe-zero
hydration gate as every screen. Coverage (amended 2026-08-19 to match what the
suite actually asserts): the route sweep axes `/clients/new` and `/setup` in their
terminal states, the walk axes the portfolio while the "Setup incomplete" hint
renders, and the walk axes the **failed** stage in place — the richest composite
the wizard produces (banner, editor, credentials, verify, run, archive). Transient
states not listed are exercised functionally by the walk but not axe-swept. Stage indicator is a `nav` with `aria-current`; focus moves to the stage
heading on advance; verify/run progress uses `role="status"` live regions; the
existing inert-button pattern applies to busy controls.

## Testing

- **Hydration suite:** empty portfolio → wizard → homepage fast path → first run →
  findings render, against the built app and the real store (replaces the modal test,
  which keeps its job: the front door must reach the store and come back). Axe at zero
  on `/clients/new` and every `/setup` stage. Focus lands on the stage heading after
  each advance.
- **API tests (preview):** authz + cross-origin cookie refusal; ownership check;
  policy/SSRF refusals; budget accounting; and the load-bearing pair — **no run row
  written, no artifact stored**.
- **Unit tests:** the pure stage-derivation function in `services/` — every record
  shape maps to exactly one stage, in-flight and failed runs included.
- **Store contracts unchanged** — no new tables, nothing for the doubles to drift on.

## Phasing

- **Phase 1 (shippable alone):** wizard routes + stage derivation, homepage fast path,
  embedded step editor path, preview endpoint with inline screenshot, first-run stage
  with poll + failure state, results summary, all deletions/copy changes, full test
  coverage above.
- **Phase 2 (additive UI only — no schema or API changes):** auto-verify on each step
  save, per-step inline screenshots, the post-first-audit enrichment prompt.

## Out of scope

- Co-browsing / free-browsing recording (revisit when a container worker exists — the
  same infrastructure gap AGENTS.md notes for site-wide crawls).
- Per-operator API keys (the attribution answer for scripted use, if ever needed).
- Audit Findings 2 (`client-unassigned` slug collision), 4 (concurrent-add merge), and
  5 (post-add navigation — subsumed by the wizard, but the modal papercuts are moot
  once it is deleted). Finding 3 is absorbed by the error-handling standard; Finding
  6's copy items by the deletions section.
