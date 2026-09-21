# Handoff to Kimi (web): Stage 2 run-in heading split

Written 2026-09-21. Branch `claude/heading-labelling-pass` on
`github.com/Ruckus000/ada-auditor` (public), head `1dd08e8` or later. You are the
implementing session; a local Claude session on the user's machine runs
everything and reports results back to you.

## What you can and cannot reach

| You can | You cannot |
|---|---|
| Read every tracked file on this branch | See `experiments/*/out/` or `vendor/` — gitignored: adapters (`out/stage1/adapter-r*`, ~124 MB each), keys corpus, labels, predictions, PDFBox/veraPDF jars |
| Write code, tests, plans, records | Run Java, MLX (Qwen), veraPDF, OpenDataLoader, or the test suites |
| Reason from the code about data shapes | Read document text — wild/keys PDFs are real municipal records naming real people; never ask for or print their text |

**Return work as unified diffs against the head commit you read** (name it at the
top of your reply), or as whole-file contents for new files. The local session
applies, runs, and pastes back output. Say exactly which commands to run.

## Read first, in order

1. `AGENTS.md` — engineering rules; `CLAUDE.md` — commands and cross-file traps.
2. `docs/superpowers/plans/2026-09-22-stage2-run-in-heading-split.md` — **the plan
   you are executing.** Step 0 numbers, the rule, the tests, the validation
   freeze rule, the stop point.
3. `docs/research/document-remediation/heading-stage2-2026-09-21-wild-gate-final-addendum.md`
   — why: wild gate NOT MET at acc 0.9873 [0.9821–0.9913]; 12 of 25 covered
   misses are run-in headings.
4. `docs/superpowers/plans/2026-09-18-stage2-enumerated-heading-split.md` — the
   precedent this generalises; same head/body mechanics.
5. Code: `experiments/qwen-role-decisions/labels/split_heads.py`,
   `labels/test_split_heads.py`, `labels/suggest.py`, `Cards.java`
   (`firstLineOf`), `labels/build_keys.py` (`candidate_pool`, `document_cards`).

## Where the work stopped

WIP commit `e5c3a5d` (interrupted mid-step):

- `Cards.java`: `FirstLine` now carries `x1`, emitted as `first_line_x1`
  (null for glyph-less blocks). **Done but unreviewed.** It computes the *max*
  `x + w` over the first line's glyphs; the plan text says "`x + w` of the last
  glyph before the line change". Max is the more robust reading (kerning,
  trailing spaces) — keep it and correct the plan sentence, or argue otherwise.
  It compiles and the existing 199 label tests pass with it.
- `labels/split_heads.py`: only `RUN_IN_TAGS = SPLIT_TAGS | {"P"}` added.

Not started: `split_run_in_heads(blocks, width_frac)`, its tests, the
`--split-run-in-heads` flag on `suggest.py`, the validation measurement script,
the validation table, the wild changed-id diff.

## Your task, in order (plan §§ "The generalised rule" → "Stop point")

1. **Tests first** in `labels/test_split_heads.py`: every positive and negative
   case listed in the plan, plus old dumps (no `first_line_x1`) never split,
   input not mutated, enumerated split byte-identical with the new flag present,
   `candidate_pool`/`document_cards` unchanged with both flags off.
2. `split_run_in_heads` in `labels/split_heads.py`; a block matching both rules
   splits once. Reuse `head_words`, `LINE_EM`, the head/body construction.
3. `--split-run-in-heads WIDTH_FRAC` on `labels/suggest.py` (opt-in; off is
   byte-identical to today). `build_keys` must never call it.
4. A validation measurement script (new file under `labels/`) implementing the
   plan's protocol: validation-split docs of `out/keys-all-4`, excluding the 30
   wild gate docs; metrics per width in {0.5, 0.6, 0.7}; the registered freeze
   rule. Scripts only, no model calls. Emit a JSON table.
5. **Stop.** The local session runs it; you write the validation table into a
   record. Wild re-measurement and any judging need the user's go-ahead.

## Hard rules (these have been broken before; do not)

- **Test split is never evaluated.** Thresholds freeze on validation only; the
  wild set is measured once, after the freeze, never tuned against.
- **No judging, no training, no labels merged** without the user's explicit
  go-ahead. You are not a judge in this phase.
- **Every metric names its label source** (e.g. "graded against
  `opus-kimi-consensus` labels").
- **Provenance files are never overwritten**; new outputs get new names.
- YAGNI: the plan's "Cut" section is binding (no same-line run-in, no
  standalone-miss handling, no changes to the enumerated split).
- `src/` must never import or resolve a path into `experiments/`.

## Running things (for the commands you hand back)

All from `experiments/qwen-role-decisions/`, `python3 -B`, so `from run import …`
resolves.

- **Java:** no setup needed. Scripts take `java` from a valid `JAVA_HOME`, else
  PATH (`run.java_tool`, `document-remediation/java.mjs`, commit `892145f`).
  Do not reintroduce a hardcoded JDK path.
- **Adapters:** no defaults. `run.py` adapter modes and `labels/suggest.py`
  require an explicit path; the registered adapter is
  `out/stage1/adapter-r10` at threshold `0.9933` (commit `1dd08e8`).
- **MLX interpreter** for `predict.py --scores` / `suggest.py --python`:
  `~/.venvs/qwen-role-decisions/bin/python`.
- **Tests:** label tests are pytest-style (`def test_…(tmp_path)`), but pytest is
  **not installed** locally; the local session runs them with a small shim that
  calls every `test_*` function (only the `tmp_path` fixture is supported). Use
  no other fixtures, no `pytest.mark`, no `pytest.skip` in new tests — use
  plain `assert`, and `return` early with a `print("skip: …")` for missing
  local data.
- Baseline right now: 199/199 label tests pass.
- `experiments/` is outside lint and typecheck; the repo gates (`npm run lint`,
  `npm run typecheck`) still run on push and must stay green.

## What to send back each turn

1. The diff (against a named commit).
2. The exact commands to run and what output you expect.
3. Anything you assumed about a data shape you could not see, so the local
   session can check it before running.
