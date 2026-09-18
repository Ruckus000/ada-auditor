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
