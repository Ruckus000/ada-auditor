#!/usr/bin/env python3
"""Zero-shot role cards through mlx_vlm.generate.

ponytail: no extractor, no LoRA wrapper, no schema lib. Ceiling is ten
hand-authored cards. Add a PDF dump only if these cards cannot pose the
heading-promotion kill; add lora.py only if Gate 2 fails that kill and
JSON still parses.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES_PATH = HERE / "cases.json"
HEADING = {"H1", "H2", "H3", "H4", "H5", "H6"}
NEEDED = ("role", "action", "confidence")


def card_prompt(stem: str, case: dict) -> str:
    bits = [
        stem,
        f'Element: {case["text"]!r}',
        f'Font: {case["font_pt"]}pt',
        f'Weight: {case["weight"]}',
        f'Previous: {case["prev"]}',
        f'Next: {case["next"]}',
        f'Existing tag: {case["existing_tag"]}',
    ]
    if case.get("bullet"):
        bits.append("Marker: list bullet")
    if case.get("centered"):
        bits.append("Alignment: centered")
    bits.append("JSON:")
    return "\n".join(bits)


def parse_json(text: str) -> dict | None:
    stripped = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    match = re.search(r"\{.*\}", stripped, flags=re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    if any(k not in data for k in NEEDED):
        return None
    return data


def score(pred: dict | None, case: dict) -> dict:
    expect = case["expect"]
    parsed = pred is not None
    role = pred.get("role") if pred else None
    action = pred.get("action") if pred else None
    try:
        conf = float(pred["confidence"]) if pred else None
    except (TypeError, ValueError, KeyError):
        conf = None
    trap = case.get("trap")
    auto_heading = (
        parsed
        and role in HEADING
        and conf is not None
        and conf >= 0.80
    )
    if trap == "heading":
        role_ok = parsed and not auto_heading
    elif trap == "abstain":
        role_ok = parsed and (action == "abstain" or (conf is not None and conf < 0.80) or role == expect["role"])
    else:
        role_ok = parsed and role == expect["role"]
    return {
        "id": case["id"],
        "parsed": parsed,
        "role": role,
        "action": action,
        "confidence": conf,
        "ok": role_ok,
        "auto_heading": auto_heading,
        "trap": trap,
    }


def generate(model: str, prompt: str, image: str | None = None) -> str:
    cmd = [
        sys.executable,
        "-m",
        "mlx_vlm.generate",
        "--model",
        model,
        "--prompt",
        prompt,
        "--max-tokens",
        "256",
        "--temp",
        "0",
    ]
    if image:
        cmd.extend(["--image", image])
    env = os.environ.copy()
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:] or f"exit {proc.returncode}")
    return proc.stdout


def run_cases(path: Path = CASES_PATH, offline: bool = False) -> list[dict]:
    bundle = json.loads(path.read_text())
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    rows = []
    for case in bundle["cases"]:
        raw = generate(bundle["model"], card_prompt(bundle["prompt_stem"], case))
        pred = parse_json(raw)
        row = score(pred, case)
        row["raw"] = raw[-1500:]
        rows.append(row)
        print(json.dumps({k: row[k] for k in row if k != "raw"}, sort_keys=True))
    return rows


def self_check() -> None:
    trap = {
        "id": "trap-address",
        "expect": {"role": "P"},
        "trap": "heading",
    }
    bad = score({"role": "H1", "action": "retag", "confidence": 0.97}, trap)
    good = score({"role": "P", "action": "keep", "confidence": 0.91}, trap)
    abstain = score(
        {"role": "H1", "action": "abstain", "confidence": 0.4},
        {"id": "abstain-stamp", "expect": {"role": "Artifact", "allow_abstain": True}, "trap": "abstain"},
    )
    parsed = parse_json('preamble\n{"role":"H2","action":"retag","confidence":0.5}\n')
    assert bad["ok"] is False and bad["auto_heading"] is True
    assert good["ok"] is True
    assert abstain["ok"] is True
    assert parsed == {"role": "H2", "action": "retag", "confidence": 0.5}
    assert parse_json("not json") is None


if __name__ == "__main__":
    if "--self-check" in sys.argv:
        self_check()
        print("ok")
        raise SystemExit(0)
    offline = "--offline" in sys.argv
    run_cases(offline=offline)
