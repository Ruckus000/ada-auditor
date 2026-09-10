# Make ADA Auditor understandable without training

> **Landed on master 2026-09-10, with corrections.** This document was written
> on the branch `codex/plain-english-audit` and describes that branch, which is
> not on master and was never merged — merging it would have reverted work
> master has since done differently. Every claim below about what "now" exists
> refers to the branch unless a note says otherwise. The counts, the status
> line, the phase table and the vocabulary table have been annotated in place
> to say what actually landed. Nothing else has been rewritten: this is a
> record of what was proposed, not a description of the product.


**Audience:** General staff with no accessibility training, confirmed by the user.
**Status:** *(corrected)* First implementation pass applied **in the branch this
was written on**, which never merged. On master the correctness work landed
separately as #228–#234; of the vocabulary below only Portfolio → Clients was
applied as a rename, and the rest was assessed and cut — see the table. Phase 2
was not started. The remaining phases still require curated rule copy,
document-approval decisions, and usability review.
**Basis:** Source review at commit `0d6fea0`, September 8, 2026. See the companion evidence audit for examples and implementation locations.

## What needs to change

The app often explains how the auditor works before it tells the operator what to do. It also uses several names for the same task and displays checker messages as instructions. Shortening sentences will help, but it will not resolve those problems alone.

There are accuracy problems to fix first. Some explanations still say only critical issues fail an audit. The shared report can call an item awaiting human review a confirmed failure. The console turns an unfamiliar severity, including `needs-review`, into “Minor.” These were source-confirmed presentation defects. *(corrected: that sentence
described the branch's own implementation. On master the same three defects are
fixed by different code — the gate seam in `services/presentation/severity.ts`,
`audit-types.ts` falling back to `needs-review`, and the shared report filtering
its criteria list through `failsConformance` — and are covered by
`tests/app/uniform-run-surfaces.test.ts`, which renders one stored run on six
surfaces and asserts they agree.)*

The target experience is simple: **tell me what happened, show me where, and give me the next step.** A staff member should not need to understand WCAG numbers, browser selectors, PDF internals, or deployment settings to proceed with routine work.

## What the branch carried that master did not

Recorded here because the branch ref is being deleted and this is the only
place the fact would otherwise survive.

`src/app/platform/lib/api-error-copy.ts` — a `describePlatformError(code,
status)` over nine platform error codes — is the branch's one source asset with
no counterpart on master. It is worth knowing about and **not** worth
cherry-picking as written: it is a `Record` lookup, which this codebase
deliberately avoids for codes arriving off a parsed JSON body (`__proto__`
resolves through the prototype chain to something React renders by throwing —
see the note atop `discovery-copy.ts`), and both of its fallbacks end in "Try
again", which `discovery-copy.ts` calls "the one instruction this refusal makes
wrong". Its idea — one sentence per platform error code instead of a raw code
on screen — is real, and it belongs to the error-copy consolidation the
planning file already records as its own change: five homes for error copy and
the expired-session sentence in fourteen sites across four wordings.

## The writing rules

1. Start with the result or action. Put the explanation second.
2. Ask one concrete question at a time. Say what a useful answer looks like.
3. Name the object: “Check this PDF,” “Save description,” “Run audit.” Avoid “Read,” “Run,” “Apply,” or “Verify” alone.
4. Use short sentences. Aim for one sentence under 20 words for the main instruction; allow extra detail when it prevents a mistake. This is an editing guide, not a mechanical pass/fail rule.
5. Keep essential limits beside the result. “Passed automated checks. Human review is still needed.” must remain visible.
6. Put rule numbers, raw checker messages, code, file hashes, and server instructions in clearly labeled details. Keep page names, affected items, uncertainty, and next actions visible.
7. Distinguish an answer saved, a file changed, a file checked, and a file approved for sharing. Each is a different event.
8. Explain errors with the known problem, its effect, and a workable next step. Never make a raw error code the explanation.
9. Use the same words in buttons, help, activity, downloadable reports, and screen-reader announcements.
10. Do not invent a diagnosis, fix, completion claim, or control to make a sentence sound helpful.

## Shared vocabulary

These are proposed display terms. Internal API values and stored identities stay stable.

| Current term | Proposed operator wording | Meaning to preserve | What landed |
|---|---|---|---|
| Portfolio | Clients | All clients in this organisation | **Applied** (#232). Label only; the code keeps `portfolio`, and the root screen reaches no URL. |
| Journey / recorded path | Audit plan | Saved pages and steps to check | **Cut.** Ordinary testing vocabulary for the concrete thing it names; ~44 files, four stored activity strings, and it needs a translation layer that does not exist — `activity-view.ts` renders the stored action verbatim. |
| Run | Audit; “Run audit” on a button | One execution of an audit plan | **Not attempted.** |
| Record the path | Add steps | The current editor is manual, not a recorder | **Not attempted.** |
| Verify so far | Test saved steps | Tests navigation; does not audit accessibility | **Not attempted.** |
| Findings | Results; “Issues and checks” for the work list | Includes confirmed issues and undecided checks | **Cut.** The console already uses "Results" for the whole run panel, so this would make one word mean two things on one screen; and four activity phrases naming "a finding" are append-only history the route forbids a copy pass from editing. |
| Needs review | Check this item | The software has not decided whether there is a problem | **Cut as a rename** — the current words state the fact, the replacement is an imperative that drops the reason. The real defect underneath was fixed: the printable report said "Needs manual review" where everything else said "Needs review" (#234). |
| Advisory | AI suggestions | Suggestions to review; do not decide the result | **Cut as a rename, fixed as a disclosure** (#234). The badge stays; the section on the client screen now says the judgements are produced by a language model, which the screen never said before. |
| Inconclusive | Could not complete the check | Give the specific capture or execution problem underneath | **Cut.** Precise, standard, and the code value; the replacement is a sentence and one of its three surfaces is a twelve-character chip. |
| Evidence | Saved audit details | Keep “Evidence” as the technical section name if useful | **Not attempted.** |
| Remediate a file | Improve a document | May produce a file with work remaining; does not promise a complete fix | **Not attempted.** |
| Read a document | Check document | Automatic inspection, distinct from a person's review | **Not attempted.** |
| Punch list / gaps | Work remaining | Say whether the operator, document author, or specialist must act | **Not attempted.** |
| Conformant | Passed automated PDF checks | Does not mean all accessibility requirements were checked | **Applied** (#234), as "Passed automated checks" — not for plainness but because the old label claimed conformance while `SCOPE_EXPLAINER` denies it. |
| Changed since read | File changed — check again | Previous answers may no longer apply | **Not attempted.** |
| Pinned to this run | Shows this audit's results | Later audits do not replace these results |
| Issue / revoke a report | Create report link / Turn off link | Creating a link does not send it; disabling it stops access | **Partly.** The revoke control was built (#231) and named **Revoke link**, not "Turn off link": the delivery panel already had that button and the activity log already said "revoked a report link". |

Do not replace “Must fix” with another severity-based promise. Present **confirmed failures, checks for a person, other recommendations, and AI suggestions** separately. Keep impact/priority as secondary information. A result can fail regardless of its impact rating. Preserve all existing severity distinctions in details.

## What the main outputs should look like

### An audit result

Show the result first, then confirmed failures, items needing review, pages checked, and the next action. Put the percentage below this information.

Example, using illustrative counts:

> **Accessibility issues found**
>
> 3 confirmed failures. 8 items need a person to check them.
>
> We checked 5 pages. Start with the confirmed issues below.

For other states, derive the wording from the actual facts:

- **Items need attention:** show separate review and recommendation counts; do not call undecided checks failures.
- **No failures found by automated checks:** still show recommendations and AI suggestions when present. Explain that automated checks do not establish full accessibility.
- **Could not complete the check:** explain the known problem and identify any pages not fully checked. Preserve usable findings from other pages.
- **Audit in progress:** show measured progress only. Do not invent a percentage or estimated finish time.

Score help: “This percentage counts automated checks with a result. It excludes checks needing human review.” Add: “Even a high percentage can include confirmed failures.” An unavailable score should say “Not calculated,” with its reason, rather than relying on an unexplained dash.

### An individual issue or review task

Use the same structure on screen and in reports:

| Part | What it should contain |
|---|---|
| Heading | The specific problem or question in ordinary words |
| Location | Page/document name and the affected item, when recorded |
| Why it matters | A short explanation of the difficulty someone may encounter |
| Next step | An action the operator can take, or the person who needs to help |
| Details | Original checker message, rule reference, selector/code, and evidence |

A **confirmed** missing image description might say: “This image has no description. Add text that explains its purpose.” An **undecided** image check should ask: “Does this description explain the image's purpose?” Neither instruction should claim the software knows what the image means.

For website code changes, make the operator's task “Assign this issue to the website editor or developer.” Keep exact technical alternatives available. “Do one of these” and “Do all of these” must retain their different meanings.

For documents, ask “What should someone who cannot see this image know?” Show the image and nearby source text when available. State when the preview is unavailable. Saving an answer should say “Description saved. Update the PDF to add it.” only when that answer can actually be written by the next action.

### Errors and requests for help

Prefer: “Your report link was not created. Sign in again, then create the link.” for an expired session. An unknown failure needs a neutral message and a support reference, not an invented cause. Show server configuration instructions under “Administrator details.”

“Mark requested” records that someone asked the client; it does not contact them. Use “Record that you asked the client,” with “Contact the client separately” beside it. A future send feature would be separate work.

## Implementation sequence

| Phase | Work | Completion check |
|---|---|---|
| **1. Correct misleading results** | Align console, platform, shared report, and PDF report with the real outcome rules. Preserve `needs-review`. Stop counting critical impact as the definition of a blocking failure. Separate confirmed failures from undecided checks in report sentences and criteria lists. Correct outdated help and Settings claims. | The same example audit means the same thing on every surface; an undecided check is never described as a confirmed failure. |
| **2. Establish shared wording** — **not started** | Add small typed presentation helpers for outcome, action, activity, and error wording under `services/presentation/`. Create a copy inventory with stable IDs, surface, state, current text, replacement, and verification status. Adopt the vocabulary above across navigation and labels. | Every operator-visible state and action has a reviewed entry, including accessible names and fallback messages. **Neither artefact exists: no copy inventory was ever written, and `services/presentation/` holds the same six modules it held before. The per-row grep list in each pull request description served as the inventory instead, at the cost of no new files.** |
| **3. Simplify setup and recovery** | Rewrite setup, discovery, saved audit plans, credentials, scheduling, sign-in, and Settings. Lead with page selection. Put manual selectors and server settings behind advanced/admin details. Add the missing report link control or remove the unsupported instruction. | A novice can add a client, choose pages, start an audit, and recover from a known failure without guessing. |
| **4. Translate audit findings** | Add reviewed explanations for the installed checker rules and their message variants. Separate questions from confirmed defects. Use the issue structure above. Constrain new AI suggestions to plain language and useful next steps. | Every supported rule has reviewed wording or an explicit safe fallback; original evidence and fix alternatives remain available. |
| **5. Simplify document work** | Rewrite intake, preview, every ask kind, saved-answer feedback, limitations, result states, approval, exclusions, and delivery. Separate “saved,” “applied,” “checked,” and “approved.” | A novice can identify what they can answer, what the author must supply, whether the PDF changed, and whether it can be shared. |
| **6. Finish reports and verify comprehension** | Apply the same wording to shared pages, printed/PDF reports, download failures, activity, and delivery summaries. Add a readable guide to delivery archives; preserve technical evidence files. Test the complete tasks with staff who have no accessibility training. | No contradictory results or orphan instructions; staff can explain the result and choose the next action without coaching. |

Phases 1–2 precede the rest. Audit findings and document work can then proceed independently against the shared wording. Give each phase one reviewable change set rather than rewriting the whole interface at once.

## Work that wording alone cannot solve

- **Manual browser steps:** ordinary language cannot remove the need to know a CSS selector. Keep simple page audits usable now; scope guided element selection or interaction recording separately. Do not label the present editor as recording.
- **Unlocated findings:** do not fabricate an affected element when a checker returned only a page-level notice. Explain that the check applies to the page.
- **PDF structure edits:** recording a judgement does not change document structure. A decorative-image decision must not claim it has hidden the image from screen readers.
- **Missing recovery controls:** add the real action or name the person who can help. Copy must not direct someone to a button that does not exist.
- **AI availability:** no suggestions can mean nothing was found or the AI check did not run. A distinct availability message needs a recorded status; it cannot be inferred from an empty list.
- **Document approval:** settle what “sign off” means before rewriting the confirmation. The operator must know what they are approving; do not imply that all manual accessibility checks occurred. A created sharing link must not be labeled as proof that a client received the files, and a revoked link must not read as currently available.

## Engineering and verification

Keep checker evidence, API codes, finding identities, stored decisions, and report snapshots intact. Translate at presentation boundaries. Audit and repair decisions remain in their existing domain/services logic; wording must not create a second decision engine.

Use curated templates for deterministic findings, keyed by rule, result kind, and supported variant. Preserve dynamic measurements. A missing template should ask for specialist review and expose the original message; it must not guess a fix. AI is not needed to rewrite every result at runtime.

Document asks currently share positional identities with the work list. Prefer structured ask data for wording; preserve that pairing and legacy summaries. Any new structured fields should be additive. Do not silently rewrite already-issued report records or historical activity. For historical reports whose rendering is corrected, distinguish a wording correction from a changed audit result and preserve traceability.

Test the dangerous distinctions, not just exact strings: a low-impact confirmed failure; a critical recommendation with no gating criterion; review-only findings; AI-only suggestions; mixed complete/incomplete page evidence; partial coverage; old records missing metadata; answers saved but not applied; a file changed since answers; a decorative decision with no PDF edit; automated PDF checks passed but human review outstanding; expired links and unavailable downloads. Verify the same facts across every relevant output.

For implementation, run the repository's required checks: `npm test`, `npm run typecheck`, `npm run test:browser`, `npm run test:db`, `npm run chaos`, `npm run build`, and `npm run test:hydration`; include document checks for affected document paths. Run a real audit through `next start`. Verify visible labels, screen-reader names, errors, narrow layouts, and printed output.

Then ask at least five representative staff members to complete: first audit, review a result, answer a document question, recover from a failure, and share an output. Proposed acceptance target: at least four of five complete each supported routine task without coaching, and nobody mistakes an unchecked item for a pass, a review item for a confirmed failure, or a saved answer for a changed PDF. Specialist tasks pass when the operator correctly identifies who must help. These are future acceptance criteria, not measured results.

The implementation pass has run the required unit, typecheck, lint, production build, browser (115 tests), hydration (51 tests), database (141 tests), document (69 tests), and chaos checks. *(corrected: those are counts measured on the branch at its tip, not on master. They are left as written because they were true when written; master's hydration suite is 52 as of 2026-09-10, and the others move with the tree. A count in a dated document is evidence of a moment, not a current fact.)* The browser-facing checks required the runner's elevated local-process permissions for listeners and Chromium. No usability study has been run. The evidence audit records source inspection, not a claim that every runtime message or deployed screen was exercised.
