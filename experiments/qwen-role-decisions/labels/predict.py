"""Run the typed prompt with an adapter over one split's rows; write predictions for the evaluator.

Rules-in-front decide first; the model is called only for what they cannot say.
Each prediction row is ``{"id", "raw", "decided_by": "rule"|"model"}``; the
``raw`` is the exact model output (or the rule's JSON), which the evaluator
parses. Never writes into a label file.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from labels.rules import decide, forbids_heading
from labels.sft import prompt_for, stack_before

MODEL = "mlx-community/Qwen3.5-4B-MLX-4bit"


def rule_prediction(card: dict) -> str | None:
    hit = decide(card)
    if hit is None:
        return None
    t, rule = hit
    return json.dumps({"type": t, "rule": rule}, separators=(",", ":"))


def prompt_for_row(card: dict, row: dict, keys: dict) -> str:
    stack = stack_before(card, keys.get(row["document_id"], []), row.get("key_locator"))
    return prompt_for(card, stack)


def generate(python: str, prompt: str, image: str | None, adapter: str | None) -> str:
    cmd = [python, "-m", "mlx_vlm.generate", "--model", MODEL, "--prompt", prompt, "--max-tokens", "64", "--temperature", "0", "--thinking-mode", "disabled", "--no-verbose"]
    if adapter:
        cmd += ["--adapter-path", adapter]
    if image:
        cmd += ["--image", image]
    proc = subprocess.run(cmd, capture_output=True, text=True, env={**__import__("os").environ, "HF_HUB_OFFLINE": "1"})
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-1500:])
    return proc.stdout


def post_rules(raw: str, card: dict) -> str:
    """A model H under a Table in the tag tree is not a document heading (definition §4 rule 3)."""
    if not forbids_heading(card):
        return raw
    try:
        data = json.loads(raw[raw.index("{") : raw.rindex("}") + 1])
    except ValueError:
        return raw
    if isinstance(data, dict) and data.get("type") == "H":
        return json.dumps({"type": "TH", "rule": 3, "vetoed": "table_ancestor"}, separators=(",", ":"))
    return raw


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--cards", type=Path, required=True, help="jsonl of candidate cards with prev/next/facts and image paths")
    p.add_argument("--keys", type=Path, required=True, help="json: document_id -> ordered key headings [{page,y0,level,text}]")
    p.add_argument("--split", type=Path, required=True)
    p.add_argument("--on", choices=("validation", "test"), default="validation")
    p.add_argument("--adapter", default=None)
    p.add_argument("--python", required=True, help="interpreter with mlx_vlm")
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    wanted = set(json.loads(a.split.read_text())["ids"][a.on])
    cards = {c["card_id"]: c for c in (json.loads(l) for l in a.cards.read_text().splitlines() if l.strip())}
    keys = json.loads(a.keys.read_text())
    rows = [json.loads(l) for l in a.labels.read_text().splitlines() if l.strip()]
    done = {json.loads(l)["id"] for l in a.out.read_text().splitlines() if l.strip()} if a.out.is_file() else set()
    n_rule = n_model = 0
    with a.out.open("a") as f:
        for r in rows:
            if r["id"] not in wanted or r["id"] in done:
                continue
            card = cards[r["id"]]
            raw = rule_prediction(card)
            if raw is not None:
                by = "rule"; n_rule += 1
            else:
                raw = post_rules(generate(a.python, prompt_for_row(card, r, keys), card.get("image"), a.adapter), card)
                by = "model"; n_model += 1
            f.write(json.dumps({"id": r["id"], "raw": raw, "decided_by": by}) + "\n")
            f.flush()
    print(json.dumps({"rule": n_rule, "model": n_model, "out": str(a.out)}))


if __name__ == "__main__":
    main()
