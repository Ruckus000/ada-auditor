"""Run the typed prompt with an adapter over one split's rows; write predictions for the evaluator.

Rules-in-front decide first; the model is called only for what they cannot say.
Each prediction row is ``{"id", "raw", "decided_by": "rule"|"model"}``; the
``raw`` is the exact model output (or the rule's JSON), which the evaluator
parses. Never writes into a label file.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib
import io
import json
import math
import os
import re
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


def cli_args(prompt: str, image: str | None, adapter: str | None) -> list[str]:
    """The ``mlx_vlm.generate`` arguments, shared by the subprocess and the in-process scoring path."""
    args = ["--model", MODEL, "--prompt", prompt, "--max-tokens", "64", "--temperature", "0", "--thinking-mode", "disabled", "--no-verbose"]
    if adapter:
        args += ["--adapter-path", adapter]
    if image:
        args += ["--image", image]
    return args


def generate(python: str, prompt: str, image: str | None, adapter: str | None) -> str:
    cmd = [python, "-m", "mlx_vlm.generate", *cli_args(prompt, image, adapter)]
    proc = subprocess.run(cmd, capture_output=True, text=True, env={**__import__("os").environ, "HF_HUB_OFFLINE": "1"})
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-1500:])
    return proc.stdout


VALID_TYPES = ("H", "P", "Artifact", "Caption", "TH", "TOCI", "Lbl", "BlockQuote")
TYPE_VALUE_OPENS = re.compile(r'"type"\s*:\s*"$')


def first_token_ids(encode) -> dict[str, int]:
    """Each valid type's first token id as it is tokenised after ``"type":"`` (``encode`` is text -> ids)."""
    prefix = '{"type":"'
    head = encode(prefix)
    out = {}
    for t in VALID_TYPES:
        ids = encode(prefix + t + '"')
        if ids[: len(head)] != head:
            raise ValueError(f"type {t!r} merges across the type-value boundary: {ids}")
        out[t] = ids[len(head)]
    return out


def shared_first_tokens(first_ids: dict[str, int]) -> list[list[str]]:
    """Groups of types that begin with the same token (they cannot be told apart at the type step)."""
    by_id: dict[int, list[str]] = {}
    for t, i in first_ids.items():
        by_id.setdefault(i, []).append(t)
    return [g for g in by_id.values() if len(g) > 1]


def heading_score(first_ids: dict[str, int], logprobs: dict[int, float]) -> tuple[float, float]:
    """``p_H`` = p(H's first token) / sum of p over the distinct valid first tokens; ``score`` = max(p_H, 1 - p_H).

    Types sharing a first token are one group: the shared token is counted once in
    the denominator, and if H is in such a group its whole mass counts as H.
    """
    ids = sorted(set(first_ids.values()))
    top = max(logprobs[i] for i in ids)
    total = sum(math.exp(logprobs[i] - top) for i in ids)
    p_h = math.exp(logprobs[first_ids["H"]] - top) / total
    return p_h, max(p_h, 1.0 - p_h)


class ScoringGenerator:
    """``mlx_vlm.generate``'s CLI ``main`` run in-process: model and adapter loaded once, and the
    log-probabilities at the step that emits the first token of the type value captured."""

    def __init__(self) -> None:
        os.environ["HF_HUB_OFFLINE"] = "1"
        import mlx.core as mx
        dispatch = importlib.import_module("mlx_vlm.generate.dispatch")

        self.mx, self.dispatch = mx, dispatch
        self.loaded = None
        self.first_ids: dict[str, int] | None = None
        self.capture: dict | None = None
        real_load, real_stream = dispatch.load, dispatch.stream_generate

        def load_once(*a, **k):
            if self.loaded is None:
                self.loaded = real_load(*a, **k)
                tok = self.tokenizer()
                self.first_ids = first_token_ids(lambda s: tok.encode(s, add_special_tokens=False))
            return self.loaded

        def recording_stream(*a, **k):
            tok, ids = self.tokenizer(), []
            for r in real_stream(*a, **k):
                if r.finish_reason is None and r.token is not None:
                    if self.capture is not None and "logprobs" not in self.capture and TYPE_VALUE_OPENS.search(tok.decode(ids)):
                        cand = sorted(set(self.first_ids.values()))
                        vals = r.logprobs[self.mx.array(cand)].tolist()
                        self.capture.update(logprobs=dict(zip(cand, vals)), token=int(r.token))
                    ids.append(int(r.token))
                yield r

        dispatch.load, dispatch.stream_generate = load_once, recording_stream

    def tokenizer(self):
        proc = self.loaded[1]
        return proc.tokenizer if hasattr(proc, "tokenizer") else proc

    def __call__(self, prompt: str, image: str | None, adapter: str | None) -> tuple[str, dict]:
        self.capture = {}
        buf = io.StringIO()
        argv = sys.argv
        sys.argv = ["mlx_vlm.generate", *cli_args(prompt, image, adapter)]
        try:
            with contextlib.redirect_stdout(buf):
                self.dispatch.main()
        finally:
            sys.argv = argv
        cap, self.capture = self.capture, None
        if "logprobs" not in cap:
            return buf.getvalue(), {"p_H": None, "score": None, "score_method": "logprob_missing"}
        p_h, score = heading_score(self.first_ids, cap["logprobs"])
        extra = {"p_H": p_h, "score": score, "score_method": "logprob"}
        if cap["token"] not in self.first_ids.values():
            extra["type_token_invalid"] = True
        return buf.getvalue(), extra


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
    p.add_argument("--scores", action="store_true", help="generate in-process (run under the mlx_vlm interpreter) and write p_H, score, score_method per row")
    p.add_argument("--limit-model", type=int, default=None, help="with --scores: stop after this many model-decided rows (parity check)")
    a = p.parse_args()
    scorer = ScoringGenerator() if a.scores else None
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
            if scorer is not None and raw is None and a.limit_model is not None and n_model >= a.limit_model:
                break
            extra = {}
            if raw is not None:
                by = "rule"; n_rule += 1
                if scorer is not None:
                    extra = {"p_H": None, "score": 1.0, "score_method": "rule"}
            elif scorer is not None:
                model_raw, extra = scorer(prompt_for_row(card, r, keys), card.get("image"), a.adapter)
                raw = post_rules(model_raw, card)
                extra["vetoed"] = raw != model_raw
                by = "model"; n_model += 1
            else:
                raw = post_rules(generate(a.python, prompt_for_row(card, r, keys), card.get("image"), a.adapter), card)
                by = "model"; n_model += 1
            f.write(json.dumps({"id": r["id"], "raw": raw, "decided_by": by, **extra}) + "\n")
            f.flush()
    print(json.dumps({"rule": n_rule, "model": n_model, "out": str(a.out)}))


if __name__ == "__main__":
    main()
