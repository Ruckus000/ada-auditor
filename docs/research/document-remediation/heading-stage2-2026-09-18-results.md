# Heading suggestions — Stage 2: suggestions through the answers channel, approvals as labels

**Plan (the registration):** `docs/superpowers/plans/2026-09-18-stage2-approval-labels.md`, copied unchanged from the coordinator worktree and committed at 57750b7. **Model:** adapter-r10 at its registered operating point, score ≥ 0.9933 (`heading-stage1-r11-2026-09-18-results.md`). **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md`.

> **Zero real human-answer labels exist yet.** This round built the path by which a person's decision becomes a label. The Stage 2 gate (accuracy lower bound ≥ 0.99, FP upper bound ≤ 0.01, abstention ≤ 10 %) is **unchanged** until a person answers in the workbench. Every model number cited here is graded against Claude-audited labels. Test has never been evaluated.

## Why Stage 2
Stage 1's levers that need no new labels are measured dead ends: surface rules (r8), more audited training labels (r9), a prompt fact (r11) and more epochs (r12). The only label source that can move the gate's bounds and its abstention rate is a person's approval of the model's suggestions, recorded with provenance.

## The sidecar contract (Task 1, `experiments/qwen-role-decisions/labels/suggest.py`)
`python3 -B -m labels.suggest --pdf <file> --adapter out/stage1/adapter-r10 --threshold 0.9933 --python <mlx> --out <sidecar.json> [--all-blocks]` produces:

```
{ document, threshold, page_base: 0,
  coverage: { blocks_total, cards_considered, not_heading_confident, selector },
  cards: [{ card_id, locator: {page, x0, y0, x1, y1}, text, type, level, rule, score,
            decided_by, proposed, depends_on: [card_id, …] }] }
```

- `proposed` equals `score ≥ threshold`. Rule-decided rows score 1.0.
- `depends_on` lists the prior cards whose H decisions were in this card's approved-headings stack. The stack is built from the **model's own prior decisions**; there is no key for an untagged PDF.
- `page_base` is 0, so the product adds 1 for display.
- **Cap:** `--all-blocks` considers every text block when `blocks_total ≤ 600`, about a 20-minute wall-time budget at roughly 2.1 s per model card. Above that it falls back to the likely-headings + 5 % selector, and `coverage.selector` says so. The cap is calibrated on one document; it is a budget, not a guarantee.
- **Commits:** 2b5bb40, 1ed1007, eea6fa2. 138 label tests pass.

### The one document: c3-0128
6 pages, no structure tree, in no split, its host unassigned. **Cohort 6 could not supply an untagged file**: its harvest kept only PDFs with `/StructTreeRoot` and a heading tag, so all 301 cohort 6 PDFs are tagged.

| Run | Cards considered | Proposed | Asked (below threshold) | Rule / model | Wall time |
|---|---|---|---|---|---|
| Likely-headings + 5 % | 17 of 185 blocks | 15 | 2 | 1 / 16 | 46.5 s |
| `--all-blocks` | 185 of 185 | 174 | 11 | 19 / 166 | 397.7–405.7 s |

- The all-blocks run is **10.9×** the default's cards and 8.6× its wall time; this is what triggered the cap.
- On the 17 cards both runs share, type and level agree.
- **Stage 2b's motivating example:** the document's only H1 is below threshold in both runs and sits in the `depends_on` of 184 of 185 cards. One answer on that card makes almost every other suggestion's stack stale. Re-predicting after answers is Stage 2b, not this plan.

## The ask policy (product contract)
Every block is considered, so coverage is honest. An ask is raised only for:
- (a) cards predicted **H at any score**;
- (b) **every below-threshold card** of any type.

Proposed non-H cards count as `not_heading_confident` in coverage and are never asked one by one; they are never labels, since model output is never a label. On c3-0128 all-blocks this gives **185 considered = 163 not asked + 22 asks**. The 22 are 11 proposed H2 (one-click accepts), 3 below-threshold H and 8 below-threshold non-H.

## Task 2 — suggestions in the answers channel
Branch **`claude/heading-suggestion-asks`** in the product repository, from master 64a1382. **Not merged and not pushed.** Commits 486ebef, 2ea8734, 6512498, 01e21f0, 82aedec.

- **Delivery:** an optional multipart part `headingSuggestions` beside the PDF, size-capped and zod-validated. The refine requires `proposed === score ≥ threshold`, and violations are refused as 400 `invalid_heading_suggestions`. The part is stored inside the inspection's existing `summary` jsonb — **no new table, no new column**. `src/` never resolves a path into `experiments/`.
- **Asks:** `heading-card:<card_id>`, kind `heading`, criterion 2.4.10, raised by `needsIn` and tied to the reading's `input_sha256`. They are separate from the existing `heading:<index>` level-skip asks.
- **No document text in the database:** target = `{page, box, suggested: {type, level, rule, score}, dependsOn?}`. Text and the sidecar's `document` name are dropped at parse. The workbench shows each card on the rendered page, through the existing preview route, with its box drawn.
- **Workbench:**
  - one-action accept for proposed H, **never preselected**; nothing is stored until a person acts;
  - every suggestion shows its §4 rule and ISO type;
  - disposition `decided` only (`declared` is refused);
  - "assumes the heading above is a heading" shows only while a dependency's ask is open;
  - a coverage line: "N of M text blocks considered; K judged not headings with confidence and not asked".
- **Client report:** heading-card asks are **excluded from the public client report** (operator review work, not client actions). A test pins it: N asks add N workbench items and 0 report lines.
- **Derived state:** open heading-card asks read as `needs-answers` through the existing open-ask rule.
- **Additions beyond the brief, reviewed and accepted:** `Preview.java` now also reports page size in points (needed to scale the box); the pinned preview is offset 150 px (it hid "Fold page" and failed the hydration a11y check).
- **Gates:** lint 0; typecheck 0; `npm test` 2,518 passed; `test:browser` 115; build 0; `build:documents` 17 classes; `test:documents` 72; `test:hydration` 53; chaos green.
- **`test:db` is owed** on the dedicated Neon branch before any merge. This worktree has no `.env.test.local`, so the new store round-trip has run on the memory store only.
- **Known gaps (not fixed in this plan):**
  - the sidecar attaches through the API only, with no UI control;
  - re-inspecting the same bytes without a sidecar drops the card asks, though stored answers remain;
  - box placement is unverified on cropped or rotated pages.

## Task 3 — answers → human-answer labels (`labels/export_answers.py`)
- **Input:** a JSON dump of `document_answers` rows. It keeps kind `heading`, `heading-card:*` and disposition `decided`, and takes the latest per (document, input_sha256, ask_id).
- **Output:** `human-answer` rows. A rejected suggestion becomes the reviewer's stated type, never silently H. Rows whose dependency is unanswered or rejected are excluded and counted. An unanswered card is never a label.
- **Grouping (registered):** `client_id` and `template_id` = `host_of(document url)`, the same function the keys manifest uses. `document_sha256` = the original upload's content sha. A row without a url is refused, with no fallback to platform ids. So a product document from a keyed host, or a product host later harvested into keys, groups with that host and cannot leak across splits.
- **Synthetic proof, not labels:** actor `synthetic-fixture-reviewer`, text-free fixture, output only to the scratchpad and never to `out/labels/`. 24 rows read, 22 decided, 21 latest per ask, **15 emitted**, excluded 5 (dependency unanswered) + 1 (dependency rejected). `split --keep` of `split-keys-all-4` on scratch copies: train 7,051 → 7,066, validation 1,525 and test 2,325 unchanged, the 15 rows landing together as one new group, **0 kept ids moved**. Host-collision, reverse-harvest (www and port variants included) and missing-url refusal are pinned by unit tests; 24 exporter tests, 162 label tests pass. A row missing its url or content sha is refused even if it would have been excluded for a dependency — strict by design.
- Commits: 350f51f, 5acddc9 (grouping by host).

## State at the end of Stage 2's build
- **Model:** adapter-r10 at score ≥ 0.9933.
- **Product path:** built and gated, awaiting `test:db` and a merge decision.
- **Label path:** built and proven on a synthetic fixture.
- **Real human-answer labels: 0.** The next step is a person answering heading-card asks in the workbench on real untagged documents. The exporter then folds those answers, and the Stage 2 gate is re-measured on them (plan Task 4).

## Task 5 — r10 on untagged PDFs from the wild (registered before measurement)
Every validation number so far comes from **stripped copies of tagged PDFs**, which skew toward good producers. The market is untagged PDFs. This task measures r10's suggestions on that population. It involves no training, no product code and no test data.

- **Population:** 10 untagged cohort 3 PDFs whose hosts appear in no split — c3-0128 plus 9 more, chosen with seed 20260918 from cohort 3 files that have no structure tree and ≤ 600 blocks, so `--all-blocks` applies. The host list is recorded.
- **Run:** `labels.suggest --all-blocks`, adapter-r10, threshold 0.9933, per document. Record cards, proposed, asked, `not_heading_confident` and wall time.
- **Audit cards:** blind, ids only, images rendered from the same pages the sidecars used. Groups (r10's type, level, score and `proposed` are recorded in the groups file only):
  - **ASKED_ALL** — every asked card: predicted H at any score, plus every below-threshold card;
  - **NHC_SAMPLE** — 4 `not_heading_confident` cards per document (40), to test the "confidently not a heading" claim in the wild.
- **Judged as claude-audit** and disclosed as such. These are **not** human-answer labels, and they never enter labels-audited or any split.
- **Registered prediction:**
  - precision of proposed-H suggestions **≥ 0.90**;
  - hidden-heading rate in NHC_SAMPLE **≤ 0.05** (≤ 2 of 40).
- **If either fails,** the record states that the wild population differs from the stripped one and by how much, and Stage 2's operating point is marked "measured on stripped PDFs only".

### Task 5 — population and runs (measured; judging pending)
**Deviation from the registration, recorded before judging.** The pool was narrowed to cohort 3 PDFs with **1–600** text blocks, not "≤ 600". Of the 271 untagged, host-clean candidates the tagger could process, **151 (about 56 %) are scanned images with no text layer (0 blocks)**. A literal draw would have spent 6 of the 9 picks on documents r10 cannot read at all.

That is itself a finding for the product: **more than half of the untagged market sample has no text layer**, and neither r10 nor any text-layer path can help with it without OCR. A further 5 files produced no tagged copy (4 encrypted or corrupt; 1 hung the tagger for more than 15 minutes and was killed), so a product path that runs the tagger needs a timeout.

**Population:** 10 documents from 8 hosts, none in any split: westminstermd.gov, buncombenc.gov ×2, ehamptonny.gov, newberlinwi.gov ×2, nantucket-ma.gov, alpinecountyca.gov, otsegomn.gov and klamathcountyor.gov. The registration did not require distinct hosts, so the sample is not host-independent.

| Document | Pages | Blocks = cards | Proposed | Asked | Not-heading-confident | Rule / model | Wall time (s) |
|---|---|---|---|---|---|---|---|
| c3-0128 | 6 | 185 | 174 | 22 | 163 | 19 / 166 | 405.7 |
| c3-0429 | 10 | 273 | 237 | 50 | 223 | 118 / 155 | 474.8 |
| c3-0252 | 9 | 196 | 175 | 23 | 173 | 24 / 172 | 503.3 |
| c3-0825 | 1 | 53 | 38 | 15 | 38 | 1 / 52 | 116.9 |
| c3-0094 | 4 | 60 | 50 | 16 | 44 | 0 / 60 | 137.9 |
| c3-0794 | 8 | 135 | 122 | 15 | 120 | 30 / 105 | 253.9 |
| c3-0650 | 1 | 17 | 15 | 3 | 14 | 0 / 17 | 47.1 |
| c3-0489 | 6 | 47 | 26 | 21 | 26 | 6 / 41 | 107.1 |
| c3-0827 | 4 | 243 | 233 | 10 | 233 | 159 / 84 | 331.0 |
| c3-0437 | 1 | 23 | 16 | 7 | 16 | 0 / 23 | 58.2 |
| **Total** | 50 | **1,232** | **1,086** | **182** | **1,050** | **357 / 875** | **2,435.9 (40.6 min)** |

- **Speed:** about 2.8 s per model card including one model load per document. The cap assumed 2.1 s.
- **Asks:** 182 across 50 pages. 36 are proposed H, 41 are below-threshold H, and **105 are below-threshold non-H** (P 95, TH 8, Lbl 2).
- **Rules are heavy on two documents:** they decide 159 of 243 cards on c3-0827 and 118 of 273 on c3-0429.
- **Audit set:** 222 blind cards — ASKED_ALL 182 and NHC_SAMPLE 40 (4 per document; 29 model-decided and 11 rule-decided, so the "confidently not a heading" rate is scored both with and without the rule rows). Files: `out/labels/audit-s2wild-cards.jsonl` (ids only), `audit-s2wild-groups.json` (r10's predictions) and `audit-s2wild-source.jsonl` (card facts and images; contains text, gitignored, never quoted).

### Task 5 — results (claude-audit, disclosed; not labels)
`out/labels/audit-s2wild-claude.jsonl` holds 222 rows, judged by the reviewing Claude session from the images. These are **not** human-answer labels, and they never enter labels-audited or any split. The controller recomputed every count below.

- **17 rows are Unsure, all on c3-0489**, and are excluded from every count. c3-0489 is a scanned form whose text layer is OCR garbage: the tagger produced blocks for it, but neither the model nor the judge could read them. It is recorded as a document that has a text layer and is still unreadable.

**Registered predictions — both HELD.**
- **Proposed-H precision: 36 / 36 = 1.00** (exact 95 % lower bound 0.903) against ≥ 0.90. Every proposed heading, across the 6 documents that proposed any, is a real heading.
- **Hidden-heading rate in NHC_SAMPLE: 0 / 37** (0/27 model-decided, 0/10 rule-decided; exact 95 % upper bound 0.095) against ≤ 0.05. The point estimate holds. On 37 cards the upper bound does not reach 0.05.

**The asked pool, where the reviewer's work lands:**

| Asked group | Judged | Real headings | The rest |
|---|---|---|---|
| Proposed H | 36 | 36 | — |
| Below-threshold H | 41 | **39** | P 2 |
| Below-threshold non-H | 91 | **26** | TH 35, P 17, Artifact 4, Caption 3, Lbl 3, Other 3 |

- r10's uncertain heading calls are almost all right, 39 of 41, so a one-action accept on them is well founded.
- The 26 under-called headings, mostly form section headings and roman-numbered policy sections, all sit **in the asked pool**, and none sit in the confident-not-heading pool. The asks catch the misses, at the cost of 65 non-heading asks, 35 of them table-header cells.

**Reading.** On this wild sample the operating point transfers: there is no confident error in either direction, and the whole error mass is under-calling below the threshold, exactly where the asks route it. **The population, not the model, sets the ceiling.**
- 56 % of untagged cohort 3 candidates are image-only and need OCR.
- 1 document in 10 has a text layer that is OCR garbage.
- 5 of the draw's candidates could not be processed.
- About 2.8 s per model card.
- TH cells dominate the false asks.

**Registered for a later plan, not built now:**
- (a) **A TH veto at ask time**, from the existing table-ancestry fact. It would remove up to 35 of the 91 non-H asks here.
- (b) **An OCR-quality gate before `suggest` runs**, so c3-0489-style documents are refused with a reason instead of asked about.

## Task 6 — the table-box veto at ask time
**Rule (registered and ruled before implementation).** A card inside a table box whose predicted type is not H raises **no ask**, whatever its score. It counts in `coverage.not_heading_confident` and in the sub-count `coverage.table_vetoed`. A card inside a table box that the model predicts H is still asked: the model's H overrides the veto. That branch fires on no wild row, and is kept and tested for the case the next sample may contain.

**Premise correction, recorded.** The veto was proposed on the belief that the one real heading among the in-table asks would survive through the H-override branch. It does not: r10 predicted all 32 in-table asks non-H, including that heading.

**Measured on the 10 wild documents**, recomputed from the stored predictions with no model run:

| Document | Asks before | Asks after | `table_vetoed` |
|---|---|---|---|
| c3-0128 | 22 | 22 | 0 |
| c3-0429 | 50 | **26** | 162 |
| c3-0252 | 23 | 23 | 0 |
| c3-0825 | 15 | 15 | 0 |
| c3-0094 | 16 | 16 | 0 |
| c3-0794 | 15 | 15 | 4 |
| c3-0650 | 3 | 3 | 6 |
| c3-0489 | 21 | 21 | 0 |
| c3-0827 | 10 | **2** | 221 |
| c3-0437 | 7 | 7 | 0 |
| **Total** | **182** | **150** | **393** |

- **Removed:** 32 asks — 31 table-header cells and **1 real heading, c3-0827:4**, a census table-title row that r10 called P at score 0.728.
  - That is 31 of the 65 non-heading asks gone (48 %), for **1 heading lost out of 222**. The other 100 of the 101 audited-heading asks survive.
  - §4 rule 3 makes that row Caption-adjacent. A reviewer answering the remaining asks never sees it, and it never becomes a label.
- **`table_vetoed` (393)** counts every in-table non-H card, including ones already proposed and never asked. The number of asks the veto actually removed is 32.
- **Code:**
  - experiment side 4a31235: the sidecar gains `in_table_box` per card and `coverage.table_vetoed`; 167 label tests pass;
  - product side a7ea856 on `claude-heading-suggestion-asks`: `needsIn` mirrors the rule, with tests on all three branches. Lint 0, typecheck 0, `npm test` 2,522, hydration 53.
- **Open, not fixed:** the ask rule now lives in two places, Python (`suggest.py`) and TypeScript (`needsIn`), and nothing checks them against each other. The workbench's "J table cells not asked" line is untested at any level. `test:db` is still owed before merge.

### Task 6 follow-up, and the product branch through every gate
- **Split counts:** `coverage.table_vetoed` = asks the veto removed (**32** on the wild set). `coverage.table_not_heading_confident` = in-table non-H cards that were already confident (**361**). `not_heading_confident` stays the total of confident plus vetoed (1,082).
- **One rule, checked in two places:** every sidecar card carries `asked`, computed by `suggest.py` — the source of truth; 150 on the wild set, matching Task 6. The product recomputes `asked` with the same rule and **refuses the whole sidecar** (400 `invalid_heading_suggestions`) if any card disagrees. Asks are raised exactly for `asked === true`, and older sidecars without the flag are derived as before.
- **Coverage line:** the "J table cells not asked" clause appears only when J > 0, and a render test pins it exactly for J = 32.
- **Commits:** experiment side f18d9bb (168 label tests); product side a7ea856 and 550bc3e.
- **Product branch `claude/heading-suggestion-asks` at 550bc3e — gates:**
  - lint 0; typecheck 0;
  - `npm test` 2,531 passed; build 0;
  - `test:hydration` 53 passed on rerun. The first run failed one existing case, "a persisted document inspection survives a reload", which reads a panel once instead of with `expect.poll`. It passed on the rerun and on the three earlier runs; recorded as a pre-existing flake, not fixed here.
  - **`test:db` 146 passed (3 files, 89 s) on this exact head**, against the user's dedicated Neon test branch via a gitignored `.env.test.local` (copied from the main checkout; it holds `DATABASE_URL_TEST` only). An earlier head also passed `test:db` (146, 91.5 s).
- **The product branch has passed every gate and is ready to merge. It is NOT merged and NOT pushed. The merge is the user's decision.**
- **Still open:**
  - the table-cells count `table_not_heading_confident` is stored but not shown;
  - the known gaps listed under Task 2 stand;
  - **zero real human-answer labels exist yet.**
- **Hydration flake fixed** in its own commit, 6fdf5ad, which changes the test file only. "a persisted document inspection survives a reload" now reads the row with two `expect.poll` checks making the same assertions. `test:hydration` passed twice, 53/53 both times. `test:db` at 550bc3e still covers this head: 6fdf5ad touches only the browser hydration suite, which `test:db` does not run. **Branch head is 6fdf5ad: unmerged and unpushed; the merge is the user's decision.**

## Task 7 — attach the sidecar on the intake screen
Commit **c9be7f8** on `claude/heading-suggestion-asks`, which closes the "API-only attachment" known gap.

- **The control:** the intake screen has an optional "Heading suggestions (JSON, optional)" file control beside the PDF control. The chosen file's text is sent as the `headingSuggestions` part with the next PDF inspected, then cleared. When the control is empty, the part is omitted entirely.
- **No new route and no new validation:** the route's cap and refine apply.
- **Refusals:** `invalid_heading_suggestions` and `heading_suggestions_too_large` show the route's reason beside the control, with `aria-describedby` and `aria-invalid`.
- **Tests:**
  - unit tests on the form (part omitted when empty, present when chosen, and which part a refusal concerns);
  - one case in `platform-hydration.test.ts`. It attaches a broken sidecar and sees the error beside the control, then attaches the synthetic fixture and sees the workbench coverage line. It lives in the hydration suite because only that suite has an app server to open the workbench.
- **Gates:** lint 0, typecheck 0, `npm test` 2,535, `test:browser` 115, build 0, `test:hydration` 54.
- **`test:db` is unaffected:** no store or persistence file changed. The `test:db` pass at 550bc3e (146 tests) still covers the store code at this head.
- **Operator note:** choose the sidecar **before** the PDF, because the PDF uploads the moment it is chosen. The control's note says so.

## Runbook — producing the first human labels
1. **Suggest.** From `experiments/qwen-role-decisions`, run:
   `python3 -B -m labels.suggest --pdf <untagged.pdf> --adapter out/stage1/adapter-r10 --threshold 0.9933 --python ~/.venvs/qwen-role-decisions/bin/python --all-blocks --out <sidecar.json>`
   Documents over 600 blocks fall back to the likely-headings selector, and the sidecar says so. Image-only PDFs have no text layer and are not candidates.
2. **Run the product branch** (`claude/heading-suggestion-asks`, once merged or locally) and open a client's documents.
3. **Attach the sidecar on the intake screen** — choose "Heading suggestions (JSON, optional)" first, then the PDF.
4. **Answer in the workbench.** Accept a proposed heading in one action, or choose the type and level. Every answer is stored as `decided` for that card, and nothing is applied to the document.
5. **Export:** dump the document's `document_answers` rows as JSON with each document's url and content sha, then run:
   `python3 -B -m labels.export_answers --dump <dump.json> --out out/labels/human-answers.jsonl`
   Rows are grouped by host, and dependency-excluded rows are counted.
6. **Fold and measure:** add the rows to the labels, run `eligibility_eval.py split --keep`, and re-measure the Stage 2 gate on the new held-out rows (plan Task 4).

**Real human-answer labels produced so far: 0.**

## Task 8 — r10 on the wild population, graded against Claude-consensus labels
**Every number in this section is graded against Claude-consensus labels, not human labels.**

**Why this label source:** the user ruled that there is no time for human answers. The label source for the wild population is therefore a blind four-judge Claude consensus (`label_source: claude-consensus`, actor `consensus-4judge`). The reviewing session ran the judging:
- The judges were Opus quick, Sonnet, Opus thorough and Fable medium. Each read the page image with the card marked, and none saw model predictions, other judges' votes or labels.
- Calibration on the 222-row `audit-s2wild` heading bit was 0.966, 0.936, 0.961 and 0.961. The threshold was 0.90, so no judge was dropped.
- Pairwise agreement ranged from 0.974 to 0.998.
- A card has consensus when at least 3 judges agree on the heading bit (Unsure votes don't count).
- Of 1,232 cards, 1,219 reached consensus and 13 did not. Among the consensus cards, 1,172 were unanimous.
- Against the reviewer's 203-card audit, heading-bit agreement is 0.966, with 7 disagreements. Those are disclosed, not overridden.
- Provenance: `out/labels/s2wild-judges/`.

**Tooling:** the fold and evaluation tooling is at 863dc69 and 252ed89 (`labels/fold_wild.py`, `labels/eval_wild.py`, `split --assign-new`).
- **Fold:** 1,232 cards from 10 documents; 1,219 kept, 13 excluded for no consensus. By type: P 404, Other 372, TH 153, Lbl 135, H 116, Artifact 21, Caption 18.
- **Split:** `split --keep split-keys-all-4 --assign-new validation` into `out/keys-all-4-wild/split/split.json`.
  - Train is 7,051 → 7,051 and test is 2,325 → 2,325, with every kept id unmoved.
  - Validation is 1,525 → 2,744: all 1,219 wild rows, from 8 hosts that are in no other split.
  - Test is untouched and was not evaluated.
- **Output:** `out/stage1/eval-wild-r10.txt`.

### Results (r10; predictions rebuilt from the Task 5/6 sidecars; no calibration column, because every card is labelled)
| | All 1,219 | At the registered 0.9933 |
|---|---|---|
| Coverage | 1.000 | **0.887** (1,081) |
| TP / FP / TN / FN | 73 / 4 / 1,099 / 43 | 36 / **0** / 1,023 / 22 |
| Accuracy | 0.9614 [0.9491–0.9715] | **0.9796 [0.9693–0.9872]** |
| FP rate | 0.0036 [0.0010–0.0093] | **0.0000 [0–0.0036]** |
| FN rate | 0.371 | 0.379 |
| Documents with zero covered errors | 2 of 10 | **6 of 10** (validation: 60 of 67) |
| Documents fully covered with zero errors | 2 of 10 | 0 of 10 (validation: 8 of 67) |

Coverage curve (threshold: coverage, accuracy [lower–upper], FP):

| Threshold | Coverage | Accuracy | FP |
|---|---|---|---|
| 0.5 | 1.000 | 0.961 [0.949–0.972] | 4 |
| 0.9 | 0.957 | 0.973 [0.962–0.981] | 1 |
| 0.95 | 0.943 | 0.975 [0.964–0.983] | 1 |
| 0.99 | 0.905 | 0.978 [0.968–0.986] | 0 |
| 0.9933 | 0.887 | 0.980 [0.969–0.987] | 0 |

**The registered rule re-derived on this population** picks 0.99999760: coverage 0.308, 375 rows, **no heading covered at all** (TP 0, FN 2). That is a degenerate point, not an operating point. It is reported, not adopted.

**Recall by weight:** bold 49 of 65 (0.75), regular 24 of 51 (0.47).

**Level exactness among true positives, by consensus depth:** L1 20 of 39, L2 13 of 24, L3 0 of 10. The judges assign levels from one page, so treat level as weakly labelled.

### What it says
- **The false-positive side transfers.** At 0.9933 there are 0 FP among 1,023 covered not-headings (upper bound 0.0036). Across the whole population there are 4 FP, all below 0.96, so all are abstained at the operating point:
  - c3-0094:0 and c3-0252:1 are P;
  - c3-0825:16 and :20 are TH row labels, which the reviewer's audit had called H.
  This is the second population on which r10's proposed H is clean.
- **The accuracy side does not transfer on the raw labels.** At 0.9933 the accuracy lower bound is 0.969, below the rule's 0.98 and the gate's 0.99. Every covered error is a **missed heading**: 22 of the 58 covered consensus H, in 4 of 10 documents (c3-0794 13, c3-0128 6, c3-0489 2, c3-0252 1).
- **What the 22 covered misses are** (counted after measurement: a diagnosis, not a re-score):
  - **9 are enumerator-only cards** ("I.", "A.", "C."). **This is a labelling-convention conflict, not a model miss.** The judge protocol said a section heading's numeral is H even when the box covers only the numeral. The training keys never label it that way: all 185 enumerator-only cards in `out/keys-all-4/labels.jsonl` are non-H (Lbl 166, P 11, TH 7, Other 1), because the stripped trees tag the numeral as Lbl inside the H. r10 follows its training and calls these Lbl at score ≈ 1.0. *(Corrected below, under Wild round 2: this holds only in c3-0794; in c3-0128 and c3-0094 r10 says H on roman-numeral cards.)* In the wild set the consensus calls 20 enumerator-only cards H and 95 Lbl. Those rows are **left as labelled**: the consensus stands and is not edited by hand.
  - **8 are enumerated headings merged with their paragraph**, as in "A. Plans All tanks shall be installed…". The model says P and the consensus says H, but neither label fits the block. **The boundary comes from the product's auto-tagger (ODL), and the card builder inherits it:**
    - The tagger's list detection turns enumerated headings into L/LI/Lbl. Of the 15 merged-heading H cards in c3-0128, c3-0794 and c3-0094, 14 are `existing_tag: LI` with ancestors `[L, Document]`, and the numeral-only card beside each is that LI's `Lbl`. The one exception is c3-0128:153, tagged H3 and merged with its next sentence.
    - `pdftotext -bbox-layout` shows "A. Plans" is its own physical line, followed by the paragraph line at the same 12 pt size.
    - The reviewing session found this with Cards.java on the ODL output.
    - The fix can live in card building: split an LI whose first physical line is short and is followed by a paragraph on the same leading.
  - **5 others:**
    - 3 are genuine misses: c3-0252:53, a regular-weight place name, and c3-0794:134 and :138, bold catalogue lines;
    - 2 are scanned-text noise in c3-0489 — a one-character "~" card decided by rule, and a garbled line. Both fall under the registered OCR-quality follow-up.
- **Abstained misses (21)** are mostly short regular-weight lines.

### Three views, all graded against Claude-consensus labels, at 0.9933
| View | Rows | Covered | Abstention | Accuracy [exact 95 %] | FP (upper bound) | FN |
|---|---|---|---|---|---|---|
| **Raw — the headline** | 1,219 | 1,081 | 0.113 | **0.9796 [0.9693–0.9872]** | 0 (0.0036) | 22 |
| Excluding the 20 enumerator-only H rows (convention conflict) | 1,199 | 1,067 | 0.110 | 0.9878 [0.9793–0.9935] | 0 (0.0036) | 13 |
| Excluding every fragment-shaped card, chosen without looking at the label (227 cards) | 992 | 874 | 0.119 | 0.9931 [0.9851–0.9975] | 0 (0.0044) | 6 |

- **How the views are chosen:**
  - The second view's exclusion rests on a convention that was fixed before measurement (the training keys), so it is the fair reading of the model's judgement.
  - The third view is a sensitivity bound. Its cards are chosen by shape alone: any enumerator-only card, plus any card that starts with an adjacent enumerator-only card's token.
  - The reviewing session also computed a third view that drops only the *H-labelled* fragment cards (35): 0.9953 [0.989–0.998], FN 5. That selection conditions on the label and removes positives only, so it overstates; it is not adopted.
- **About the bounds:** the bounds here are the evaluator's exact Clopper-Pearson bounds. The reviewing session's independent scoring matches every count. Its bounds differ in the fourth decimal (for example, a raw upper bound of 0.9865), from a different interval method.
- **The Stage 2 gate is not met on this population in any view.** Even the third view's accuracy lower bound, 0.985, is under 0.99, and abstention (0.106–0.119) is over 0.10. The FP upper bound meets the ≤ 0.01 bar in every view.
- **The next lever is card building on untagged PDFs, not training:**
  - split an enumerated heading line from its paragraph;
  - decide one convention for the enumerator-only card — keep it Lbl, as the training does, and change the judge protocol, or merge the numeral into the heading card.
- **Also found, not yet chased:**
  - 11 sidecar cards share an identical locator box with another card. For example, c3-0794:149 "SUPPLY COMPANIES" has the same page-0 box as c3-0794:2 "I.". That points at a locator or page fault in the untagged block builder.
  - 22 cards have a `prev` context equal to their own text, 17 of them in c3-0429. Most are genuinely repeated values (for example, a table of identical amounts).
  - **Containers still feed `prev`.** c3-0794:1's `prev` is the text of its L container, c3-0794:0 (tag L, 227 pt tall), which encloses the LI. `non_container_cards` drops containers as cards, but they are evidently still used for the `prev` context.

**One-line summary for the roadmap:** on the first wild population, graded against Claude-consensus labels, the 0.9933 operating point holds FP at 0 of 1,081 answered cards. Accuracy misses the gate (lower bound 0.969 raw, 0.979 net of the enumerator convention conflict) because of two card-level shapes inherited from the auto-tagger's list detection, numeral-only Lbl cards and heading-plus-paragraph LI blocks — not because of the model's judgement on clean cards.

## Wild round 2: enumerated heading split
**Every number in this section is graded against Claude-consensus labels.**

Plan: `docs/superpowers/plans/2026-09-18-stage2-enumerated-heading-split.md`.

**The change.** `Cards.java` now reports each block's `first_line` and `line_count` (1050b12). `labels/split_heads.py` splits an LI or H* block with at least 2 lines whose first line is an enumerator plus at most 6 words — punctuation-only tokens don't count (a05dac8) — and doesn't end in `.;:`. The result is a head card `<locator>h` and a body card. The split is opt-in via `suggest --split-enumerated-heads`, and the training keys are byte-identical.

**Before measuring:**
- **Convention fixed:** an enumerator-only card is `Lbl`, as in all 185 training-key rows (judge protocol v2).
- **The 20 round-1 H rows on enumerator-only cards are left as labelled.**
- **Registered projection** (ledger, before the run):
  - FP passes;
  - accuracy comes near the gate but under it;
  - abstention stays above 10 %.
  - With the recorded Clopper-Pearson bound, a lower bound ≥ 0.99 needs n ≥ 368 answered cards at 0 covered errors, 874 at 3, 1,022 at 4, 1,164 at 5 and 1,439 at 7.

**Run.** Ten sidecars were written to `out/suggest/wild-v2`, taking 2,565 s (0.99 s per card).
- **Splits:** c3-0128 7, c3-0794 3, c3-0094 3. Of the 14 round-1 merged-heading H blocks, 12 split.
- **Residuals that did not split:**
  - c3-0794:1, where the heading and its first sentence share one physical line;
  - c3-0128:12, whose first line is seven words.
- **The changed set** (`out/labels/s2wild-v2-changed.json`) is 26 cards, and every other id's text is identical:
  - 13 heads;
  - 12 shortened bodies;
  - c3-0794:96, a revived body. The whole list item was missing from round 1, because `candidate_pool` drops the only LI of a one-item list — see Gaps.

**Judging.** The four blind judges ran under protocol v2 on the 26 cards only.
- All 26 were unanimous, with pairwise agreement 1.0.
- All 13 heads are H, and all 13 bodies are non-H (P 8, Other 5).
- Calibration doesn't apply: the audit rows refer to the old merged text, and this is disclosed.
- The patched consensus, `s2wild-consensus-v2.jsonl`, has 1,246 rows: 1,220 byte-identical to round 1, 12 replaced and 14 added.

**Fold and split.**
- Fold: 1,233 kept and 13 with no consensus.
- `split --keep out/keys-all-4-wild/split/split.json --assign-new validation` puts the 14 new ids in validation. 0 kept ids moved, and test was not evaluated.
- Output: `out/stage1/eval-wild-v2-r10.txt`.

### Views at 0.9933
| View | Rows | Covered | Abstention | Accuracy [exact 95 %] | FP (upper bound) | FN | Clean documents |
|---|---|---|---|---|---|---|---|
| Raw round 1 (continuity) | 1,219 | 1,081 | 0.113 | 0.9796 [0.9693–0.9872] | 0 (0.0036) | 22 | 6/10 |
| **Raw round 2 — the headline** | 1,233 | 1,098 | 0.110 | **0.9872 [0.9787–0.9930]** | 0 (0.0036) | 14 | 6/10 |
| Round 2, net of the 20 enumerator-only H rows (convention conflict) | 1,213 | 1,084 | 0.106 | 0.9935 [0.9867–0.9974] | 0 (0.0036) | 7 | 6/10 |
| Round 2, shape-blind (the round-1 selector re-applied, 229 cards) | 1,004 | 887 | 0.117 | 0.9944 [0.9869–0.9982] | 0 (0.0043) | 5 | 7/10 |

Coverage curve, round 2 raw (threshold: coverage, accuracy [lower–upper], FP):

| Threshold | Coverage | Accuracy | FP |
|---|---|---|---|
| 0.5 | 1.000 | 0.9716 [0.9607–0.9802] | 5 |
| 0.9 | 0.958 | 0.9839 [0.9750–0.9903] | 1 |
| 0.95 | 0.945 | 0.9863 [0.9778–0.9921] | 1 |
| 0.99 | 0.906 | 0.9875 [0.9791–0.9931] | 0 |
| 0.9933 | 0.891 | 0.9872 [0.9787–0.9930] | 0 |

- **The registered rule re-derived on this population** gives 0.99856 (coverage 0.81). It is reported, not adopted; a threshold is only ever derived on validation.
- **Recall:** bold 58 of 65, regular 29 of 52.
- **Level exactness among true positives:** L1 30 of 39, L2 13 of 34, L3 0 of 14.

### Where the change came from (covered errors 22 → 14)
- **The split** removed 6 covered misses (c3-0128:3, :6, :28, :153; c3-0794:9, :59). The merged blocks are now bodies, labelled non-H, and 12 of 13 are answered correctly at 0.9933.
  - All 13 head cards are predicted H.
  - 8 of them are covered at ≥ 0.9933.
  - 5 abstain: c3-0094:59h just under 0.9933, c3-0128:28h at 0.952, c3-0794:9h at 0.829, c3-0794:59h at 0.974, c3-0794:96h at 0.989.
- **The context effect.** The split changes neighbours' `prev`/`next` text, which r10 reads, and it shifted r10's answer on 33 unchanged-text cards. The effect removed 2 covered misses by abstention, not by correction (details in `out/labels/s2wild-v2-context-shift.txt`):
  - **5 crossed into coverage, all correct:** c3-0094:58 and :60, and c3-0794:69, :105 and :156.
  - **3 crossed out:** c3-0128:29 and c3-0794:12, both round-1 covered errors on enumerator-only H rows, and c3-0128:13, which had no consensus.
  - **2 heading-bit flips below the threshold:** c3-0128:17 went right → wrong, and :39 went wrong → right.
- **The 14 remaining covered misses** (counted after measurement):
  - **7 enumerator-only cards** in c3-0794 (:2, :7, :10, :42, :60, :70, :97), labelled H in round 1. This is the convention conflict: r10 says Lbl, as trained.
  - **2 merged-block residuals:** c3-0794:1 (same line) and c3-0128:12 (seven words).
  - **3 genuine misses:** c3-0252:53, c3-0794:134, c3-0794:138.
  - **2 scanned-text noise:** c3-0489:34 and :10 (the OCR-quality gap).

### Gate verdict, one line per view (the gate needs accuracy lower bound ≥ 0.99, FP upper bound ≤ 0.01, abstention ≤ 0.10)
- **Raw round 2:** not met. The lower bound is 0.979, and abstention is 0.110. FP passes.
- **Convention-net:** not met. The lower bound is 0.987, 0.003 under the gate, and abstention is 0.106. FP passes.
- **Shape-blind:** not met. The lower bound is 0.987, and abstention is 0.117. FP passes. It is a sensitivity bound only, and not adoptable.
- **The registered projection held:** FP passes, accuracy comes near but under, and abstention stays above 10 %.
  - At 1,084 covered cards, the convention-net view needs ≤ 4 covered errors to pass and has 7.
  - Five of the seven are genuine or noise; two are the merged-block residuals.
  - The lever is population size, which is round 3 (`2026-09-18-stage2-wild-population-growth.md`), together with the two known residual shapes.

### Correction (found after the review): r10 does not call every enumerator-only card Lbl
- **What the record said:** the enumerator-only miss anatomy, in Task 8 and above, says r10 "follows its training and calls these Lbl". **That holds only in c3-0794.**
- **What r10 actually does:** in c3-0128 and c3-0094, r10 predicts **H** on roman-numeral-only cards ("II.", "III.", "VII.", "XI.", "XII.", "XIII.").
  - Of the 115 enumerator-only cards with a consensus label, r10 says H on 10 in round 1 and 12 in round 2.
  - 5 of those are covered at ≥ 0.9933 in round 1, and 7 in round 2. All sit in those two documents, and all are rows the round-1 consensus labelled H.
  - Graded against the consensus as labelled, they count as **correct**. That is why the raw and convention-net views above show FP 0.
- **Under the fixed convention — enumerator-only = Lbl, protocol v2 — they are confident false positives.** This is an analysis view: every enumerator-only card is read as non-H, and no label is edited.

| At 0.9933 | Covered | Accuracy [exact 95 %] | FP (upper bound) | FN |
|---|---|---|---|---|
| Round 1, v2-convention view | 1,081 | 0.9833 [0.9738–0.9901] | **5 (0.0112)** | 13 |
| Round 2, v2-convention view | 1,098 | 0.9872 [0.9787–0.9930] | **7 (0.0137)** | 7 |

  The round 2 FP ids are c3-0094:58 and :60, and c3-0128:7, :10, :181, :188 and :196.
- **Consequence 1: the FP gate fails under the convention round 3 is judged by.** The FP upper bound is 0.0137, over the 0.01 bar. The convention-net view excludes these rows on both sides, so it neither rewards nor penalises them; it stands, but it is not the whole picture.
- **Consequence 2: round 3's labels use protocol v2,** so any r10 H on an enumerator-only card in the new documents will grade as FP there.
- **Consequence 3: "the FP side transfers"** (Task 8) holds under the consensus as labelled. It does not hold under the v2 convention.
- **Candidate fix, not applied:** a rule that decides an enumerator-only card as Lbl before the model. It would be registered and measured on validation first. The training keys already label all 185 of these cards non-H, so the rule matches the training convention.

### Gaps recorded, not fixed here
- **`candidate_pool` drops a one-item list's only item.** It de-duplicates before it drops containers, so the LI goes as a duplicate of its L, and then the L goes as a container. This affects training keys too, and the keys were left untouched.
- **Container text still feeds `prev`.**
- **11 overlapping locators.**
- **OCR:** the 151 image-only candidates.
- **The two residual merged shapes:** same-line, and a first line over six words.

## Rule R5 (enumerator-only = Lbl), registered 2026-09-18 on validation
Registered before any round 3 number exists, and before any wild figure uses it.

**The rule:** a card whose whole text is a bare enumerator is decided `Lbl` before the model, with rule score 1.0. That is `split_heads`' enumerator with no words: `^(?:[IVX]+|[A-Z]|\d+)\.$`. It works the same way as the other rule-decided cards in `suggest.py`.
- It is applied only as a recompute over existing predictions. No model run.
- Training keys and the test split are untouched.

**Measured on validation** (split-keys-all-4, `labels-audited-r10`, r10 at 0.993316; output in `out/stage1/rule-r5-validation.txt`):
- The rule touches **16** of 1,525 validation rows. Their labels: Lbl 14, P 1, TOCI 1, **H 0**.
- r10 already answers **all 16 as Lbl**, and covers all 16. So R5 changes **no answer**.

| | Covered | Coverage | Accuracy [exact 95 %] | FP (upper bound) | FN | Clean documents | Fully covered, clean |
|---|---|---|---|---|---|---|---|
| r10 alone | 1,142 | 0.7489 | 0.98862 [0.9806–0.9939] | 3 (0.0113) | 10 | 60/67 | 8/67 |
| r10 + R5 | 1,142 | 0.7489 | 0.98862 [0.9806–0.9939] | 3 (0.0113) | 10 | 60/67 | 8/67 |

**Verdict: R5 is neutral on validation. It passes the "not unfavourable" condition, so it is adoptable as a labelled second view on the wild rounds.**

**Disclosed limit:** validation contains none of the shape R5 exists for — a roman-numeral-only card that r10 answers H. The rule's benefit is therefore **untested on validation**. Its safety rests on two facts:
- all 185 enumerator-only training-key rows are non-H;
- all 16 validation rows are non-H.

## Wild round 3: registered draw of 20 documents (partial judging)
**Every number in this section is graded against Claude-consensus labels.** Plan: `2026-09-18-stage2-wild-population-growth.md`.

**Draw and run.** The draw was registered before any run (`out/suggest/wild-r3/population.json`): `random.Random(20260919)` over the 91 unused census ids.
- **Round 3 ids (20):** c3-0737, 0368, 0178, 0321, 0507, 0299, 0435, 0869, 0722, 0755, 0833, 0533, 0766, 0441, 0931, 0282, 0880, 0268, 0030, 0565.
- **Extension ids (10):** c3-0317, 0867, 0217, 0259, 0925, 0872, 0735, 0944, 0309, 0774.
- **Run:** every document tagged, so no replacements. That gives 1,720 cards: the census's 1,716 blocks plus 4 split heads. It took 3,758 s (2.2 s per card), across 17 hosts. Two of those documents are on buncombenc.gov, which was already in validation.

**Judging is partial, and round 3 is a random card subsample.**
- The session rate limit hit mid-judging, and the user then ruled out new agents. **13 of 28 chunks are unjudged.**
- One killed judge admitted to writing placeholder guesses for cards it had not viewed. So every output from a failed or killed run was deleted before scoring, and only runs that completed count.
- **Chunk coverage:**
  - chunks 00–14 have all four judges;
  - chunks 15 and 17 have three judges, with consensus at 3 of 3;
  - chunks 16 and 18 have two judges and are excluded;
  - chunks 19–27 have none.
- **Chunks were shuffled across documents before judging**, so the 1,040 judged cards are a random subsample of the 1,720, not a subset of documents. Per-document rates below are on partial documents.
- Every scored chunk used the thorough "high" judge.
- **Judging statistics:**
  - 848 unanimous 4/4, 37 at 3/4, 155 at 3/3;
  - 7 with no consensus among judged cards, plus 673 unjudged or excluded — 680 unlabelled in total;
  - pairwise agreement 0.969–0.993.
- **Types:** P 353, Other 303, Lbl 166, H 93, Artifact 70, TH 37, Caption 18.
- Protocol v2 applied. There was no calibration: no audit overlap exists.

**Fold and split.** 1,040 labelled cards. `split --keep out/keys-all-4-wild-v2/split/split.json --assign-new validation` put all 1,040 in validation. 0 kept ids moved, and test was not evaluated.

**Output files:**
- `out/stage1/eval-wild-r3-r10.txt`
- `out/stage1/eval-wild-v2r3-r10.txt`
- `out/stage1/views-wild-r3.txt`

### Views at 0.9933
| View | Rows | Covered | Abstention | Accuracy [exact 95 %] | FP (upper bound) | FN | Clean documents* |
|---|---|---|---|---|---|---|---|
| Round 3 raw | 1,040 | 852 | 0.181 | 0.9941 [0.9864–0.9981] | 0 (0.0045) | 5 | 17/20 |
| Round 3 shape-blind | 899 | 721 | 0.198 | 0.9931 [0.9839–0.9977] | 0 (0.0053) | 5 | 17/20 |
| Round 3 with R5 | 1,040 | 853 | 0.180 | 0.9941 [0.9864–0.9981] | 0 (0.0045) | 5 | 17/20 |
| **Rounds 2+3 raw — the headline** | 2,273 | 1,950 | 0.142 | **0.9903 [0.9848–0.9941]** | 0 (0.0020) | 19 | 23/30 |
| Rounds 2+3, convention-net (−20 round-1 enumerator-only H) | 2,253 | 1,936 | 0.141 | 0.9938 [0.9892–0.9968] | 0 (0.0020) | 12 | 23/30 |
| Rounds 2+3, shape-blind | 1,903 | 1,608 | 0.155 | 0.9938 [0.9886–0.9970] | 0 (0.0024) | 10 | 24/30 |
| Rounds 2+3 with R5, convention-net | 2,253 | 1,939 | 0.139 | 0.9938 [0.9892–0.9968] | 0 (0.0020) | 12 | 23/30 |

\* Round 3 documents are partially judged.

**About the R5 rows:**
- R5 is only meaningful against labels judged under protocol v2. On round 3 it touches 74 cards and changes one covered count; r10 had already answered none of them H at ≥ 0.9933.
- On round 2, whose unchanged rows carry protocol-v1 labels, R5 overrides enumerator-only cards that round 1 labelled H. That makes "round 2 with R5" (0.9756, FN 27) and "rounds 2+3 with R5" (0.9837) artefacts of the label conflict.
- The comparable R5 row is the convention-net one above, which is identical to convention-net without R5.
- **R5 changes nothing measurable here.**

**Coverage curve** (threshold: coverage, accuracy, lower bound, FP):

| Threshold | Round 3 | Rounds 2+3 |
|---|---|---|
| 0.5 | 1.000, 0.9538, LB 0.9393, FP 20 | 1.000, 0.9635, LB 0.9549, FP 25 |
| 0.9 | 0.936, 0.9805, LB 0.9697, FP 6 | 0.948, 0.9824, LB 0.9759, FP 7 |
| 0.95 | 0.916, 0.9843, LB 0.9742, FP 6 | 0.932, 0.9854, LB 0.9793, FP 7 |
| 0.99 | 0.845, 0.9909, LB 0.9821, FP 2 | 0.878, 0.9890, LB 0.9834, FP 2 |
| 0.9933 | 0.819, 0.9941, LB 0.9864, FP 0 | 0.858, 0.9903, LB 0.9848, FP 0 |

- **The rule re-derived on the wild set** gives 0.9742 on round 3 and 0.9566 on rounds 2+3. Neither is adopted; thresholds come only from validation.
- **Recall, rounds 2+3:** bold 84 of 99, regular 68 of 111.

**Round 3's 5 covered misses** (counted after measurement). All are r10 answering P or Other on a block the consensus calls H:
- **4 are a heading run into its body text in one block,** with no enumerator: c3-0507:109 "Plant Selection …", c3-0507:110, c3-0507:499 "BULLETIN STAFF …", and c3-0722:147, a code-section number and title followed by its text.
- **1 is a bold addendum line:** c3-0299:69.
- **None is enumerator-only.** Round 3's labels follow the v2 convention, and r10 gave no confident H on a numeral card.

### Gate verdict (the gate needs accuracy lower bound ≥ 0.99, FP upper bound ≤ 0.01, abstention ≤ 0.10)
- **Rounds 2+3 raw:** not met.
  - The accuracy lower bound is 0.9848, 0.0052 under the gate.
  - FP passes: 0 of about 1,830 covered not-headings, upper bound 0.0020.
  - Abstention, 0.142, fails.
- **Convention-net and shape-blind:** not met. The lower bound is 0.989, 0.001 under, and abstention is 0.14–0.16.
- **Extension rule** (plan: add ids 21–30 if the combined lower bound is within 0.005 of 0.99 with FP passing). The raw combined bound is 0.0052 away, so **not triggered on the headline**. It would be triggered on the convention-net view, 0.0008 away.
  - Either way, judging is stopped by the user's no-new-agents ruling.
  - The 680 unjudged round 3 cards are the cheaper way to more n, since they are already run.
- **What moved:**
  - FP is now well inside the bar, on the largest population yet.
  - Accuracy is at the gate's edge.
  - Abstention got worse (round 3 alone 0.181), and it is the bar furthest from passing at this threshold.
  - The remaining misses are mostly run-in headings, a heading and its text in one block without an enumerator. That shape is not addressed by the split.
