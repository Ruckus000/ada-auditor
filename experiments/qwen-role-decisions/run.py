#!/usr/bin/env python3
"""Zero-shot role cards through mlx_vlm.generate.

ponytail: no extractor, no LoRA wrapper, no schema lib, no trainer. Training
is upstream `python -m mlx_vlm.lora`. This file only prompts, parses, and
scores.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROBES_PATH = HERE / "probes.json"
HEADING = {"H1", "H2", "H3", "H4", "H5", "H6"}
NEEDED = ("role", "action")


def card_prompt(stem: str, case: dict, with_page_band: bool = False) -> str:
    bits = [
        stem,
        f'Element: {case["text"]!r}',
        f'Font: {case["font_pt"]}pt',
        f'Weight: {case["weight"]}',
        f'Previous: {case["prev"]}',
        f'Next: {case["next"]}',
        f'Existing tag: {case["existing_tag"]}',
    ]
    if with_page_band:
        bits.append(f'Page: {case.get("page", "unknown")}')
        bits.append(f'Page band: {case.get("y_band", "unknown")}')
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
    auto_heading = parsed and role in HEADING and action == "retag"
    heading_probe = expect["role"] in HEADING and not trap
    if "action" in expect:
        role_ok = parsed and role == expect["role"] and action == expect["action"]
    elif trap:
        role_ok = parsed and not auto_heading
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
        "timid": bool(trap) and parsed and role in HEADING and action == "abstain",
        "heading_probe": heading_probe,
        "abstain": action == "abstain",
        "unsafe": bool(trap) and auto_heading,
    }


def gates(rows: list[dict]) -> dict:
    heading_n = sum(1 for r in rows if r["heading_probe"])
    heading_exact = sum(1 for r in rows if r["heading_probe"] and r["ok"])
    unsafe = sum(1 for r in rows if r["unsafe"])
    parse_fail = sum(1 for r in rows if not r["parsed"])
    abstain_all = bool(rows) and all(r.get("abstain") for r in rows)
    usefulness_ok = heading_n > 0 and not abstain_all and heading_exact * 10 >= heading_n * 8
    return {
        "parse_ok": parse_fail == 0,
        "unsafe": unsafe,
        "safety_ok": unsafe == 0 and parse_fail == 0,
        "heading_exact": heading_exact,
        "heading_n": heading_n,
        "usefulness_ok": usefulness_ok,
        "abstain_all": abstain_all,
        "timid": sum(1 for r in rows if r.get("timid")),
        "abstain": sum(1 for r in rows if r.get("abstain")),
        "pass": parse_fail == 0 and unsafe == 0 and usefulness_ok,
    }


def generate(
    model: str,
    prompt: str,
    image: str | None = None,
    thinking_mode: str = "disabled",
    thinking_budget: str | None = None,
    adapter_path: str | None = None,
) -> str:
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
        "--temperature",
        "0",
        "--thinking-mode",
        thinking_mode,
        "--no-verbose",
    ]
    if thinking_budget:
        cmd.extend(["--thinking-budget", thinking_budget])
    if adapter_path:
        cmd.extend(["--adapter-path", adapter_path])
    if image:
        cmd.extend(["--image", image])
    env = os.environ.copy()
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:] or f"exit {proc.returncode}")
    return proc.stdout


def flag_value(flag: str) -> str | None:
    if flag not in sys.argv:
        return None
    i = sys.argv.index(flag)
    if i + 1 >= len(sys.argv):
        return None
    return sys.argv[i + 1]


def run_cases(
    path: Path = PROBES_PATH,
    offline: bool = False,
    conservative: bool = False,
    thinking_mode: str = "disabled",
    thinking_budget: str | None = None,
    with_page_band: bool = False,
    image_dir: Path | None = None,
    adapter_path: str | None = None,
) -> list[dict]:
    bundle = json.loads(path.read_text())
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    stem = bundle["conservative_prompt_stem"] if conservative else bundle["prompt_stem"]
    rows = []
    for case in bundle["cases"]:
        image = None
        if image_dir is not None:
            candidate = image_dir / f'{case["id"].split("-", 1)[0]}.png'
            if candidate.exists():
                image = str(candidate)
        raw = generate(
            bundle["model"],
            card_prompt(stem, case, with_page_band=with_page_band),
            image=image,
            thinking_mode=thinking_mode,
            thinking_budget=thinking_budget,
            adapter_path=adapter_path,
        )
        pred = parse_json(raw)
        row = score(pred, case)
        row["raw"] = raw[-1500:]
        rows.append(row)
        shown = {k: v for k, v in row.items() if k != "raw"}
        if not row["parsed"]:
            shown["raw"] = row["raw"]
        print(json.dumps(shown, sort_keys=True))
    print(json.dumps({"gates": gates(rows)}, sort_keys=True))
    return rows


def self_check() -> None:
    trap = {
        "id": "trap-address",
        "expect": {"role": "P"},
        "trap": "heading",
    }
    heading = {"id": "01-h1", "expect": {"role": "H1"}}
    bad = score({"role": "H1", "action": "retag", "confidence": 0.97}, trap)
    good = score({"role": "P", "action": "keep", "confidence": 0.91}, trap)
    abstain = score(
        {"role": "H1", "action": "abstain", "confidence": 0.4},
        {"id": "abstain-stamp", "expect": {"role": "Artifact", "allow_abstain": True}, "trap": "abstain"},
    )
    parsed = parse_json('preamble\n{"role":"H2","action":"retag","confidence":0.5}\n')
    short = parse_json('{"role":"H2","action":"retag"}')
    think = parse_json('<think>not json</think>\n{"role":"H2","action":"retag","confidence":0.5}')
    low = score({"role": "H1", "action": "retag", "confidence": 0.4}, trap)
    timid = score({"role": "H1", "action": "abstain", "confidence": 0.95}, trap)
    exact = score({"role": "H1", "action": "keep", "confidence": 0.1}, heading)
    miss = score({"role": "P", "action": "keep", "confidence": 0.9}, heading)
    overfit = score(
        {"role": "H2", "action": "retag"},
        {"id": "02-h2", "expect": {"role": "H2", "action": "retag"}},
    )
    overfit_miss = score(
        {"role": "H2", "action": "keep"},
        {"id": "02-h2", "expect": {"role": "H2", "action": "retag"}},
    )
    assert bad["ok"] is False and bad["auto_heading"] is True
    assert good["ok"] is True
    assert abstain["ok"] is True
    assert parsed == {"role": "H2", "action": "retag", "confidence": 0.5}
    assert think == parsed
    assert short == {"role": "H2", "action": "retag"}
    assert parse_json("not json") is None
    assert low["ok"] is False and low["auto_heading"] is True
    assert timid["ok"] is True and timid["auto_heading"] is False
    assert timid["timid"] is True
    assert overfit["ok"] is True
    assert overfit_miss["ok"] is False
    eleven_ok = [exact] * 9 + [miss] * 2 + [good] * 6
    eight_ok = [exact] * 8 + [miss] * 3 + [good] * 6
    abstain_all = [score({"role": "H1", "action": "abstain", "confidence": 0.5}, heading)] * 11
    assert gates(eleven_ok)["pass"] is True
    assert gates(eleven_ok)["heading_exact"] == 9
    assert gates(eight_ok)["usefulness_ok"] is False
    assert gates(abstain_all)["usefulness_ok"] is False
    assert gates(abstain_all)["abstain_all"] is True
    unsafe_mix = [exact] * 11 + [bad]
    assert gates(unsafe_mix)["safety_ok"] is False
    assert gates(unsafe_mix)["pass"] is False


if __name__ == "__main__":
    if "--self-check" in sys.argv:
        self_check()
        print("ok")
        raise SystemExit(0)
    image_dir = flag_value("--image-dir")
    cards = flag_value("--path")
    run_cases(
        path=Path(cards) if cards else PROBES_PATH,
        offline="--offline" in sys.argv,
        conservative="--conservative" in sys.argv,
        thinking_mode=flag_value("--thinking-mode") or "disabled",
        thinking_budget=flag_value("--thinking-budget"),
        with_page_band="--with-page-band" in sys.argv,
        image_dir=Path(image_dir) if image_dir else None,
        adapter_path=flag_value("--adapter-path"),
    )
