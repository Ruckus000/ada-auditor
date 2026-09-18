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
