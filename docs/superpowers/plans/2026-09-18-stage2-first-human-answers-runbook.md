# Stage 2 runbook — producing the first real human-answer labels

The learning loop is blocked on one thing no chat can supply: a person answering heading-card asks in the workbench. Everything below is already built and gated; this is the sequence a person runs, in order, with the one credential step first.

## 0. What exists (2026-09-18)

- Candidate adapter: `out/stage1/adapter-r10`, operating point score ≥ 0.9933 (`operating-point-r10.json`).
- Sidecar tool: `experiments/qwen-role-decisions/labels/suggest.py` (branch `claude/heading-labelling-pass`, codex checkout `/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor`).
- Product side: branch `claude/heading-suggestion-asks`, worktree `/Users/jphilistin/Documents/Coding/ADA Auditor/.claude/worktrees/heading-eligibility-loop-bd2a94`, on master `64a1382`, unmerged, unpushed. All gates green except `test:db`.
- Exporter: `labels/export_answers.py` (answers → `human-answer` label rows, grouped by host).

## 1. The credential step (user only)

`test:db` has not run on the product branch. Create `.env.test.local` in the product worktree with `DATABASE_URL_TEST=` pointing at the **dedicated Neon test branch, never production** (see `.env.example` line ~150), then:

```bash
cd "/Users/jphilistin/Documents/Coding/ADA Auditor/.claude/worktrees/heading-eligibility-loop-bd2a94" && npm run test:db
```

A green run is the last gate before the branch can be merged.

## 2. Make a sidecar for one real untagged PDF

From the codex checkout, with the MLX venv (`~/.venvs/qwen-role-decisions/bin/python`):

```bash
cd "/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor/experiments/qwen-role-decisions" && python3 -B -m labels.suggest --pdf <untagged.pdf> --adapter out/stage1/adapter-r10 --threshold 0.9933 --all-blocks --python ~/.venvs/qwen-role-decisions/bin/python --out out/suggest/<stem>/sidecar.json
```

Pick a PDF with no structure tree (e.g. `c3-0128.pdf` under `out/cohort3/`; ~7 min for 185 blocks; documents over 600 blocks fall back to the likely-headings selector and say so in `coverage.selector`).

## 3. Upload it beside the PDF (API-only in this build)

Start the product worktree (`npm run dev`), sign in as an operator, then POST a multipart form to `/api/platform/clients/<clientId>/documents` with two parts: `file` (the PDF) and `headingSuggestions` (the sidecar JSON as text). The route validates the sidecar (400 `invalid_heading_suggestions` if the shape or the proposed/score rule fails, 413 over the size cap) and stores it in the inspection summary; no document text is stored.

## 4. Answer in the workbench

Open the client's document in the operator workbench. Each heading-card ask shows the line boxed on the page preview, the model's suggested type/level with its rule, and — for proposed cards — a one-action accept (never preselected). Cards whose dependency ask is still open say "assumes the heading above is a heading". Answer every ask: accept, correct (choose the type and level you judge), or reject. The document reads as waiting-on-person until all asks are answered. The coverage line shows "N of M text blocks considered".

## 5. Export the answers as labels

Dump the `document_answers` rows for that document (kind `heading`, ask ids `heading-card:*`) to JSON, including the document's `url` and `contentSha256`, then:

```bash
cd "/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor/experiments/qwen-role-decisions" && python3 -B -m labels.export_answers --dump <answers.json> --out out/labels/human-answers.jsonl
```

Rows whose dependency card is un-answered or rejected are excluded and counted. Then re-draw the split with `eligibility_eval.py split --keep out/keys-all-4/split/split.json --keep-labels out/keys-all-4/labels.jsonl` over labels + human-answers; the new document lands with its host.

## 6. Re-measure the gate (implementing chat)

With human-answer rows in validation, re-run `predict --scores` on the grown validation set, re-apply the threshold rule, and report the Stage 2 gate (accuracy lower bound ≥ 0.99, FP upper bound ≤ 0.01, abstention ≤ 10 %). The first human-labelled precision number replaces "graded against Claude-audited labels" for those rows.

Each document answered adds roughly 15–25 human labels. The bounds move with the count; the abstention rate moves only when a later round trains on human labels.
