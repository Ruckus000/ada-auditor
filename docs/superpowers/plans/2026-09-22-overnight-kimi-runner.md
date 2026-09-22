# Overnight runner: how Kimi gets model runs (2026-09-22)

The model (Qwen3.5-4B + LoRA via `mlx_vlm`) runs on MLX, which is Apple
Silicon only. A Kimi sandbox cannot run it. A Claude Code session on the Mac
is the **runner**: Kimi commits a request, the runner checks it against the
rules below, runs it, and pushes the outputs to the data branch. Everything
else (analysis, code, dev sets, verification, records) is Kimi's.

## Branches and paths

- Code and records: `claude/heading-labelling-pass`. Data only:
  `kimi-data-run-in-2026-09-21`, never merged into a code branch.
- Paths under `experiments/qwen-role-decisions/out/` are **identical** on the
  data branch and on the Mac, so a request can name any of them:
  - `out/keys-tagged/<doc>.pdf`: tagged copies of the 352 train and
    validation documents, plus `manifest.json` (`id`, `build`, `split`)
  - `out/keys-stripped/<doc>.pdf`: their untagged copies (what
    `key_context.marked_image` renders)
  - `out/keys-all-9/{cards,labels}.jsonl`, `key-headings.json`:
    train+validation only
  - `out/keys-all-4/split/split.json`
  - `out/stage1/pred-validation-r10.jsonl`, `operating-point-r10.json`
  - wild: `out/cohort3/real/`, `out/suggest/{wild-v2,wild-r3,wild-v4-runin,wild-v5-r5}/`,
    `out/labels/*-final.jsonl` and `*-runin.jsonl`,
    `out/labels/s2wild-judges-runin/`
- **Warning:** data commit 1887e3e carried keys-all-9 with its 2,325
  test-split rows; 7e72096 removed them. Never read keys-all-9 at 1887e3e.
  The test split is never read, in any form.

## A request

One file per run, committed to the code branch at
`experiments/qwen-role-decisions/overnight/requests/NN-name.json`, `NN` rising
from `01`:

```json
{"id": "NN-name", "purpose": "one line", "commit": "<code sha the run uses>",
 "cmd": ["argv", "..."], "outputs": ["out/overnight/NN-name/..."],
 "est_minutes": 25}
```

The runner checks the code branch about every 10 minutes and runs requests
in `NN` order, one at a time (there is one MLX device). It runs from
`experiments/qwen-role-decisions` with the code at `commit`, under
`caffeinate`, after checking the lid is open and AC power is on.

## Allowlist (anything else is refused, with the reason recorded)

- `["python3", "-B", "-m", "labels.<module>", ...]`: repo code only.
- `["~/.venvs/qwen-role-decisions/bin/python", "-B", "-m", "labels.predict", "--scores", ...]`:
  scoring; adapter must be `out/stage1/adapter-r10` or an adapter a previous
  request trained under `out/overnight/`.
- `["python3", "-B", "-m", "labels.suggest", ...]`: the product path on an
  untagged PDF.
- Training: exactly the r10 recipe, with only the dataset, output path and
  iters changed:
  `~/.venvs/qwen-role-decisions/bin/python -m mlx_vlm.lora --model-path mlx-community/Qwen3.5-4B-MLX-4bit --dataset <out/overnight/...> --split train --batch-size 1 --lora-rank 8 --iters <2N> --steps-per-report 50 --steps-per-save <2N> --train-on-completions --grad-checkpoint --output-path <out/overnight/...>`,
  run with `HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1`. The r10 data was
  `emit_sft --keys-dir out/keys-all-9 --split out/keys-all-4/split/split.json --on train --exclude-doc-prefix c5 --oversample-regular-h 2`
  (4,942 rows, 9,884 iters, 13.7 h).
  - Time gate: at step 100 the runner projects wall time and stops the run
    if it exceeds 16 h.
  - A resumed LoRA run writes no `adapter_config.json`, so train from the
    base model.
- **Refused:** any argument naming the test split or `--on test`; any output
  outside `out/overnight/NN-name/`; an existing `out/overnight/NN-name/`
  (no overwrites); shell strings, pipes or `pip install`.

## What comes back

On the data branch, `experiments/qwen-role-decisions/out/overnight/NN-name/`
holds the declared outputs plus `DONE.json`:
`{"id", "exit_code", "seconds", "commit", "started", "finished", "stdout_tail", "stderr_tail"}`.
A refused request gets `DONE.json` with `"refused": "<reason>"` and no run.

## Facts for estimates

- Scoring: about 2.1 s per model-decided card (`predict.py --scores`); rules
  decide some cards for free.
- `suggest.py --all-blocks` runs the tagger first (about 1–2 min per
  document) and then scores every card.
- Registered operating point for r10: threshold 0.9933. A new adapter needs
  its own threshold, re-derived on validation by the r11 rule (see
  `labels/eval_wild.py` `threshold_rule`).
