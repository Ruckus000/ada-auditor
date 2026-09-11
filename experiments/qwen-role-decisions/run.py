#!/usr/bin/env python3
"""Zero-shot role cards through mlx_vlm.generate.

ponytail: no extractor, no LoRA wrapper, no schema lib, no trainer. Training
is upstream `python -m mlx_vlm.lora`. This file only prompts, parses, and
scores. `--role-only` hides existing_tag and derives keep/retag from the
predicted role. `--r2-veto` applies Headings.java R2 (no letters → P) after
the model, keeping model_role. `--emit-verify-sft` writes image-bearing
rows for the separate eligibility adapter; `--eval-verify-marked` runs it.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
import base64

HERE = Path(__file__).resolve().parent
PROBES_PATH = HERE / "probes.json"
HEADING = {"H1", "H2", "H3", "H4", "H5", "H6"}
NEEDED = ("role",)
ROLE_ONLY_STEM = (
    "You assign one PDF tag role. Return ONLY JSON with key role. "
    "role is one of H1,H2,H3,H4,H5,H6,P,LI,Table,Figure,Artifact. "
    "A heading introduces a semantic section or subsection of the document. "
    "Typography alone is insufficient: large, bold, centered, or isolated text "
    "is not a heading merely because it looks prominent. Addresses, running "
    "headers, running footers, stamps, watermarks, table labels, and other "
    "page furniture are not headings. Do not invent facts."
)


def card_prompt(
    stem: str,
    case: dict,
    with_page_band: bool = False,
    hide_existing_tag: bool = False,
) -> str:
    bits = [
        stem,
        f'Element: {case["text"]!r}',
        f'Font: {case["font_pt"]}pt',
        f'Weight: {case["weight"]}',
        f'Previous: {case["prev"]}',
        f'Next: {case["next"]}',
    ]
    if not hide_existing_tag:
        bits.append(f'Existing tag: {case["existing_tag"]}')
    if with_page_band:
        bits.append(f'Page: {case.get("page", "unknown")}')
        bits.append(f'Page band: {case.get("y_band", "unknown")}')
    bits.append("JSON:")
    return "\n".join(bits)


def r2_ornament(text: str) -> bool:
    """Headings.java R2: !t.chars().anyMatch(Character::isLetter). Empty skipped."""
    if not text:
        return False
    return not any(ch.isalpha() for ch in text)


def apply_r2_veto(pred: dict | None, case: dict) -> dict | None:
    model_role = pred.get("role") if pred else None
    veto = r2_ornament(case["text"])
    role = "P" if veto else model_role
    if role is None:
        return None
    out = dict(pred or {})
    out["model_role"] = model_role
    out["r2_veto"] = veto
    out["role"] = role
    out["action"] = "keep" if role == case["existing_tag"] else "retag"
    return out


OUT_OF_FLOW = frozenset({"Figure", "Table", "L", "LI", "Caption", "Formula"})
CONTAINERS = frozenset({"Table", "Figure"})


def source_eligible(tag: str) -> bool:
    """Arm A: only document-flow types may be promoted to H1–H6."""
    return (tag or "") not in OUT_OF_FLOW


def ancestry_eligible(ancestors: list | None) -> bool:
    """Arm B: text inside a Table or Figure is not a document heading."""
    return not any(a in CONTAINERS for a in (ancestors or []))


def apply_structural_scope(pred: dict | None, case: dict, arm: str = "A") -> dict | None:
    """Scope first. existing_tag is not sent to Qwen; it may veto promotion."""
    tag = case.get("existing_tag") or ""
    reason = None
    if not source_eligible(tag):
        reason = "source_type"
    elif arm in {"B", "C"} and not ancestry_eligible(case.get("ancestors")):
        reason = "ancestry"
    if reason is None:
        if pred is None:
            return None
        out = dict(pred)
        out["qwen_called"] = True
        out["scope"] = None
        return out
    role = "P" if reason == "ancestry" and tag in HEADING else tag
    model_role = None
    if pred:
        model_role = pred.get("model_role")
        if model_role is None:
            model_role = pred.get("role")
    return {
        "role": role,
        "model_role": model_role,
        "qwen_called": False,
        "scope": reason,
        "r5_table_box": bool(case.get("in_table_box")),
        "r2_veto": False,
        "action": "keep" if role == tag else "retag",
    }


def apply_r5_scope(pred: dict | None, case: dict) -> dict:
    """Headings.java R5 as a promotion veto. existing_tag still withheld from Qwen."""
    tag = case.get("existing_tag") or ""
    role = "P" if tag in HEADING else tag
    model_role = None
    if pred:
        model_role = pred.get("model_role")
        if model_role is None:
            model_role = pred.get("role")
    return {
        "role": role,
        "model_role": model_role,
        "qwen_called": False,
        "scope": pred.get("scope") if pred else None,
        "r5_table_box": True,
        "r2_veto": False,
        "action": "keep" if role == tag else "retag",
    }


def collapse_glyph_spaces(text: str) -> str:
    """PDFMarkedContentExtractor often yields one glyph per token. Headings.java R1."""
    tokens = text.split()
    if not tokens:
        return text
    if sum(1 for tok in tokens if len(tok) == 1) / len(tokens) >= 0.8:
        return "".join(tokens)
    return text


def blocks_to_cards(blocks: list[dict]) -> tuple[list[dict], list[dict]]:
    usable = []
    failed = []
    for block in blocks:
        raw = block.get("text") or ""
        if not str(raw).strip():
            failed.append({"locator": block.get("locator"), "reason": "empty_text"})
            continue
        if block.get("font_pt") is None:
            failed.append({"locator": block.get("locator"), "reason": "missing_font"})
            continue
        usable.append(block)
    cards = []
    for i, block in enumerate(usable):
        prev_t = collapse_glyph_spaces(usable[i - 1]["text"]) if i else "none"
        next_t = collapse_glyph_spaces(usable[i + 1]["text"]) if i + 1 < len(usable) else "none"
        cards.append(
            {
                "locator": block["locator"],
                "id": block["locator"],
                "text": collapse_glyph_spaces(block["text"]),
                "font_pt": block["font_pt"],
                "weight": block["weight"],
                "prev": prev_t,
                "next": next_t,
                "existing_tag": block["existing_tag"],
                "ancestors": list(block.get("ancestors") or []),
                "in_table_box": bool(block.get("in_table_box")),
                "page": block.get("page"),
                "x0": block.get("x0"),
                "y0": block.get("y0"),
                "x1": block.get("x1"),
                "y1": block.get("y1"),
            }
        )
    return cards, failed


def text_norm(s: str) -> str:
    """compare.mjs: lower, strip non-alnum. Glyph spaces vanish under this."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def dumps_to_cards(dumps: list[dict]) -> tuple[list[dict], list[dict]]:
    """One document at a time so prev/next never cross a PDF boundary."""
    cards: list[dict] = []
    failed: list[dict] = []
    for dump in dumps:
        stem = dump.get("stem") or dump.get("pdf")
        if not dump.get("hasStructTree"):
            failed.append(
                {
                    "locator": stem,
                    "reason": dump.get("error") or "no_structure_tree",
                }
            )
            continue
        c, f = blocks_to_cards(dump.get("blocks") or [])
        cards.extend(c)
        failed.extend(f)
    return cards, failed


def attach_probe_expect(
    cards: list[dict],
    probes: list[dict],
    by_doc: bool = False,
) -> tuple[list[dict], list[str]]:
    """Match PDF cards to exposed probe texts. First unused probe per norm wins.

    by_doc: probe ids `NN-...` only match locators whose stem starts with `NN`.
    """
    by_norm: dict[str, list[dict]] = {}
    for probe in probes:
        by_norm.setdefault(text_norm(probe["text"]), []).append(probe)
    used: set[str] = set()
    matched: list[dict] = []
    for card in cards:
        loc = str(card.get("locator") or "")
        doc_prefix = loc.split("-", 1)[0] if loc else ""
        hits = [
            p
            for p in by_norm.get(text_norm(card["text"]), [])
            if p["id"] not in used
            and (
                not by_doc
                or str(p["id"]).startswith(f"{doc_prefix}-")
            )
        ]
        if not hits:
            continue
        probe = hits[0]
        used.add(probe["id"])
        row = dict(card)
        row["id"] = probe["id"]
        row["probe_id"] = probe["id"]
        row["expect"] = probe["expect"]
        if "trap" in probe:
            row["trap"] = probe["trap"]
        matched.append(row)
    missing = [p["id"] for p in probes if p["id"] not in used]
    return matched, missing


def card_bundle(cards: list[dict], model: str = "mlx-community/Qwen3.5-4B-MLX-4bit") -> dict:
    return {"model": model, "cases": cards}


def decide_card(
    pred: dict | None,
    case: dict,
    role_only: bool,
    r2_veto: bool,
    arm: str = "A",
    r5_veto: bool = False,
) -> dict | None:
    scoped = apply_structural_scope(pred, case, arm=arm)
    if scoped is not None and not scoped.get("qwen_called"):
        out = dict(scoped)
        out["r5_table_box"] = bool(case.get("in_table_box"))
        return out
    if r5_veto and case.get("in_table_box"):
        return apply_r5_scope(pred, case)
    if scoped is None:
        return None
    if role_only and "role" in scoped:
        scoped = dict(scoped)
        scoped["action"] = "keep" if scoped["role"] == case["existing_tag"] else "retag"
    if r2_veto:
        scoped = apply_r2_veto(scoped, case)
        if scoped is not None:
            scoped["qwen_called"] = True
            scoped["scope"] = None
            scoped["r5_table_box"] = bool(case.get("in_table_box"))
    elif scoped is not None:
        scoped = dict(scoped)
        scoped["r5_table_box"] = bool(case.get("in_table_box"))
    return scoped


def prediction_record(case: dict, pred: dict | None, raw: str) -> dict:
    model_role = pred.get("model_role") if pred else None
    if model_role is None and pred is not None:
        model_role = pred.get("role")
    r2_match = bool(pred.get("r2_veto")) if pred else r2_ornament(case.get("text") or "")
    final_role = pred.get("role") if pred else None
    action = pred.get("action") if pred else None
    return {
        "locator": case.get("locator") or case.get("id"),
        "text": case.get("text"),
        "font_pt": case.get("font_pt"),
        "weight": case.get("weight"),
        "prev": case.get("prev"),
        "next": case.get("next"),
        "existing_tag": case.get("existing_tag"),
        "ancestors": list(case.get("ancestors") or []),
        "model_role": model_role,
        "r2_match": r2_match,
        "scope": pred.get("scope") if pred else None,
        "qwen_called": bool(pred.get("qwen_called")) if pred else False,
        "r5_table_box": bool((pred or {}).get("r5_table_box", case.get("in_table_box"))),
        "page_verify": None if pred is None else pred.get("page_verify"),
        "page_verify_parsed": bool(pred.get("page_verify_parsed")) if pred else False,
        "verify_input": None if pred is None else pred.get("verify_input"),
        "verification_failure": bool(pred.get("verification_failure")) if pred else False,
        "visual_role": None if pred is None else pred.get("visual_role"),
        "visual_heading": None if pred is None else pred.get("visual_heading"),
        "final_role": final_role,
        "derived_action": action,
        "parsed": pred is not None,
        "raw": (raw or "")[-1500:],
    }


def score_holdout(preds: list[dict], gt_by_stem: dict[str, dict]) -> dict:
    """Score frozen predictions against headingHierarchy. No confidence."""
    heading_rows: list[dict] = []
    nonheading_rows: list[dict] = []
    unmatched_gt: list[dict] = []
    r2_matches: list[dict] = []
    r2_heading_collisions: list[dict] = []
    for pred in preds:
        locator = str(pred.get("locator") or "")
        stem = locator.rsplit(":", 1)[0]
        gt = gt_by_stem.get(stem) or {}
        headings = list(gt.get("headingHierarchy") or [])
        norms = [text_norm(h["text"]) for h in headings]
        n = text_norm(pred.get("text") or "")
        is_gt_heading = bool(n) and n in norms
        row = dict(pred)
        row["stem"] = stem
        row["gt_heading"] = is_gt_heading
        if pred.get("r2_match"):
            r2_matches.append(row)
            if is_gt_heading:
                r2_heading_collisions.append(row)
        if is_gt_heading:
            heading_rows.append(row)
        else:
            nonheading_rows.append(row)
    # Exact / detection: each GT heading matched to at most one prediction, in order.
    used_locators: set[str] = set()
    heading_exact = 0
    heading_detect = 0
    heading_demote = 0
    hierarchy = 0
    heading_n = 0
    for stem, gt in gt_by_stem.items():
        for h in gt.get("headingHierarchy") or []:
            heading_n += 1
            want = f"H{h['level']}"
            n = text_norm(h["text"])
            hit = next(
                (
                    p
                    for p in preds
                    if str(p.get("locator") or "").rsplit(":", 1)[0] == stem
                    and text_norm(p.get("text") or "") == n
                    and p.get("locator") not in used_locators
                ),
                None,
            )
            if hit is None:
                unmatched_gt.append({"stem": stem, "text": h["text"], "level": h["level"]})
                continue
            used_locators.add(hit["locator"])
            got = hit.get("final_role")
            if got == want:
                heading_exact += 1
                heading_detect += 1
            elif got in HEADING:
                heading_detect += 1
                hierarchy += 1
            else:
                heading_demote += 1
    unsafe = [
        p
        for p in nonheading_rows
        if p.get("final_role") in HEADING and p.get("derived_action") == "retag"
    ]
    model_unsafe = [
        p
        for p in nonheading_rows
        if p.get("model_role") in HEADING and p.get("model_role") != p.get("existing_tag")
    ]
    evaluable = [p for p in preds if p.get("parsed")]
    role_exact = 0
    for p in heading_rows:
        stem = str(p.get("locator") or "").rsplit(":", 1)[0]
        want = None
        n = text_norm(p.get("text") or "")
        for h in (gt_by_stem.get(stem) or {}).get("headingHierarchy") or []:
            if text_norm(h["text"]) == n:
                want = f"H{h['level']}"
                break
        if want and p.get("final_role") == want:
            role_exact += 1
    nonheading_role_ok = sum(
        1 for p in nonheading_rows if p.get("parsed") and p.get("final_role") not in HEADING
    )
    final_role_n = len(heading_rows) + len(nonheading_rows)
    final_role_ok = role_exact + nonheading_role_ok
    action_ok = 0
    action_n = 0
    for p in preds:
        if not p.get("parsed") or p.get("final_role") is None:
            continue
        action_n += 1
        want_action = "keep" if p.get("final_role") == p.get("existing_tag") else "retag"
        if p.get("derived_action") == want_action:
            action_ok += 1
    parse_fail = sum(1 for p in preds if not p.get("parsed"))
    usefulness_ok = heading_n > 0 and heading_exact * 10 >= heading_n * 8
    return {
        "evaluable": len(preds),
        "parsed": len(evaluable),
        "parse_fail": parse_fail,
        "heading_n": heading_n,
        "heading_exact": heading_exact,
        "heading_detect": heading_detect,
        "heading_demote": heading_demote,
        "hierarchy_confusion": hierarchy,
        "unmatched_gt_headings": unmatched_gt,
        "unsafe": len(unsafe),
        "unsafe_locators": [u.get("locator") for u in unsafe],
        "model_unsafe": len(model_unsafe),
        "r2_matches": len(r2_matches),
        "r2_match_locators": [r.get("locator") for r in r2_matches],
        "r2_true_heading_collisions": len(r2_heading_collisions),
        "r2_collision_locators": [r.get("locator") for r in r2_heading_collisions],
        "final_role_ok": final_role_ok,
        "final_role_n": final_role_n,
        "derived_action_ok": action_ok,
        "derived_action_n": action_n,
        "usefulness_ok": usefulness_ok,
        "safety_ok": len(unsafe) == 0 and parse_fail == 0,
        "pass": parse_fail == 0
        and len(unsafe) == 0
        and usefulness_ok
        and len(r2_heading_collisions) == 0,
    }


REPO = HERE.parents[1]
PDFBOX = HERE.parent / "document-remediation" / "vendor" / "pdfbox-app-3.0.8.jar"
STRUCT_TEXT = REPO / "src" / "integrations" / "documents" / "java" / "StructText.java"
CARDS_JAVA = HERE / "Cards.java"
MARK_JAVA = HERE / "Mark.java"
CARDS_CLASSES = HERE / "out" / "classes"
JAVA_HOME = Path(os.environ.get("JAVA_HOME", "/opt/homebrew/opt/openjdk@17"))
MODEL = "mlx-community/Qwen3.5-4B-MLX-4bit"


def compile_cards() -> None:
    CARDS_CLASSES.mkdir(parents=True, exist_ok=True)
    javac = JAVA_HOME / "bin" / "javac"
    cmd = [
        str(javac),
        "-cp",
        str(PDFBOX),
        "-d",
        str(CARDS_CLASSES),
        str(STRUCT_TEXT),
        str(CARDS_JAVA),
    ]
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:] or f"exit {proc.returncode}")


def dump_pdf(pdf: Path, compile: bool = True) -> dict:
    if compile:
        compile_cards()
    java = JAVA_HOME / "bin" / "java"
    cmd = [
        str(java),
        "-Djava.awt.headless=true",
        "-cp",
        f"{PDFBOX}:{CARDS_CLASSES}",
        "Cards",
        str(pdf),
    ]
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:] or f"exit {proc.returncode}")
    return json.loads(proc.stdout)


def dump_dir(folder: Path) -> list[dict]:
    compile_cards()
    dumps = []
    for pdf in sorted(folder.glob("*.pdf")):
        dumps.append(dump_pdf(pdf, compile=False))
    return dumps


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


HEADING_VERIFY_STEM = (
    "Look at the page image. The specified text appears on this page. "
    "Is that text a document section or subsection heading, rather than "
    "page furniture, chart or table labeling, a banner, stamp, watermark, "
    "or other non-document-heading content? "
    "Return ONLY JSON with key heading whose value is true or false. "
    "Do not assign H1, H2, or H3."
)
MARKED_VERIFY_STEM = (
    "You are shown a PDF page. The outlined rectangle marks the exact element "
    "being evaluated. Decide whether the marked element is a document section "
    "or subsection heading, rather than table/chart labeling, a banner, stamp, "
    "page furniture, or other non-document-heading content. "
    "Return ONLY {\"heading\":true} or {\"heading\":false}."
)
MARKED_ELIGIBILITY_STEM = (
    "You are shown a PDF page. The outlined rectangle marks the exact "
    "Element described below. Decide whether that marked element is a "
    "document section or subsection heading rather than table/chart "
    "labeling, a banner, stamp, page furniture, or other "
    "non-document-heading content. "
    'Return ONLY {"heading":true} or {"heading":false}.'
)
PART10_VERIFY_LOCATORS = (
    "h01-big-text-not-heading:4",
    "h01-big-text-not-heading:11",
    "h02-headings-look-like-body:0",
    "h06-mixed-table-borders:2",
    "h06-mixed-table-borders:13",
    "h06-mixed-table-borders:14",
    "h09-three-column:8",
    "h11-chart-labels-as-headings:4",
    "h11-chart-labels-as-headings:7",
    "h12-visible-title-no-metadata:5",
    "h13-first-big-text-not-title:1",
    "h16-inconsistent-hierarchy:4",
    "h16-inconsistent-hierarchy:6",
    "h16-inconsistent-hierarchy:10",
)
PREVIEW_JAVA = REPO / "src" / "integrations" / "documents" / "java" / "Preview.java"
FIGURE_ORDER_JAVA = REPO / "src" / "integrations" / "documents" / "java" / "FigureOrder.java"
DEV_MAP_PDF = (
    HERE.parent / "document-remediation" / "out" / "bridge-tagged" / "01-simple-text.pdf"
)


def heading_verify_prompt(text: str, page_1based: int | None) -> str:
    bits = [HEADING_VERIFY_STEM, f"Text: {text!r}"]
    if page_1based is not None:
        bits.append(f"Page: {page_1based}")
    bits.append("JSON:")
    return "\n".join(bits)


def parse_heading_flag(text: str) -> bool | None:
    stripped = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    match = re.search(r"\{.*\}", stripped, flags=re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or "heading" not in data:
        return None
    value = data["heading"]
    if value is True or value is False:
        return value
    return None


def compile_preview() -> None:
    CARDS_CLASSES.mkdir(parents=True, exist_ok=True)
    javac = JAVA_HOME / "bin" / "javac"
    cmd = [
        str(javac),
        "-cp",
        str(PDFBOX),
        "-d",
        str(CARDS_CLASSES),
        str(FIGURE_ORDER_JAVA),
        str(PREVIEW_JAVA),
    ]
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:] or f"exit {proc.returncode}")


def render_page_png(pdf: Path, page_1based: int, dest: Path) -> Path:
    compile_preview()
    dest.parent.mkdir(parents=True, exist_ok=True)
    java = JAVA_HOME / "bin" / "java"
    cmd = [
        str(java),
        "-Djava.awt.headless=true",
        "-cp",
        f"{PDFBOX}:{CARDS_CLASSES}",
        "Preview",
        str(pdf),
        str(page_1based),
    ]
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:] or f"exit {proc.returncode}")
    payload = json.loads(proc.stdout)
    dest.write_bytes(base64.b64decode(payload["png"]))
    return dest


def compile_mark() -> None:
    CARDS_CLASSES.mkdir(parents=True, exist_ok=True)
    javac = JAVA_HOME / "bin" / "javac"
    cmd = [
        str(javac),
        "-cp",
        str(PDFBOX),
        "-d",
        str(CARDS_CLASSES),
        str(MARK_JAVA),
    ]
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:] or f"exit {proc.returncode}")


def mark_page_png(
    pdf: Path,
    page_1based: int,
    box: tuple[float, float, float, float],
    src: Path,
    dest: Path,
    check_only: bool = False,
) -> dict:
    compile_mark()
    dest.parent.mkdir(parents=True, exist_ok=True)
    java = JAVA_HOME / "bin" / "java"
    cmd = [
        str(java),
        "-Djava.awt.headless=true",
        "-cp",
        f"{PDFBOX}:{CARDS_CLASSES}",
        "Mark",
    ]
    if check_only:
        cmd.append("--check")
    cmd.extend(
        [
            str(pdf),
            str(page_1based),
            f"{box[0]:.4f}",
            f"{box[1]:.4f}",
            f"{box[2]:.4f}",
            f"{box[3]:.4f}",
            str(src),
        ]
    )
    if not check_only:
        cmd.append(str(dest))
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode not in (0, 1) or (not check_only and proc.returncode != 0):
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:] or f"exit {proc.returncode}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def check_box_map() -> dict:
    if not DEV_MAP_PDF.is_file():
        raise SystemExit(f"missing development pdf {DEV_MAP_PDF}")
    dump = dump_pdf(DEV_MAP_PDF)
    block = next(
        (
            b
            for b in dump.get("blocks") or []
            if b.get("existing_tag") == "H1"
            and "Quarterly Operations Summary" in (b.get("text") or "")
            and b.get("x0") is not None
        ),
        None,
    )
    if block is None:
        raise SystemExit("development H1 box missing from Cards dump")
    page_1 = int(block["page"]) + 1
    png = HERE / "out" / "box-map" / "01-simple-text-p1.png"
    render_page_png(DEV_MAP_PDF, page_1, png)
    mapped = mark_page_png(
        DEV_MAP_PDF,
        page_1,
        (float(block["x0"]), float(block["y0"]), float(block["x1"]), float(block["y1"])),
        png,
        HERE / "out" / "box-map" / "01-simple-text-p1-marked.png",
        check_only=True,
    )
    if not mapped.get("inside"):
        raise SystemExit(f"mapped rectangle outside image bounds: {mapped}")
    return {"locator": block["locator"], **mapped}


def needs_page_verify(pred: dict | None, case: dict) -> bool:
    if not pred or not pred.get("qwen_called"):
        return False
    if pred.get("r2_veto"):
        return False
    role = pred.get("role")
    if role not in HEADING:
        return False
    exist = case.get("existing_tag") or ""
    return exist not in HEADING or exist != role


def apply_page_verify(
    pred: dict,
    case: dict,
    heading: bool | None,
    verify_input: str = "full",
) -> dict:
    out = dict(pred)
    out["page_verify"] = heading
    out["page_verify_parsed"] = heading is not None
    out["verify_input"] = verify_input
    out["verification_failure"] = heading is None
    if heading is True:
        return out
    tag = case.get("existing_tag") or ""
    out["role"] = tag
    out["action"] = "keep"
    return out


MARKED_ROLE_LOCALIZER = (
    "The outlined rectangle in the image marks the Element described below."
)
ADAPTER_ROLE = HERE / "out" / "adapter-role"
ADAPTER_VERIFY_MARKED = HERE / "out" / "adapter-verify-marked"


def marked_role_prompt(case: dict) -> str:
    return MARKED_ROLE_LOCALIZER + "\n" + card_prompt(
        ROLE_ONLY_STEM, case, hide_existing_tag=True
    )


def marked_eligibility_prompt(case: dict) -> str:
    return card_prompt(MARKED_ELIGIBILITY_STEM, case, hide_existing_tag=True)


def gt_heading(case: dict) -> bool:
    expect = case.get("expect") or {}
    return (expect.get("role") or "") in HEADING


def verifier_skip_reason(case: dict) -> str | None:
    """Production never asks the verifier after these upstream gates."""
    tag = case.get("existing_tag") or ""
    if not source_eligible(tag):
        return "source_type"
    if not ancestry_eligible(case.get("ancestors")):
        return "ancestry"
    if r2_ornament(case.get("text") or ""):
        return "r2"
    return None


def ensure_marked_png(
    case: dict,
    pdf_dir: Path,
    pages_dir: Path,
    png_cache: dict[tuple[str, int], Path],
) -> Path:
    loc = str(case["locator"])
    stem = loc.rsplit(":", 1)[0]
    page_1 = int(case["page"]) + 1
    cache_key = (stem, page_1)
    png = png_cache.get(cache_key)
    if png is None:
        dest = pages_dir / f"{stem}-p{page_1}.png"
        if dest.is_file():
            png = dest
        else:
            png = render_page_png(pdf_dir / f"{stem}.pdf", page_1, dest)
        png_cache[cache_key] = png
    marked = pages_dir / "marked" / f"{loc.replace(':', '_')}.png"
    if not marked.is_file():
        mark_page_png(
            pdf_dir / f"{stem}.pdf",
            page_1,
            (
                float(case["x0"]),
                float(case["y0"]),
                float(case["x1"]),
                float(case["y1"]),
            ),
            png,
            marked,
        )
    return marked


def emit_verify_sft(
    pdf_dir: Path,
    match_path: Path,
    out_dir: Path,
    pages_dir: Path,
) -> dict:
    dumps = dump_dir(pdf_dir)
    cards, failed = dumps_to_cards(dumps)
    probes = json.loads(match_path.read_text())["cases"]
    matched, missing = attach_probe_expect(cards, probes, by_doc=True)
    png_cache: dict[tuple[str, int], Path] = {}
    rows: list[dict] = []
    excluded: list[dict] = []
    for case in matched:
        reason = verifier_skip_reason(case)
        if reason:
            excluded.append(
                {
                    "id": case.get("id"),
                    "locator": case.get("locator"),
                    "reason": reason,
                    "gt_heading": gt_heading(case),
                }
            )
            continue
        box_ok = all(case.get(k) is not None for k in ("x0", "y0", "x1", "y1", "page"))
        if not box_ok:
            excluded.append(
                {
                    "id": case.get("id"),
                    "locator": case.get("locator"),
                    "reason": "missing_box",
                    "gt_heading": gt_heading(case),
                }
            )
            continue
        marked = ensure_marked_png(case, pdf_dir, pages_dir, png_cache)
        heading = gt_heading(case)
        rows.append(
            {
                "messages": [
                    {"role": "user", "content": marked_eligibility_prompt(case)},
                    {
                        "role": "assistant",
                        "content": json.dumps(
                            {"heading": heading}, separators=(",", ":")
                        ),
                    },
                ],
                "image": str(marked.resolve()),
            }
        )
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "train.json").write_text(json.dumps(rows, indent=2) + "\n")
    docs = sorted(
        {
            str(case.get("locator") or "").rsplit(":", 1)[0]
            for case in matched
            if verifier_skip_reason(case) is None
            and all(case.get(k) is not None for k in ("x0", "y0", "x1", "y1", "page"))
        }
    )
    n_true = sum(
        1
        for case in matched
        if verifier_skip_reason(case) is None
        and all(case.get(k) is not None for k in ("x0", "y0", "x1", "y1", "page"))
        and gt_heading(case)
    )
    manifest = {
        "n": len(rows),
        "heading_true": n_true,
        "heading_false": len(rows) - n_true,
        "documents": docs,
        "matched": [c.get("id") for c in matched],
        "missing": missing,
        "excluded": excluded,
        "bridge_failures": failed,
        "train_json": str(out_dir / "train.json"),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def verifier_gate(rows: list[dict]) -> dict:
    parsed_n = sum(1 for r in rows if r.get("verify_parsed"))
    n = len(rows)
    gt_pos = [r for r in rows if r.get("gt_heading")]
    gt_neg = [r for r in rows if not r.get("gt_heading")]
    tp = sum(1 for r in gt_pos if r.get("heading") is True)
    fn = sum(1 for r in gt_pos if r.get("heading") is False)
    tn = sum(1 for r in gt_neg if r.get("heading") is False)
    fp = sum(1 for r in gt_neg if r.get("heading") is True)
    vetoes = [
        r.get("id") or r.get("locator")
        for r in gt_pos
        if r.get("heading") is False
    ]
    unsafe = [r.get("id") or r.get("locator") for r in rows if r.get("unsafe")]
    all_false = bool(rows) and all(r.get("heading") is False for r in rows)
    h1 = next((r for r in rows if (r.get("expect_role") == "H1")), None)
    return {
        "n": n,
        "parse_ok": parsed_n == n and n > 0,
        "true_heading_vetoes": vetoes,
        "unsafe": unsafe,
        "h1_eligible": None if h1 is None else h1.get("heading") is True,
        "all_false": all_false,
        "accuracy": None if n == 0 else (tp + tn) / n,
        "heading_recall": None if not gt_pos else tp / len(gt_pos),
        "nonheading_rejection": None if not gt_neg else tn / len(gt_neg),
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
        "pass": parsed_n == n
        and n > 0
        and not vetoes
        and not unsafe
        and not all_false
        and (h1 is None or h1.get("heading") is True),
    }


def eval_verify_marked(
    pdf_dir: Path,
    match_path: Path,
    out_dir: Path,
    pages_dir: Path,
    role_adapter: Path,
    verify_adapter: Path,
    omit_image: bool = False,
) -> dict:
    dumps = dump_dir(pdf_dir)
    cards, failed = dumps_to_cards(dumps)
    probes = json.loads(match_path.read_text())["cases"]
    matched, missing = attach_probe_expect(cards, probes, by_doc=True)
    png_cache: dict[tuple[str, int], Path] = {}
    rows: list[dict] = []
    for case in matched:
        incoming = None
        role_raw = ""
        pre = apply_structural_scope(None, case, arm="B")
        if pre is not None and not pre.get("qwen_called"):
            decided = dict(pre)
            decided["r5_table_box"] = bool(case.get("in_table_box"))
        else:
            role_raw = generate(
                MODEL,
                card_prompt(ROLE_ONLY_STEM, case, hide_existing_tag=True),
                thinking_mode="disabled",
                adapter_path=str(role_adapter),
            )
            incoming = parse_json(role_raw)
            decided = decide_card(
                incoming, case, role_only=True, r2_veto=True, arm="B"
            )
        heading_flag: bool | None = None
        verify_raw = ""
        box_ok = all(case.get(k) is not None for k in ("x0", "y0", "x1", "y1", "page"))
        image = None
        if box_ok and not omit_image:
            image = str(ensure_marked_png(case, pdf_dir, pages_dir, png_cache))
        verify_raw = generate(
            MODEL,
            marked_eligibility_prompt(case),
            image=image,
            thinking_mode="disabled",
            adapter_path=str(verify_adapter),
        )
        heading_flag = parse_heading_flag(verify_raw)
        applied = decided is not None and needs_page_verify(decided, case)
        if applied and decided is not None:
            decided = apply_page_verify(
                decided,
                case,
                heading_flag,
                verify_input="text-only" if omit_image else "marked-binary",
            )
        elif decided is not None:
            decided = dict(decided)
            decided["page_verify"] = heading_flag
            decided["page_verify_parsed"] = heading_flag is not None
            decided["verify_input"] = "text-only" if omit_image else "marked-binary"
            decided["verification_failure"] = heading_flag is None
        expect = case.get("expect") or {}
        scored = score(decided, case)
        row = {
            "id": case.get("id"),
            "locator": case.get("locator"),
            "text": case.get("text"),
            "existing_tag": case.get("existing_tag"),
            "expect_role": expect.get("role"),
            "gt_heading": gt_heading(case),
            "model_role": None if decided is None else decided.get("model_role"),
            "heading": heading_flag,
            "verify_parsed": heading_flag is not None,
            "verify_applied": applied,
            "final_role": None if decided is None else decided.get("role"),
            "action": None if decided is None else decided.get("action"),
            "unsafe": scored.get("unsafe"),
            "ok": scored.get("ok"),
            "heading_probe": scored.get("heading_probe"),
            "trap": case.get("trap"),
            "skip": verifier_skip_reason(case),
            "verify_raw": verify_raw[-1500:],
        }
        rows.append(row)
        shown = {k: v for k, v in row.items() if k != "verify_raw"}
        print(json.dumps(shown, sort_keys=True))
    summary = {
        "matched": [c.get("id") for c in matched],
        "missing": missing,
        "bridge_failures": failed,
        "omit_image": omit_image,
        "gates": verifier_gate(rows),
        "role_gates": gates(
            [
                {
                    "parsed": r["final_role"] is not None,
                    "ok": r["ok"],
                    "unsafe": r["unsafe"],
                    "heading_probe": r["heading_probe"],
                    "abstain": False,
                    "timid": False,
                }
                for r in rows
            ]
        ),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = "ablate" if omit_image else "marked"
    out_file = out_dir / f"verify-{suffix}.jsonl"
    out_file.write_text("".join(json.dumps(r) + "\n" for r in rows))
    (out_dir / f"verify-{suffix}-summary.json").write_text(
        json.dumps(summary, indent=2, default=str) + "\n"
    )
    print(json.dumps({**summary, "out": str(out_file)}, default=str))
    return summary


def visual_heading_of(role: str | None) -> bool | None:
    if role is None:
        return None
    return role in HEADING


def apply_visual_eligibility(
    pred: dict,
    case: dict,
    visual_role: str | None,
    verify_input: str = "marked-role",
) -> dict:
    heading = visual_heading_of(visual_role)
    out = apply_page_verify(pred, case, heading, verify_input=verify_input)
    out["visual_role"] = visual_role
    out["visual_heading"] = heading
    return out


def mutation_locators(
    preds: list[dict],
    fields: dict[str, dict] | dict[str, list],
    arm: str,
    r5_veto: bool = False,
) -> list[str]:
    out: list[str] = []
    for pred in preds:
        loc = str(pred.get("locator") or "")
        extra = fields.get(loc) or {}
        if isinstance(extra, list):
            extra = {"ancestors": extra}
        case = {
            "locator": loc,
            "text": pred.get("text"),
            "existing_tag": pred.get("existing_tag"),
            "ancestors": extra.get("ancestors", pred.get("ancestors") or []),
            "in_table_box": extra.get(
                "in_table_box", pred.get("r5_table_box") or pred.get("in_table_box")
            ),
        }
        incoming = {"role": pred["model_role"]} if pred.get("model_role") else None
        decided = decide_card(
            incoming, case, role_only=True, r2_veto=True, arm=arm, r5_veto=r5_veto
        )
        if decided is not None and needs_page_verify(decided, case):
            out.append(loc)
    return out


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
    role_only: bool = False,
    r2_veto: bool = False,
    arm: str = "A",
    r5_veto: bool = False,
) -> list[dict]:
    bundle = json.loads(path.read_text())
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    if role_only:
        stem = ROLE_ONLY_STEM
    elif conservative:
        stem = bundle["conservative_prompt_stem"]
    else:
        stem = bundle["prompt_stem"]
    rows = []
    skipped = 0
    for case in bundle["cases"]:
        image = None
        if image_dir is not None:
            candidate = image_dir / f'{case["id"].split("-", 1)[0]}.png'
            if candidate.exists():
                image = str(candidate)
        pre = apply_structural_scope(None, case, arm=arm)
        if pre is not None and not pre.get("qwen_called"):
            pred = pre
            pred["r5_table_box"] = bool(case.get("in_table_box"))
            raw = ""
            skipped += 1
        elif r5_veto and case.get("in_table_box"):
            pred = apply_r5_scope(None, case)
            raw = ""
            skipped += 1
        else:
            raw = generate(
                bundle["model"],
                card_prompt(
                    stem,
                    case,
                    with_page_band=with_page_band,
                    hide_existing_tag=role_only,
                ),
                image=image,
                thinking_mode=thinking_mode,
                thinking_budget=thinking_budget,
                adapter_path=adapter_path,
            )
            pred = decide_card(
                parse_json(raw), case, role_only=role_only, r2_veto=r2_veto, arm=arm, r5_veto=r5_veto
            )
        row = score(pred, case)
        row["raw"] = raw[-1500:]
        if pred is not None:
            row["model_role"] = pred.get("model_role")
            row["r2_veto"] = pred.get("r2_veto")
            row["scope"] = pred.get("scope")
            row["qwen_called"] = pred.get("qwen_called")
        rows.append(row)
        shown = {k: v for k, v in row.items() if k != "raw"}
        if not row["parsed"]:
            shown["raw"] = row["raw"]
        print(json.dumps(shown, sort_keys=True))
    print(json.dumps({"gates": gates(rows), "qwen_skipped": skipped}, sort_keys=True))
    return rows


def run_predict(
    cards: list[dict],
    offline: bool = False,
    adapter_path: str | None = None,
    role_only: bool = True,
    r2_veto: bool = True,
    thinking_mode: str = "disabled",
    arm: str = "A",
    r5_veto: bool = False,
) -> list[dict]:
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    if not role_only:
        raise SystemExit("--predict requires --role-only")
    rows = []
    skipped = 0
    for case in cards:
        pre = apply_structural_scope(None, case, arm=arm)
        if pre is not None and not pre.get("qwen_called"):
            pred = pre
            pred["r5_table_box"] = bool(case.get("in_table_box"))
            raw = ""
            skipped += 1
        elif r5_veto and case.get("in_table_box"):
            pred = apply_r5_scope(None, case)
            raw = ""
            skipped += 1
        else:
            raw = generate(
                MODEL,
                card_prompt(ROLE_ONLY_STEM, case, hide_existing_tag=True),
                thinking_mode=thinking_mode,
                adapter_path=adapter_path,
            )
            pred = decide_card(parse_json(raw), case, role_only=True, r2_veto=r2_veto, arm=arm, r5_veto=r5_veto)
        row = prediction_record(case, pred, raw)
        rows.append(row)
        shown = {k: v for k, v in row.items() if k != "raw"}
        if not row["parsed"]:
            shown["raw"] = row["raw"]
        print(json.dumps(shown, sort_keys=True))
    print(
        json.dumps(
            {
                "evaluable": len(rows),
                "parsed": sum(1 for r in rows if r["parsed"]),
                "qwen_skipped": skipped,
            }
        )
    )
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
    val_unsafe = score(
        {"role": "H1", "action": "retag"},
        {"id": "07-chart-title", "expect": {"role": "P", "action": "retag"}, "trap": "heading"},
    )
    val_safe = score(
        {"role": "P", "action": "retag"},
        {"id": "07-chart-title", "expect": {"role": "P", "action": "retag"}, "trap": "heading"},
    )
    role_only = parse_json('{"role":"H2"}')
    hidden = card_prompt(
        "STEM",
        {
            "text": "Eligibility",
            "font_pt": 13,
            "weight": "bold",
            "prev": "Terms of Access",
            "next": "Access is granted",
            "existing_tag": "H4",
        },
        hide_existing_tag=True,
    )
    shown_tag = card_prompt(
        "STEM",
        {
            "text": "Eligibility",
            "font_pt": 13,
            "weight": "bold",
            "prev": "Terms of Access",
            "next": "Access is granted",
            "existing_tag": "H4",
        },
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
    assert val_unsafe["ok"] is False and val_unsafe["unsafe"] is True
    assert val_safe["ok"] is True and val_safe["unsafe"] is False
    assert role_only == {"role": "H2"}
    assert "Existing tag" not in hidden
    assert "Existing tag: H4" in shown_tag
    assert ("keep" if "H2" == "H2" else "retag") == "keep"
    assert ("keep" if "H2" == "H4" else "retag") == "retag"
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
    assert r2_ornament("3") is True
    assert r2_ornament("Q1") is False
    assert r2_ornament("Throughput Trend Analysis") is False
    assert r2_ornament("") is False
    numeral = {
        "id": "08-numeral-3",
        "text": "3",
        "existing_tag": "P",
        "expect": {"role": "P"},
        "trap": "heading",
    }
    vetoed = apply_r2_veto({"role": "H1"}, numeral)
    assert vetoed["model_role"] == "H1"
    assert vetoed["role"] == "P"
    assert vetoed["action"] == "keep"
    assert vetoed["r2_veto"] is True
    scored_veto = score(vetoed, numeral)
    assert scored_veto["unsafe"] is False
    assert scored_veto["ok"] is True
    heading_keep = apply_r2_veto(
        {"role": "H1"},
        {"text": "Terms of Access", "existing_tag": "P"},
    )
    assert heading_keep["r2_veto"] is False
    assert heading_keep["role"] == "H1"
    assert heading_keep["model_role"] == "H1"
    assert heading_keep["action"] == "retag"
    assert apply_r2_veto(None, {"text": "Hello", "existing_tag": "P"}) is None
    assert collapse_glyph_spaces("Q u a r t e r l y O p e r a t i o n s") == "QuarterlyOperations"
    assert collapse_glyph_spaces("Regional detail") == "Regional detail"
    assert collapse_glyph_spaces("3") == "3"
    built, failed = blocks_to_cards(
        [
            {
                "locator": "01:0",
                "existing_tag": "P",
                "text": "N o r t h w i n d",
                "font_pt": 8,
                "weight": "regular",
                "ancestors": ["Document"],
            },
            {
                "locator": "01:1",
                "existing_tag": "H1",
                "text": "Q u a r t e r l y",
                "font_pt": 20,
                "weight": "bold",
            },
            {"locator": "01:2", "existing_tag": "Figure", "text": "", "font_pt": 12, "weight": "regular"},
            {"locator": "01:3", "existing_tag": "P", "text": "Hello", "weight": "regular"},
        ]
    )
    assert [c["locator"] for c in built] == ["01:0", "01:1"]
    assert built[1]["text"] == "Quarterly"
    assert built[1]["prev"] == "Northwind"
    assert built[0]["next"] == "Quarterly"
    assert built[0]["prev"] == "none"
    assert built[1]["next"] == "none"
    assert built[0]["ancestors"] == ["Document"]
    assert any(f["locator"] == "01:2" and f["reason"] == "empty_text" for f in failed)
    assert any(f["locator"] == "01:3" and f["reason"] == "missing_font" for f in failed)
    assert text_norm("Q u a r t e r l y O p e r a t i o n s") == text_norm(
        "Quarterly Operations"
    )
    dumps, dump_fail = dumps_to_cards(
        [
            {
                "stem": "01-simple-text",
                "hasStructTree": True,
                "blocks": [
                    {
                        "locator": "01-simple-text:0",
                        "existing_tag": "H1",
                        "text": "Quarterly Operations Summary",
                        "font_pt": 20,
                        "weight": "bold",
                    }
                ],
            },
            {"stem": "untagged", "hasStructTree": False, "error": "no_structure_tree"},
        ]
    )
    assert dumps[0]["locator"] == "01-simple-text:0"
    assert dumps[0]["prev"] == "none"
    assert any(f["reason"] == "no_structure_tree" for f in dump_fail)
    matched, missing = attach_probe_expect(
        dumps,
        [{"id": "01-h1", "text": "Quarterly Operations Summary", "expect": {"role": "H1"}}],
    )
    assert matched[0]["id"] == "01-h1"
    assert missing == []
    crossed, still_missing = attach_probe_expect(
        [
            {
                "locator": "12-kitchen-sink:26",
                "text": "Northern",
                "existing_tag": "P",
            }
        ],
        [{"id": "04-northern", "text": "Northern", "expect": {"role": "P"}}],
        by_doc=True,
    )
    assert crossed == []
    assert still_missing == ["04-northern"]
    hold = score_holdout(
        [
            {
                "locator": "doc:0",
                "text": "Title",
                "existing_tag": "P",
                "model_role": "H1",
                "r2_match": False,
                "final_role": "H1",
                "derived_action": "retag",
                "parsed": True,
            },
            {
                "locator": "doc:1",
                "text": "3",
                "existing_tag": "H1",
                "model_role": "H1",
                "r2_match": True,
                "final_role": "P",
                "derived_action": "retag",
                "parsed": True,
            },
        ],
        {"doc": {"headingHierarchy": [{"level": 1, "text": "Title"}]}},
    )
    assert hold["heading_exact"] == 1
    assert hold["heading_n"] == 1
    assert hold["unsafe"] == 0
    assert hold["r2_true_heading_collisions"] == 0
    assert hold["pass"] is True
    unsafe_hold = score_holdout(
        [
            {
                "locator": "doc:0",
                "text": "DRAFT",
                "existing_tag": "P",
                "model_role": "H1",
                "r2_match": False,
                "final_role": "H1",
                "derived_action": "retag",
                "parsed": True,
            }
        ],
        {"doc": {"headingHierarchy": [{"level": 1, "text": "Real Title"}]}},
    )
    assert unsafe_hold["unsafe"] == 1
    assert unsafe_hold["pass"] is False
    assert unsafe_hold["unmatched_gt_headings"][0]["text"] == "Real Title"
    assert source_eligible("P") is True
    assert source_eligible("none") is True
    assert source_eligible("H4") is True
    assert source_eligible("Figure") is False
    assert source_eligible("Table") is False
    assert source_eligible("LI") is False
    assert source_eligible("Caption") is False
    assert ancestry_eligible([]) is True
    assert ancestry_eligible(["Document"]) is True
    assert ancestry_eligible(["TD", "TR", "Table", "Document"]) is False
    assert ancestry_eligible(["Figure", "Document"]) is False
    fig = apply_structural_scope(
        {"role": "H1"},
        {"text": "R", "existing_tag": "Figure", "ancestors": ["Document"]},
        arm="A",
    )
    assert fig["model_role"] == "H1"
    assert fig["qwen_called"] is False
    assert fig["scope"] == "source_type"
    assert fig["role"] == "Figure"
    assert fig["action"] == "keep"
    skipped = apply_structural_scope(
        None,
        {"text": "R", "existing_tag": "Figure", "ancestors": ["Document"]},
        arm="A",
    )
    assert skipped["model_role"] is None
    assert skipped["role"] == "Figure"
    table_p = apply_structural_scope(
        {"role": "H2"},
        {"text": "Registration", "existing_tag": "P", "ancestors": ["TD", "TR", "Table"]},
        arm="B",
    )
    assert table_p["qwen_called"] is False
    assert table_p["scope"] == "ancestry"
    assert table_p["role"] == "P"
    still_a = apply_structural_scope(
        {"role": "H2"},
        {"text": "Registration", "existing_tag": "P", "ancestors": ["TD", "TR", "Table"]},
        arm="A",
    )
    assert still_a["qwen_called"] is True
    assert still_a["role"] == "H2"
    flow = apply_structural_scope(
        {"role": "H1"},
        {"text": "Terms of Access", "existing_tag": "P", "ancestors": ["Document"]},
        arm="B",
    )
    assert flow["qwen_called"] is True
    assert flow["scope"] is None
    assert flow["role"] == "H1"
    heading_in_table = apply_structural_scope(
        {"role": "H2"},
        {"text": "Terms of Access", "existing_tag": "H2", "ancestors": ["Table", "Document"]},
        arm="B",
    )
    assert heading_in_table["scope"] == "ancestry"
    assert heading_in_table["role"] == "P"
    assert heading_in_table["action"] == "retag"
    rec, skipped_n = rescore_frozen(
        [
            {
                "locator": "h05:0",
                "text": "R",
                "existing_tag": "Figure",
                "model_role": "H1",
                "final_role": "H1",
                "derived_action": "retag",
            }
        ],
        {"h05:0": {"ancestors": ["Document"], "in_table_box": False}},
        "A",
    )
    assert skipped_n == 1
    assert rec[0]["final_role"] == "Figure"
    assert rec[0]["model_role"] == "H1"
    assert rec[0]["derived_action"] == "keep"
    assert rec[0]["scope"] == "source_type"
    r5_hit = apply_r5_scope(
        {"role": "H2"},
        {"text": "Depot Staff Vehicles", "existing_tag": "P", "in_table_box": True},
    )
    assert r5_hit["qwen_called"] is False
    assert r5_hit["r5_table_box"] is True
    assert r5_hit["role"] == "P"
    assert r5_hit["action"] == "keep"
    r5_heading = apply_r5_scope(
        {"role": "H1"},
        {"text": "True Heading", "existing_tag": "H1", "in_table_box": True},
    )
    assert r5_heading["role"] == "P"
    missed = decide_card(
        {"role": "H2"},
        {"text": "Banner", "existing_tag": "P", "in_table_box": False, "ancestors": ["Document"]},
        role_only=True,
        r2_veto=True,
        arm="B",
        r5_veto=True,
    )
    assert missed["role"] == "H2"
    assert missed["r5_table_box"] is False
    gated = decide_card(
        {"role": "H2"},
        {"text": "Depot Staff Vehicles", "existing_tag": "P", "in_table_box": True, "ancestors": ["Document"]},
        role_only=True,
        r2_veto=True,
        arm="B",
        r5_veto=True,
    )
    assert gated["role"] == "P"
    assert gated["qwen_called"] is False
    assert gated["model_role"] == "H2"
    assert parse_heading_flag('{"heading":true}') is True
    assert parse_heading_flag('{"heading":false}') is False
    assert parse_heading_flag("not json") is None
    assert parse_heading_flag('{"role":"H1"}') is None
    assert needs_page_verify(
        {"role": "H2", "qwen_called": True, "r2_veto": False},
        {"existing_tag": "P"},
    )
    assert not needs_page_verify(
        {"role": "H1", "qwen_called": True, "r2_veto": False},
        {"existing_tag": "H1"},
    )
    assert not needs_page_verify(
        {"role": "P", "qwen_called": True, "r2_veto": True},
        {"existing_tag": "H1"},
    )
    vetoed = apply_page_verify(
        {"role": "H2", "action": "retag", "qwen_called": True},
        {"existing_tag": "P"},
        False,
    )
    assert vetoed["role"] == "P"
    assert vetoed["action"] == "keep"
    assert vetoed["page_verify"] is False
    allowed = apply_page_verify(
        {"role": "H2", "action": "retag", "qwen_called": True},
        {"existing_tag": "P"},
        True,
    )
    assert allowed["role"] == "H2"
    parse_miss = apply_page_verify(
        {"role": "H1", "action": "retag", "qwen_called": True},
        {"existing_tag": "H2"},
        None,
        verify_input="marked",
    )
    assert parse_miss["page_verify_parsed"] is False
    assert parse_miss["verification_failure"] is True
    assert parse_miss["verify_input"] == "marked"
    assert parse_miss["role"] == "H2"
    assert parse_miss["action"] == "keep"
    assert "outlined rectangle" in MARKED_VERIFY_STEM
    assert "H1" not in MARKED_VERIFY_STEM
    assert len(PART10_VERIFY_LOCATORS) == 14
    loc_prompt = marked_role_prompt(
        {
            "text": "Eligibility",
            "font_pt": 13,
            "weight": "bold",
            "prev": "Terms of Access",
            "next": "Access is granted",
            "existing_tag": "H4",
        }
    )
    assert loc_prompt.startswith(MARKED_ROLE_LOCALIZER)
    assert ROLE_ONLY_STEM in loc_prompt
    assert "Existing tag" not in loc_prompt
    assert "Depot Staff" not in loc_prompt
    assert "Berth Occupancy" not in loc_prompt
    assert '{"heading":true}' not in loc_prompt
    elig = marked_eligibility_prompt(
        {
            "text": "Eligibility",
            "font_pt": 13,
            "weight": "bold",
            "prev": "Terms of Access",
            "next": "Access is granted",
            "existing_tag": "H4",
        }
    )
    assert elig.startswith(MARKED_ELIGIBILITY_STEM)
    assert "Element: 'Eligibility'" in elig
    assert "Existing tag" not in elig
    assert "Depot Staff" not in MARKED_ELIGIBILITY_STEM
    assert "Berth Occupancy" not in MARKED_ELIGIBILITY_STEM
    assert "COMMERCIAL IN CONFIDENCE" not in MARKED_ELIGIBILITY_STEM
    assert "H1" not in MARKED_ELIGIBILITY_STEM
    assert gt_heading({"expect": {"role": "H2"}}) is True
    assert gt_heading({"expect": {"role": "P"}}) is False
    assert verifier_skip_reason({"existing_tag": "Figure", "text": "Logo", "ancestors": []}) == "source_type"
    assert verifier_skip_reason({"existing_tag": "P", "text": "Cell", "ancestors": ["Table"]}) == "ancestry"
    assert verifier_skip_reason({"existing_tag": "P", "text": "3", "ancestors": ["Document"]}) == "r2"
    assert verifier_skip_reason({"existing_tag": "P", "text": "Site", "ancestors": ["Document"]}) is None
    kept_h = apply_page_verify(
        {"role": "H2", "action": "retag", "qwen_called": True, "model_role": "H2"},
        {"existing_tag": "P"},
        True,
        verify_input="marked-binary",
    )
    assert kept_h["role"] == "H2"
    blocked_h = apply_page_verify(
        {"role": "H2", "action": "retag", "qwen_called": True, "model_role": "H2"},
        {"existing_tag": "P"},
        False,
        verify_input="marked-binary",
    )
    assert blocked_h["role"] == "P"
    assert blocked_h["action"] == "keep"
    assert visual_heading_of("H2") is True
    assert visual_heading_of("P") is False
    assert visual_heading_of(None) is None
    kept = apply_visual_eligibility(
        {"role": "H2", "action": "retag", "qwen_called": True, "model_role": "H2"},
        {"existing_tag": "P"},
        "H3",
    )
    assert kept["role"] == "H2"
    assert kept["model_role"] == "H2"
    assert kept["visual_role"] == "H3"
    assert kept["visual_heading"] is True
    assert kept["action"] == "retag"
    blocked = apply_visual_eligibility(
        {"role": "H2", "action": "retag", "qwen_called": True, "model_role": "H2"},
        {"existing_tag": "P"},
        "P",
    )
    assert blocked["role"] == "P"
    assert blocked["action"] == "keep"
    assert blocked["model_role"] == "H2"
    assert blocked["visual_heading"] is False
    fail = apply_visual_eligibility(
        {"role": "H1", "action": "retag", "qwen_called": True, "model_role": "H1"},
        {"existing_tag": "H2"},
        None,
    )
    assert fail["verification_failure"] is True
    assert fail["role"] == "H2"
    assert fail["action"] == "keep"
    assert mutation_locators(
        [
            {
                "locator": "dev:1",
                "text": "Section",
                "existing_tag": "P",
                "model_role": "H2",
            },
            {
                "locator": "dev:2",
                "text": "Body",
                "existing_tag": "P",
                "model_role": "P",
            },
            {
                "locator": "dev:3",
                "text": "R",
                "existing_tag": "Figure",
                "model_role": "H1",
            },
        ],
        {
            "dev:1": {"ancestors": ["Document"], "in_table_box": False},
            "dev:2": {"ancestors": ["Document"], "in_table_box": False},
            "dev:3": {"ancestors": ["Document"], "in_table_box": False},
        },
        "B",
    ) == ["dev:1"]


def load_block_dumps() -> list[dict] | None:
    raw = flag_value("--from-blocks")
    folder = flag_value("--dump-dir")
    one = flag_value("--dump-pdf")
    if folder:
        return dump_dir(Path(folder))
    if one:
        return [dump_pdf(Path(one))]
    if raw:
        payload = json.loads(Path(raw).read_text())
        if isinstance(payload, list):
            return payload
        if "blocks" in payload:
            return [payload]
        return payload.get("pdfs") or []
    return None


def block_fields_by_locator(dumps: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for dump in dumps:
        for block in dump.get("blocks") or []:
            loc = block.get("locator")
            if loc:
                out[str(loc)] = {
                    "ancestors": list(block.get("ancestors") or []),
                    "in_table_box": bool(block.get("in_table_box")),
                    "page": block.get("page"),
                    "x0": block.get("x0"),
                    "y0": block.get("y0"),
                    "x1": block.get("x1"),
                    "y1": block.get("y1"),
                }
    return out


def rescore_frozen(
    preds: list[dict],
    fields: dict[str, dict] | dict[str, list],
    arm: str,
    r5_veto: bool = False,
    verify_page: bool = False,
    verify_marked: bool = False,
    verify_marked_role: bool = False,
    verify_marked_binary: bool = False,
    omit_image: bool = False,
    verify_locators: tuple[str, ...] | None = None,
    adapter_path: str | None = None,
    pdf_dir: Path | None = None,
    png_dir: Path | None = None,
) -> tuple[list[dict], int]:
    rows = []
    skipped = 0
    png_cache: dict[tuple[str, int], Path] = {}
    pages_dir = png_dir or (HERE / "out" / "pages")
    role_locs = verify_locators if verify_locators is not None else PART10_VERIFY_LOCATORS
    for pred in preds:
        loc = str(pred.get("locator") or "")
        extra = fields.get(loc) or {}
        if isinstance(extra, list):
            extra = {"ancestors": extra}
        case = {
            "locator": loc,
            "id": pred.get("id") or loc,
            "text": pred.get("text"),
            "font_pt": pred.get("font_pt"),
            "weight": pred.get("weight"),
            "prev": pred.get("prev"),
            "next": pred.get("next"),
            "existing_tag": pred.get("existing_tag"),
            "ancestors": extra.get("ancestors", pred.get("ancestors") or []),
            "in_table_box": extra.get("in_table_box", pred.get("r5_table_box") or pred.get("in_table_box")),
            "page": extra.get("page", pred.get("page")),
            "x0": extra.get("x0", pred.get("x0")),
            "y0": extra.get("y0", pred.get("y0")),
            "x1": extra.get("x1", pred.get("x1")),
            "y1": extra.get("y1", pred.get("y1")),
        }
        incoming = {"role": pred["model_role"]} if pred.get("model_role") else None
        decided = decide_card(
            incoming, case, role_only=True, r2_veto=True, arm=arm, r5_veto=r5_veto
        )
        if decided is not None and not decided.get("qwen_called"):
            skipped += 1
        want_role = verify_marked_role and loc in role_locs
        want_binary = verify_marked_binary and loc in role_locs
        want_marked = (
            verify_marked
            and not verify_marked_role
            and not verify_marked_binary
            and loc in PART10_VERIFY_LOCATORS
        )
        want_full = (
            verify_page
            and not verify_marked
            and not verify_marked_role
            and not verify_marked_binary
        )
        if (want_full or want_marked or want_role or want_binary) and decided is not None and needs_page_verify(decided, case):
            page = case.get("page")
            stem = loc.rsplit(":", 1)[0]
            heading_flag: bool | None = None
            visual_role: str | None = None
            raw_verify = ""
            if want_binary:
                verify_input = "text-only" if omit_image else "marked-binary"
            elif want_role:
                verify_input = "marked-role"
            elif want_marked:
                verify_input = "marked"
            else:
                verify_input = "full"
            box_ok = all(case.get(k) is not None for k in ("x0", "y0", "x1", "y1"))
            needs_box = want_marked or want_role or (want_binary and not omit_image)
            if pdf_dir is None or page is None or (needs_box and not box_ok):
                heading_flag = None
            else:
                page_1 = int(page) + 1
                image = None
                prompt = heading_verify_prompt(str(case.get("text") or ""), page_1)
                adapter = None
                if want_binary:
                    prompt = marked_eligibility_prompt(case)
                    adapter = adapter_path or str(ADAPTER_VERIFY_MARKED)
                    if not omit_image:
                        image = ensure_marked_png(case, pdf_dir, pages_dir, png_cache)
                elif want_marked or want_role:
                    cache_key = (stem, page_1)
                    png = png_cache.get(cache_key)
                    if png is None:
                        dest = pages_dir / f"{stem}-p{page_1}.png"
                        if dest.is_file():
                            png = dest
                        else:
                            png = render_page_png(pdf_dir / f"{stem}.pdf", page_1, dest)
                        png_cache[cache_key] = png
                    image = ensure_marked_png(case, pdf_dir, pages_dir, png_cache)
                    if want_role:
                        prompt = marked_role_prompt(case)
                        adapter = adapter_path or str(ADAPTER_ROLE)
                    else:
                        prompt = MARKED_VERIFY_STEM
                else:
                    cache_key = (stem, page_1)
                    png = png_cache.get(cache_key)
                    if png is None:
                        dest = pages_dir / f"{stem}-p{page_1}.png"
                        if dest.is_file():
                            png = dest
                        else:
                            png = render_page_png(pdf_dir / f"{stem}.pdf", page_1, dest)
                        png_cache[cache_key] = png
                    image = png
                raw_verify = generate(
                    MODEL,
                    prompt,
                    image=str(image) if image is not None else None,
                    thinking_mode="disabled",
                    adapter_path=adapter,
                )
                if want_role:
                    parsed = parse_json(raw_verify)
                    visual_role = parsed.get("role") if parsed else None
                    heading_flag = visual_heading_of(visual_role)
                else:
                    heading_flag = parse_heading_flag(raw_verify)
            if want_role:
                decided = apply_visual_eligibility(decided, case, visual_role)
            else:
                decided = apply_page_verify(decided, case, heading_flag, verify_input=verify_input)
            if raw_verify:
                pred = dict(pred)
                pred["verify_raw"] = raw_verify[-1500:]
        rows.append(prediction_record(case, decided, pred.get("raw") or ""))
        if decided is not None:
            rows[-1]["page_verify"] = decided.get("page_verify")
            rows[-1]["page_verify_parsed"] = bool(decided.get("page_verify_parsed"))
            rows[-1]["verify_input"] = decided.get("verify_input")
            rows[-1]["verification_failure"] = bool(decided.get("verification_failure"))
            rows[-1]["visual_role"] = decided.get("visual_role")
            rows[-1]["visual_heading"] = decided.get("visual_heading")
            if pred.get("verify_raw"):
                rows[-1]["verify_raw"] = pred["verify_raw"]
    return rows, skipped


if __name__ == "__main__":
    if "--self-check" in sys.argv:
        self_check()
        print("ok")
        raise SystemExit(0)

    if "--check-box-map" in sys.argv:
        print(json.dumps(check_box_map(), indent=2))
        raise SystemExit(0)

    if "--emit-verify-sft" in sys.argv:
        pdf_dir = Path(flag_value("--pdf-dir") or flag_value("--dump-dir") or "")
        match_path = Path(flag_value("--match-path") or (HERE / "train.json"))
        out_dir = Path(flag_value("--out-dir") or (HERE / "out" / "gen-sft-verify"))
        pages_dir = Path(flag_value("--pages-dir") or (out_dir / "pages"))
        if not pdf_dir:
            raise SystemExit("--emit-verify-sft requires --pdf-dir or --dump-dir")
        print(json.dumps(emit_verify_sft(pdf_dir, match_path, out_dir, pages_dir), indent=2, default=str))
        raise SystemExit(0)

    if "--eval-verify-marked" in sys.argv:
        pdf_dir = Path(flag_value("--pdf-dir") or flag_value("--dump-dir") or "")
        match_path = Path(flag_value("--match-path") or str(PROBES_PATH))
        out_dir = Path(flag_value("--out-dir") or (HERE / "out" / "verify-marked"))
        pages_dir = Path(flag_value("--pages-dir") or (out_dir / "pages"))
        if not pdf_dir:
            raise SystemExit("--eval-verify-marked requires --pdf-dir or --dump-dir")
        eval_verify_marked(
            pdf_dir,
            match_path,
            out_dir,
            pages_dir,
            Path(flag_value("--role-adapter") or ADAPTER_ROLE),
            Path(flag_value("--adapter-path") or ADAPTER_VERIFY_MARKED),
            omit_image="--omit-image" in sys.argv,
        )
        raise SystemExit(0)

    if "--smoke-adapter-image" in sys.argv:
        png = HERE / "out" / "box-map" / "01-simple-text-p1-marked.png"
        if not png.is_file():
            dump = dump_pdf(DEV_MAP_PDF)
            block = next(
                b
                for b in dump.get("blocks") or []
                if b.get("locator") == "01-simple-text:1"
            )
            src = HERE / "out" / "box-map" / "01-simple-text-p1.png"
            if not src.is_file():
                render_page_png(DEV_MAP_PDF, int(block["page"]) + 1, src)
            mark_page_png(
                DEV_MAP_PDF,
                int(block["page"]) + 1,
                (float(block["x0"]), float(block["y0"]), float(block["x1"]), float(block["y1"])),
                src,
                png,
            )
        raw = generate(
            MODEL,
            marked_role_prompt(
                {
                    "text": "Quarterly Operations Summary",
                    "font_pt": 26,
                    "weight": "bold",
                    "prev": "none",
                    "next": "none",
                    "existing_tag": "H1",
                }
            ),
            image=str(png),
            thinking_mode="disabled",
            adapter_path=str(ADAPTER_ROLE),
        )
        parsed = parse_json(raw)
        payload = {
            "ok": parsed is not None and parsed.get("role") is not None,
            "role": None if parsed is None else parsed.get("role"),
        }
        print(json.dumps(payload, indent=2))
        raise SystemExit(0 if payload["ok"] else 1)

    score_path = flag_value("--score-holdout")
    if score_path:
        gt_dir = Path(flag_value("--gt-dir") or "")
        if not gt_dir:
            raise SystemExit("--score-holdout requires --gt-dir")
        preds = [
            json.loads(line)
            for line in Path(score_path).read_text().splitlines()
            if line.strip()
        ]
        gt_by_stem = {}
        for path in sorted(gt_dir.glob("*.ground-truth.json")):
            payload = json.loads(path.read_text())
            stem = payload.get("document") or path.name.replace(".ground-truth.json", "")
            gt_by_stem[stem] = payload
        print(json.dumps(score_holdout(preds, gt_by_stem), indent=2, default=str))
        raise SystemExit(0)

    arm = flag_value("--arm") or "B"
    r5_veto = "--r5-veto" in sys.argv
    rescore_path = flag_value("--rescore")
    if rescore_path:
        dumps = load_block_dumps() or []
        fields = block_fields_by_locator(dumps)
        preds = [
            json.loads(line)
            for line in Path(rescore_path).read_text().splitlines()
            if line.strip()
        ]
        if "--list-mutations" in sys.argv:
            locs = mutation_locators(preds, fields, arm, r5_veto=r5_veto)
            print(json.dumps({"n": len(locs), "locators": locs}, indent=2))
            raise SystemExit(0)
        loc_file = flag_value("--verify-locators")
        verify_locs = None
        if loc_file:
            payload = json.loads(Path(loc_file).read_text())
            if isinstance(payload, list):
                verify_locs = tuple(str(x) for x in payload)
            else:
                verify_locs = tuple(str(x) for x in payload.get("locators") or [])
        rows, skipped = rescore_frozen(
            preds,
            fields,
            arm,
            r5_veto=r5_veto,
            verify_page="--verify-page" in sys.argv,
            verify_marked="--verify-marked" in sys.argv,
            verify_marked_role="--verify-marked-role" in sys.argv,
            verify_marked_binary="--verify-marked-binary" in sys.argv,
            omit_image="--omit-image" in sys.argv,
            verify_locators=verify_locs,
            adapter_path=flag_value("--adapter-path"),
            pdf_dir=Path(flag_value("--pdf-dir")) if flag_value("--pdf-dir") else None,
            png_dir=(Path(flag_value("--out-dir")) / "pages") if flag_value("--out-dir") else None,
        )
        out_dir = Path(flag_value("--out-dir") or (HERE / "out" / "bridge"))
        out_dir.mkdir(parents=True, exist_ok=True)
        suffix = (
            f"arm{arm}"
            + ("-r5" if r5_veto else "")
            + ("-marked-binary" if "--verify-marked-binary" in sys.argv else "")
            + ("-ablate" if "--omit-image" in sys.argv else "")
            + ("-marked-role" if "--verify-marked-role" in sys.argv else "")
            + ("-marked" if "--verify-marked" in sys.argv and "--verify-marked-role" not in sys.argv and "--verify-marked-binary" not in sys.argv else "")
            + ("-verify" if "--verify-page" in sys.argv and "--verify-marked" not in sys.argv and "--verify-marked-role" not in sys.argv and "--verify-marked-binary" not in sys.argv else "")
        )
        out_file = out_dir / f"rescored-{suffix}.jsonl"
        out_file.write_text("".join(json.dumps(r) + "\n" for r in rows))
        print(json.dumps({"arm": arm, "r5_veto": r5_veto, "n": len(rows), "qwen_skipped": skipped, "out": str(out_file)}))
        raise SystemExit(0)

    dumps = load_block_dumps()
    if dumps is not None:
        cards, failed = dumps_to_cards(dumps)
        out_dir = Path(flag_value("--out-dir") or (HERE / "out" / "bridge"))
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "blocks.json").write_text(json.dumps({"pdfs": dumps}, indent=2) + "\n")
        (out_dir / "bridge_failures.json").write_text(json.dumps(failed, indent=2) + "\n")
        if "--match-probes" in sys.argv:
            probes = json.loads(Path(flag_value("--match-path") or str(PROBES_PATH)).read_text())["cases"]
            matched, missing = attach_probe_expect(cards, probes)
            (out_dir / "matched-probes.json").write_text(
                json.dumps(card_bundle(matched), indent=2) + "\n"
            )
            print(
                json.dumps(
                    {
                        "cards": len(cards),
                        "matched": [m["id"] for m in matched],
                        "missing": missing,
                        "bridge_failures": failed,
                    },
                    sort_keys=True,
                )
            )
            if "--offline" in sys.argv:
                tmp = out_dir / "matched-probes.json"
                run_cases(
                    path=tmp,
                    offline=True,
                    adapter_path=flag_value("--adapter-path"),
                    role_only="--role-only" in sys.argv,
                    r2_veto="--r2-veto" in sys.argv,
                    thinking_mode=flag_value("--thinking-mode") or "disabled",
                    thinking_budget=flag_value("--thinking-budget"),
                    arm=arm,
                    r5_veto=r5_veto,
                )
            raise SystemExit(0)
        (out_dir / "cards.json").write_text(json.dumps(card_bundle(cards), indent=2) + "\n")
        print(
            json.dumps(
                {
                    "pdfs": len(dumps),
                    "cards": len(cards),
                    "bridge_failures": failed,
                },
                sort_keys=True,
            )
        )
        if "--predict" in sys.argv:
            rows = run_predict(
                cards,
                offline="--offline" in sys.argv,
                adapter_path=flag_value("--adapter-path"),
                role_only="--role-only" in sys.argv,
                r2_veto="--r2-veto" in sys.argv,
                thinking_mode=flag_value("--thinking-mode") or "disabled",
                arm=arm,
                r5_veto=r5_veto,
            )
            (out_dir / "predictions.jsonl").write_text(
                "".join(json.dumps(r) + "\n" for r in rows)
            )
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
        role_only="--role-only" in sys.argv,
        r2_veto="--r2-veto" in sys.argv,
        arm=arm,
        r5_veto=r5_veto,
    )
