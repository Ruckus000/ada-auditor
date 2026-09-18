# Stage 2 Implementation Plan — heading suggestions through the answers channel, approvals as labels

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put adapter-r10 in front of the product's existing human-in-the-loop layer so that every heading decision a reviewer approves or corrects becomes a `human-answer` label row the learning loop can consume — the only label source that can move the Stage 2 gate (accuracy lower bound, FP upper bound, abstention) now that the loop's own levers are measured dead ends (rounds 8, 9, 11, 12).

**Architecture:** No model change. A new document stage, `heading-suggest`, runs r10 with `--scores` over a document's candidate cards and writes a sidecar of typed suggestions (`{card_id, type, level, rule, score, decided_by}`) plus a locator per card. Suggestions at or above the registered operating point (score ≥ 0.9933) are proposed as heading declarations the reviewer can accept in one action; suggestions below it are posted as **asks** beside the card, exactly as figure descriptions already are (`document_answers`, Milestone A). A reviewer's accept/correct/reject is stored as an answer; an export command turns answers into `labels/human-answer` rows keyed by card id, with the reviewer as `actor`, so `eligibility_eval.py` can fold them and the split can grow. Advisory only: nothing is applied to a document without a stored human answer, per the roadmap's Stage 2 rule.

**Tech Stack:** Next.js app (`src/app/api/documents/*`, the answers workbench), `src/integrations/documents/` Java stages for cards, a subprocess call into `experiments/qwen-role-decisions/labels/predict.py --scores` (MLX venv) for the research build only — production wiring of the model runtime is a later plan. `src/` must never resolve a path into `experiments/`; the research build reads the sidecar file the experiment writes.

**Spec:** roadmap `2026-09-13-staged-autonomy-roadmap.md` (Stage 2: model advisory, human approval for structural change, per-decision rule + ISO type), `heading-definition-2026-09-13.md` (vocabulary, rules 1–4), `heading-stage1-r11-2026-09-18-results.md` (operating-point-r10.json), memory `answers-channel-milestone-a` (asks beside needs, `document_answers`, derived states, workbench).

## Global Constraints

- **Advisory only.** No heading is written into a delivered document without a stored human answer for that card. The gate remains `contentChanges(applyDeclarations(...))`.
- **Every suggestion cites its reason**: the §4 rule number and the ISO type, as the model already emits (`{"type","level","rule"}`).
- **Labels never fabricated.** Only rows with a stored human answer become `human-answer` labels; abstained and un-answered cards produce no label. Model output is never a label.
- **Test split untouched.** Exported answers enter `out/labels/human-answers.jsonl`; assignment to train/validation/test is by the existing host/document split logic with `--keep`, never by hand.
- **No production deploy in this plan.** Research build + unit tests + one hydration case; the model runtime stays local. Deploying the model is its own plan.
- Commit per task, `git add <paths>`, trailer `Co-Authored-By: <model> <noreply@anthropic.com>`.

---

### Task 1: `heading-suggest` sidecar from the experiment side

**Files:** create `experiments/qwen-role-decisions/labels/suggest.py` (+ `test_suggest.py`)

- Interface: `python3 -B -m labels.suggest --pdf <file> --adapter out/stage1/adapter-r10 --threshold 0.9933 --python <mlx> --out <sidecar.json>`; builds cards for one untagged PDF with the existing card builder, predicts with `--scores`, writes `{document, threshold, cards:[{card_id, locator:{page,x0,y0,x1,y1}, text, type, level, rule, score, decided_by, proposed: score>=threshold}]}`.
- Test: a fixture card list + fake predictions → the sidecar shape, `proposed` flag correct at the threshold boundary, abstained rows present with `proposed:false`.

### Task 2: Suggestions enter the answers channel

**Files:** modify `src/domain/document-answers.ts` (answer kinds gain `heading` with `{cardId, accepted: type/level | rejected}`), the answers route and workbench page (an ask per non-proposed card; a one-action accept per proposed card, each showing the rule and ISO type), `schema.sql` only if `document_answers` needs a new column (prefer the existing JSON payload); contract tests in `tests/support/run-store-contract.ts` for the new answer kind.

- Read the sidecar from the document's upload record (research build: a path field); derive states so a document with un-answered heading asks shows as waiting-on-person, as figure asks do.
- Hydration: one case that uploads a fixture PDF with a sidecar, answers two asks, and sees the derived state flip.

### Task 3: Answers → labels export

**Files:** create `experiments/qwen-role-decisions/labels/export_answers.py` (+ test); modify `eligibility_eval.py` only if `human-answer` rows need a field it lacks.

- Reads stored heading answers (via the API or a DB dump handed over as JSON), writes `out/labels/human-answers.jsonl` rows: `{id, answer_id, actor:<reviewer id>, label_source:"human-answer", type, unsure:false, label:{heading,level}, note:"", labelled_at}`; rejected suggestions become the reviewer's stated type (P by default) — never silently H.
- `split --keep` folds new documents by host; the record states how many rows and documents entered validation, and the fresh bounds at the operating point.

### Task 4: Record and the Stage 2 gate re-measured

- Record `docs/research/document-remediation/heading-stage2-2026-09-XX-results.md`: rows exported, agreement between reviewer answers and r10 on proposed cards (this is the first human-labelled precision number, replacing "graded against Claude-audited labels" for those rows), the operating point re-evaluated on validation grown by human-answer rows, and the gate verdict. Update the roadmap's Stage 2 status.

**Not in this plan:** production model serving, any retraining, the test split, changes to figure/alt answers.
