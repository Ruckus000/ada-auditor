# ADA Auditor: language audit evidence

> **Landed on master 2026-09-10, with corrections.** This document was written
> on the branch `codex/plain-english-audit` and describes that branch, which is
> not on master and was never merged — merging it would have reverted work
> master has since done differently. Every claim below about what "now" exists
> refers to the branch unless a note says otherwise. The counts, the status
> line, the phase table and the vocabulary table have been annotated in place
> to say what actually landed. Nothing else has been rewritten: this is a
> record of what was proposed, not a description of the product.


**Reviewed:** September 8, 2026, source at `0d6fea0`.
**Reader:** General staff with no accessibility training.
**Method:** Direct source review of operator screens, shared outputs, message generators, presentation helpers, and their data paths. No DesignOps workflow was used for this audit. The audit preceded the implementation pass documented in the companion plan. *(corrected: "the current branch" was `codex/plain-english-audit`, which never merged. On master, A01–A04, A06 and A34 are fixed by different code, so the "current wording" quoted below is in several places no longer current — see the companion plan's status note.)*

This is a system-wide content assessment by output family, not a completed inventory of every possible generated string. It identifies systemic problems and representative examples for the implementation plan. No deployed click-through, user study, live customer audit, or fresh application test run was performed. Existing untracked files under `Remediation-Design/` were left untouched and were not treated as production screens.

## Coverage

Source locations below are relative to the repository root. Line references identify the inspected revision.

| Output family | Sources inspected | Work needed |
|---|---|---|
| Navigation, client list, client overview | `src/app/platform/components/{header,portfolio}.tsx`, `client/{client-shell,client-overview}.tsx` | Replace workflow jargon; clarify result versus priority; make next steps explicit. |
| Client setup and first audit | `src/app/platform/components/setup/` | Distinguish selecting pages, adding steps, testing steps, and running an audit. |
| Discovery and saved audit plans | `client/{discover-pages,client-journeys,journey-steps-editor,journey-schedule,run-journey-button}.tsx` | Plain labels, advanced technical inputs, understandable progress and recovery. |
| Sign-in and saved login details | `src/app/components/unlock-card.tsx`, `passkeys-card.tsx`, journey editor | Keep staff instructions separate from account administration. |
| Audit outcomes, counts, evidence | `src/services/presentation/{verdict,severity,page-evidence}.ts`, platform screens and console | Correct outcome inconsistencies before shortening copy. |
| Findings, assignment, decisions | `client/{client-findings,assign-control,triage-control}.tsx`, `src/services/{findings-view,deterministic-audit,htmlcs-audit}.ts` | Reviewed explanations and action ownership; preserve uncertain results and alternative fixes. |
| AI-generated suggestions | `src/services/ai-advisory.ts` | Plain-language output contract; useful action; distinguish unavailable from empty only when status is known. Actual live model prose was not sampled. |
| Document intake, preview, work list | `client/{document-intake,document-inventory,document-workbench,document-shared}.tsx`, `document-reader.tsx` | Concrete questions and meaningful states; separate a person's judgement from an edit to the file. |
| One-off document improvement | `remediate-file-screen.tsx`, `client/document-run-result.tsx` | Explain what is saved, what is temporary, and which work requires a client record. |
| Generated document explanations | `src/domain/document-remediation.ts`, `src/services/presentation/document-verdict.ts`, document action/error helpers | Translate every ask and refusal kind, including old records and unsupported repairs. |
| Document approval and delivery | `client/document-delivery-panel.tsx`, `src/services/{document-delivery,presentation/document-delivery}.ts` | State exactly what was approved and included; keep technical verification available. |
| Client-facing web and PDF reports | `src/app/r/[token]/shared-report.tsx`, `src/services/{report-html,report-view,document-report}.ts` | Correct failure claims; reuse wording; separate work from evidence. |
| Delivery link and archive | `src/app/d/[token]/`, `src/services/document-delivery.ts` | Readable archive guide and work history; usable download-error pages. Preserve evidence JSON. |
| Settings, errors, and activity | `settings-screen.tsx`, `src/services/{deployment-config,activity-view}.ts`, copy helpers and API consumers | Staff-facing status; administrator details; translate event/error codes. |
| Console, help, and practice | `src/app/components/{glossary,run-form,verdict-panel,findings-list,audit-types,practice-scenarios,control-plane,status-rail}` | Correct stale semantics and distinguish practice from real client work. |
| Administrative output | `scripts/operator.ts`, `.github/workflows/failed-runs.yml` | Keep commands and machine IDs; add understandable human summaries where operators receive them. This was a spot check, not a full operational-runbook audit. |

## Fix first: wording that can change a decision

**A01 — “Critical” is still presented as the rule for failing an audit.**

`src/app/components/verdict-panel.tsx:18` says “Evidence was complete, and no critical rule-based issues were found.” The fail branch at line 26 makes the inverse claim. `src/app/components/glossary.ts` repeats this in pass, fail, severity, and blocksCi help. `src/app/components/findings-list.tsx:28` and `src/app/components/audit-types.ts:294` actually classify blocking findings by critical severity. `src/services/report-html.ts:268` independently counts them that way.

The current rule in `src/services/reporting.ts` uses the finding's A/AA conformance level, excludes `needs-review` and AI suggestions, and requires complete evidence for the run verdict. This is a rendering/data-mapping correction as well as a copy change. Reuse a single authoritative classification. Do not derive “must fix” from impact and imply that it explains the result. Proposed heading: **“Accessibility issues found.”** Give the actual confirmed-failure count and a separate priority label.

**A02 — The console turns human-review items into minor problems.**

`src/app/components/audit-types.ts:100` lists four severities without `needs-review`; the fallback at line 109 is `minor`. `src/app/components/findings-list.tsx:17` calls Minor “Small problem. Fix when convenient.” An undecided result is therefore assigned both a diagnosis and a low priority that the checker never supplied. Preserve `needs-review` throughout parsing, grouping, counts, and help. Display **“Check this item”** with a concrete review question. This is directly evident from the source; browser reproduction remains an implementation check.

**A03 — A shared report can call undecided checks confirmed failures.**

`src/services/report-view.ts` includes deterministic `needs-review` findings in public page findings. `src/app/r/[token]/shared-report.tsx:34` collects criteria from all those findings; line 107 calls the total “barriers” and says each has a criterion it “fails”; line 115 heads the resulting list “Success criteria not met.” There is no severity filter in that aggregation. An undecided item can therefore enter a list asserting a failed requirement. Separate **“Confirmed failures”** from **“Items needing review”** and list their criteria separately. Do not merely rename the combined list.

**A04 — The PDF report's risk paragraph overstates what was proved.**

`src/services/report-html.ts:54`: “Automated checks found failures against the WCAG success criteria checked here.” The `risk` state can arise solely from `needs-review` findings (`src/services/presentation/verdict.ts`). Use **“Some items need attention”**, followed by counts and descriptions derived from what is actually present. Do not describe all recommendations or undecided checks as failed criteria.

**A05 — Review items receive “Fix” instructions before a problem is confirmed.**

`src/services/htmlcs-audit.ts:227` takes the first sentence of the checker message as the title, then puts the full message in `allOf`. Every finding from this mapper is `needs-review`. `src/app/platform/components/client/client-findings.tsx` renders these under “Fix all of these”; the public report repeats the pattern. Use **“What to check”** for undecided results and **“How to fix it”** for confirmed defects. Retain the original checker instructions in details.

**A06 — Report sharing points to a missing action.**

`src/app/platform/components/client/issue-report.tsx:67` says “Revoke it from Reports.” `reports-screen.tsx` displays an open link or revoked status, but provides no revoke control. The document-delivery revoke button applies to a different resource. Add an audit-report **“Turn off link”** control using the existing report API, or replace the instruction with a genuinely supported action. Proposed creation feedback: **“Report link created. Anyone with the link can read this audit. Later audits will not change these results.”**

**A07 — A document status sounds like complete accessibility approval.**

`src/services/presentation/document-verdict.ts:39` says “PDF/UA: compliant (veraPDF)”; line 95 labels a state “Conformant.” The same module explains that human checks remain beyond automated coverage. Lead with **“Passed automated PDF checks.”** Keep a short visible human-review limitation and the exact checker result in details. Document approval and eligibility for delivery must remain separate from this label.

## Replace explanations with actionable language

These are proposed edits, not changes already applied. Text in quotation marks is an existing excerpt unless explicitly marked as a replacement.

| ID | Source | Current wording | Proposed replacement or design action |
|---|---|---|---|
| A08 | `src/app/platform/components/setup/where-screen.tsx:239` | “Start with the homepage (recommended) — one page, audited now.” | **“Check this page only (recommended).”** The entered URL can be a deeper page, and the next action saves setup rather than auditing immediately. |
| A09 | `src/app/platform/components/setup/steps-stage.tsx:17` | “Record the path” | **“Add the steps to check.”** No interaction recorder exists here. |
| A10 | `src/app/platform/components/setup/steps-stage.tsx:19` | “then say what ‘arrived’ looks like” | **“Add a final check to confirm the task worked.”** Explain that testing steps is separate from an accessibility audit. |
| A11 | `src/app/platform/components/client/journey-steps-editor.tsx:360` | “Does”; “Action”; “Path”; “Selector” | “Step,” “What this action does,” “Page address,” “Element selector (advanced).” Plain names are only an interim improvement: keep this configuration out of the novice's default path. |
| A12 | `src/app/platform/components/client/journey-steps-editor.tsx:614` | “This journey never says it arrived.” | **“Add a success check to confirm sign-in worked.”** Retain the consequence: the audit could otherwise check the sign-in page. |
| A13 | `src/app/platform/components/client/discover-pages.tsx:491` | “Discover pages” | **“Find pages to audit.”** Explain selecting pages before introducing a saved audit plan. |
| A14 | `src/app/platform/lib/run-failure-copy.ts:32` | “This journey is not in the run contract’s scope, so the run was refused.” | **“This audit is not allowed with the current settings. Ask your administrator to check its permissions.”** Do not imply a permission editor exists. |
| A15 | `src/app/platform/components/client/client-findings.tsx:67` | “Evidence for this run was”; “not a clean bill of health” | **“Some pages could not be fully checked. These results cover only the pages we could check.”** Add the actual cause and a relevant action when available. |
| A16 | `src/services/presentation/verdict.ts:126` | “The percentage is the share of evaluated automated checks that passed” | **“This percentage counts automated checks with a result. It excludes checks needing human review.”** Keep it secondary to the outcome. |
| A17 | `src/app/platform/components/reports-screen.tsx:26` | “Each one is pinned to the run it was issued from, so a link keeps meaning what it meant when it was sent.” | **“Each report shows one audit. Later audits do not change its results.”** |
| A18 | `src/services/presentation/document-verdict.ts:130` | “a run would advance it” | **“Ready to update the PDF.”** Choose a more specific action from the actual conversion/repair path; do not use this on inspection-only work. |
| A19 | `src/app/platform/components/remediate-file-screen.tsx:298` | “One file in, one file out. Nothing is recorded here and no one is attributed” | **“Improve a file and download the result. To save the work history, open the document under a client.”** Check the full upload/result flow before claiming exactly what is retained. |
| A20 | `src/domain/document-remediation.ts:1077` | “The document declares no language — name the one it is written in, because a language is never guessed” | **“What language is this document written in?”** Helper: “Choose the language used for most of the text.” Keep no automatic selection. |
| A21 | `src/app/platform/components/client/document-shared.tsx:185` | “Its text reads as”; “matches”; “A suggestion — nothing is chosen for you.” | **“This document may be in Spanish. Check the text, then choose its language.”** Show only when Spanish is the actual suggestion; move algorithm match counts to details. |
| A22 | `src/app/platform/components/client/document-workbench.tsx:382` | “stays on the punch list until it is artifacted” | **“This saves your decision only. A PDF editor still needs to mark the image so screen readers skip it.”** Do not promise the app performs that edit. |
| A23 | `src/domain/document-remediation.ts:1225` | “Heading levels skip from H… to H… — decide whether the author meant an H…” | **“Does this heading belong directly under the previous section?”** Show the actual headings and hierarchy when available. Route changes to the author or PDF editor; a recorded answer alone changes no heading. |
| A24 | `src/domain/document-remediation.ts:564` | “an embedded font's character-set table (CIDSet) does not list every character the document uses” | **“The PDF's font information is incomplete. Ask the document author to export a new PDF with complete font information.”** Keep exact CIDSet details for the specialist; never merge this with the distinct missing-font case. |
| A25 | `src/app/platform/components/client/document-workbench.tsx:485` | “Mark requested” | **“Record that you asked the client.”** Add “Contact the client separately.” The answers route records a disposition; it does not send a message. |
| A26 | `src/services/presentation/document-delivery.ts:28` | “This output is not eligible. Apply outstanding answers and verify the remediated file first.” | **“This PDF is not ready to share. Apply the saved answers, then check the updated PDF.”** Where the actual cause differs, name that cause rather than using one generic diagnosis. |
| A27 | `src/app/platform/components/settings-screen.tsx:37` | “Configured where the app is deployed, not here. Change these with environment variables and redeploy.” | **“These settings are managed by your administrator.”** Show capability and consequence first; preserve setup commands under Administrator details. |
| A28 | `src/app/platform/components/passkeys-card.tsx:169` | “Passkeys are off on this deployment. Set AUDITOR_RP_ID and AUDITOR_RP_ORIGIN to turn them on.” | **“Passkey sign-in is unavailable. Use your password, or ask your administrator to enable passkeys.”** |

## Output sources that need systematic treatment

**A29 — Checker prose is passed straight through.** `src/services/deterministic-audit.ts:220` uses `rule.help` as the title and `failureSummary` as the message. `remediationFor` at line 249 copies check messages into fix lists. The platform displays titles, rules, WCAG references, selectors, and HTML in each expanded row. There is no general-staff explanation layer. Build a reviewed rule/variant catalog, with human impact and the operator's next action. Keep original diagnostics available. Review both violation and incomplete forms of each supported rule; a generic rule name is not enough to choose the right instruction.

**A30 — AI's output contract asks for an issue, not a usable task.** `src/services/ai-advisory.ts` asks for “one or two sentences, naming the element it affects,” but does not require ordinary language or a next step. Add those requirements and validation/evaluation examples. Avoid claiming a numeric confidence is a measured probability of a real defect. Existing stored messages need a safe display fallback; do not alter their evidence or invent a rewritten explanation. No live model response was evaluated in this audit.

**A31 — Errors bypass existing plain-language helpers.** `client/{issue-report,assign-control,triage-control}.tsx` render `parsed?.error` directly; schedules and the journey editor also fall back to raw codes. A staff member may see `unauthorized` or `invalid_request_body`. Add action-specific error mappings with a safe unknown fallback and a support-reference detail. Preserve API codes. Download endpoints under `/r/.../documents/...` and `/d/.../download` return JSON failures to browser navigation; add a readable error response appropriate to that channel while retaining machine behavior where required.

**A32 — Activity displays machine event names.** `src/services/activity-view.ts` passes `event.action` through. Producers include `document_answered`, `delivery.revoked`, and `document.exclusion-reversed`. Translate known codes for display and use document/client names where available. Example: **“Jordan answered a document question.”** Keep the recorded event untouched, retain older prose events, and never describe a recorded request as a message sent.

**A33 — A delivery archive starts with technical evidence, not reading guidance.** `src/services/document-delivery.ts:160` builds a work log with raw actions such as `answer.declared`; lines 191–194 add `manifest.json`, `attestations.json`, and `work-log.csv`. Individual PDFs use `document-1.pdf` style names, mapped in the manifest. Add a readable contents summary mapping file names to source names, explaining what was changed, what was approved, and why other files were omitted. Add human-readable activity descriptions alongside stable codes. Keep machine verification, hashes, and declarations intact and respect existing public/private content boundaries.

**A34 — Settings contains outdated operational reassurance.** `src/services/deployment-config.ts:104` says a serverless function has neither JVM nor LibreOffice and their absence is expected. This conflicts with the repository's present bundled-runtime design. Describe measured capabilities: **“Word conversion is unavailable”** or **“PDF checking is unavailable,”** followed by an administrator action. Do not tell operators to ignore a missing capability because of an old hosting assumption.

**A35 — Good structure already exists, but its prose should be shorter.** `src/services/presentation/triage.ts` distinguishes “Not a barrier” from “A barrier the client accepts,” asks a different justification for each, and avoids a default decision. Preserve this distinction. Existing page grouping, image previews, separate any/all fix lists, and typed document states are useful foundations. Rewriting them into a single generic “Done” or “Fix” action would lose information.

**A36 — “Delivered” means a sharing link was created.** `src/app/platform/components/client/document-delivery-panel.tsx:82` displays “Delivered,” and line 88 says “Current output delivered.” `src/services/document-delivery.ts:95` derives this from a bundle's `issuedAt`, not a recipient opening or receiving it. The expression does not check revocation either. Display **“Sharing link created”** as the recorded event, with current link availability separately derived from the link state. Do not claim “Available to client” for a revoked link or “Received” without evidence of receipt.

**A37 — Approval explains the server's work, not the operator's decision.** `src/app/platform/components/client/document-delivery-panel.tsx:104` says “The server rechecks the output, source identity, verification, and outstanding answers before recording your sign-off.” Specify what the operator is approving before choosing the final label. **“Approve for sharing”** is a candidate if that matches the intended scope; it must not quietly introduce an assertion that the operator completed every manual accessibility check. Keep this as an explicit product decision in phase 5.

**A38 — Repair refusal starts with PDF internals.** `src/services/document-repair.ts:144` says “this PDF has no structure tree, so there is nothing to transcribe.” Replace the main instruction with **“We cannot repair this PDF automatically. Upload the original Word document, or ask an accessibility specialist to add the reading structure.”** Keep tags and transcription details optional. Also remove “Nothing is wrong with the document” from unavailable-tool messages in `src/app/platform/lib/document-action-copy.ts:90`: a processing outage establishes nothing about the file's condition.

## Review order and remaining evidence

Start with A01–A07 and A36–A37 because they can change what an operator believes or does. Then address recurring sources A29–A34 and the everyday instructions A08–A28 and A38. Retain the useful distinctions in A35.

The implementation inventory must also cover loading, empty, partial, retry, disabled, unsupported, stale, revoked, and old-record states; tooltips; browser titles; screen-reader-only text; placeholder/example values; validation errors; and generated fallback text. A string search alone will miss dynamic checker output and conditional text.

Before calling the work complete, exercise representative outputs in the built app and printed reports, then test comprehension with the intended staff audience. The proposed acceptance criteria and engineering sequence are in `2026-09-08-plain-english-plan.md`.
