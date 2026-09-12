#!/usr/bin/env python3
"""Part 26: semantic final-heading scoring and zero-generation audit.

Not wired into production eval. Frozen adapters are not loaded.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

from run import (
    HEADING,
    HERE,
    decide_card,
    needs_page_verify,
    score_holdout,
    text_norm,
)

OUT = HERE / "out" / "part26"
REPO_DOCS = HERE.parent / "document-remediation"


def is_heading(role: str | None) -> bool:
    return role in HEADING


def legacy_unsafe_mutation(gt_heading: bool, final_role: str | None, action: str | None) -> bool:
    return (not gt_heading) and is_heading(final_role) and action == "retag"


def semantic_false_heading(gt_heading: bool, final_role: str | None) -> bool:
    return (not gt_heading) and is_heading(final_role)


def true_heading_removed(gt_heading: bool, final_role: str | None) -> bool:
    return bool(gt_heading) and not is_heading(final_role)


def mutation_class(existing: str | None, preverify: str | None) -> str | None:
    exist = existing or ""
    if not is_heading(preverify):
        return None
    if exist not in HEADING:
        return "nonH_to_H"
    if exist != preverify:
        return "H_to_diff_H"
    return "H_to_same_H"


def apply_semantic_verify(
    preverify_final_role: str | None,
    heading_flag: bool | None,
    existing_tag: str | None,
) -> dict:
    """Part 26 policy: verifier false on a would-finish-H* row demotes to P.

    Parse failure is unresolved, not heading:false and not a keep-H* success.
    """
    exist = existing_tag or ""
    if not is_heading(preverify_final_role):
        role = preverify_final_role
        return {
            "final_role": role,
            "action": "keep" if role == exist else "retag",
            "resolved": True,
            "parse_failure": False,
            "verify_applied": False,
        }
    if heading_flag is None:
        return {
            "final_role": None,
            "action": None,
            "resolved": False,
            "parse_failure": True,
            "verify_applied": True,
        }
    if heading_flag is True:
        role = preverify_final_role
        return {
            "final_role": role,
            "action": "keep" if role == exist else "retag",
            "resolved": True,
            "parse_failure": False,
            "verify_applied": True,
        }
    return {
        "final_role": "P",
        "action": "keep" if exist == "P" else "retag",
        "resolved": True,
        "parse_failure": False,
        "verify_applied": True,
    }


def pred_for_needs(row: dict, preverify_role: str | None) -> dict:
    return {
        "role": preverify_role,
        "qwen_called": bool(row.get("qwen_called", preverify_role is not None)),
        "r2_veto": bool(row.get("r2_veto") or row.get("r2_match")),
    }


def reconstruct_preverify(row: dict, arm: str = "B") -> dict | None:
    incoming = {"role": row["model_role"]} if row.get("model_role") else None
    case = {
        "text": row.get("text"),
        "existing_tag": row.get("existing_tag"),
        "ancestors": list(row.get("ancestors") or []),
        "in_table_box": row.get("r5_table_box") or row.get("in_table_box"),
    }
    return decide_card(incoming, case, role_only=True, r2_veto=True, arm=arm)


def preverify_from_eval(row: dict) -> str | None:
    skip = row.get("skip")
    exist = row.get("existing_tag") or ""
    if skip == "source_type":
        return exist
    if skip == "ancestry":
        return "P" if exist in HEADING else exist
    if skip == "r2":
        return "P"
    return row.get("model_role")


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def load_gt(gt_dir: Path) -> dict[str, dict]:
    by_stem: dict[str, dict] = {}
    for path in sorted(gt_dir.glob("*.ground-truth.json")):
        payload = json.loads(path.read_text())
        stem = payload.get("document") or path.name.replace(".ground-truth.json", "")
        by_stem[stem] = payload
    return by_stem


def gt_heading_of(row: dict, gt_by_stem: dict[str, dict]) -> bool:
    if "gt_heading" in row and row.get("expect_role") is not None:
        return bool(row.get("gt_heading"))
    locator = str(row.get("locator") or row.get("id") or "")
    stem = locator.rsplit(":", 1)[0]
    gt = gt_by_stem.get(stem) or {}
    norms = [text_norm(h["text"]) for h in gt.get("headingHierarchy") or []]
    n = text_norm(row.get("text") or "")
    return bool(n) and n in norms


def action_of(role: str | None, existing: str | None) -> str | None:
    if role is None:
        return None
    return "keep" if role == (existing or "") else "retag"


def run_check() -> None:
    """Four-row synthetic scorer fixture. Not a framework."""
    rows = [
        {
            "id": "promo-accepted",
            "gt_heading": False,
            "existing_tag": "P",
            "preverify_final_role": "H2",
            "heading_flag": True,
        },
        {
            "id": "same-level-reject",
            "gt_heading": False,
            "existing_tag": "H2",
            "preverify_final_role": "H2",
            "heading_flag": False,
        },
        {
            "id": "true-heading-reject",
            "gt_heading": True,
            "existing_tag": "P",
            "preverify_final_role": "H2",
            "heading_flag": False,
        },
        {
            "id": "true-heading-keep",
            "gt_heading": True,
            "existing_tag": "H2",
            "preverify_final_role": "H2",
            "heading_flag": True,
        },
    ]
    out = []
    for row in rows:
        pre = row["preverify_final_role"]
        exist = row["existing_tag"]
        old_cand = needs_page_verify(
            {"role": pre, "qwen_called": True, "r2_veto": False},
            {"existing_tag": exist},
        )
        new_cand = is_heading(pre)
        applied = apply_semantic_verify(pre, row["heading_flag"], exist)
        final = applied["final_role"]
        out.append(
            {
                **row,
                "old_candidate": old_cand,
                "corrected_candidate": new_cand,
                "corrected_final": final,
                "legacy_unsafe": legacy_unsafe_mutation(
                    row["gt_heading"], final, applied["action"]
                ),
                "semantic_false": semantic_false_heading(row["gt_heading"], final),
                "true_removed": true_heading_removed(row["gt_heading"], final),
            }
        )
    a, b, c, d = out
    assert a["corrected_candidate"] is True
    assert a["semantic_false"] is True
    assert b["old_candidate"] is False
    assert b["corrected_candidate"] is True
    assert not is_heading(b["corrected_final"])
    assert b["semantic_false"] is False
    assert not is_heading(c["corrected_final"])
    assert c["true_removed"] is True
    assert d["corrected_final"] == "H2"
    assert d["true_removed"] is False
    print("part26 check ok")


def annotate_holdout(rows: list[dict], gt_by_stem: dict[str, dict], arm: str = "B") -> list[dict]:
    annotated = []
    for row in rows:
        decided = reconstruct_preverify(row, arm=arm)
        pre = None if decided is None else decided.get("role")
        exist = row.get("existing_tag")
        gt = gt_heading_of(row, gt_by_stem)
        old_cand = bool(
            decided is not None
            and needs_page_verify(pred_for_needs({**row, **(decided or {})}, pre), {"existing_tag": exist})
        )
        new_cand = is_heading(pre)
        historical_final = row.get("final_role")
        historical_action = row.get("derived_action") or row.get("action")
        rec = {
            **row,
            "gt_heading": gt,
            "preverify_final_role": pre,
            "old_candidate": old_cand,
            "corrected_candidate": new_cand,
            "mutation_class": mutation_class(exist, pre),
            "historical_final_role": historical_final,
            "historical_action": historical_action,
            "legacy_unsafe_historical": legacy_unsafe_mutation(gt, historical_final, historical_action),
            "semantic_false_historical": semantic_false_heading(gt, historical_final),
            "true_removed_historical": true_heading_removed(gt, historical_final),
            "qwen_called_preverify": None if decided is None else bool(decided.get("qwen_called")),
            "r2_veto_preverify": None if decided is None else bool(decided.get("r2_veto")),
            "scope_preverify": None if decided is None else decided.get("scope"),
        }
        annotated.append(rec)
    return annotated


def heading_usefulness(rows: list[dict], gt_by_stem: dict[str, dict], final_key: str) -> dict:
    preds = []
    for row in rows:
        preds.append(
            {
                "locator": row.get("locator") or row.get("id"),
                "text": row.get("text"),
                "final_role": row.get(final_key),
                "derived_action": row.get("historical_action") or row.get("action"),
                "parsed": row.get("parsed", True),
                "model_role": row.get("model_role"),
                "existing_tag": row.get("existing_tag"),
                "r2_match": row.get("r2_match") or row.get("r2_veto_preverify"),
            }
        )
    return score_holdout(preds, gt_by_stem)


def count_classes(rows: list[dict]) -> dict:
    c = Counter(r.get("mutation_class") for r in rows if r.get("corrected_candidate"))
    return {
        "nonH_to_H": int(c.get("nonH_to_H") or 0),
        "H_to_diff_H": int(c.get("H_to_diff_H") or 0),
        "H_to_same_H": int(c.get("H_to_same_H") or 0),
    }


def missed_by_legacy(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        if r.get("semantic_false_historical") and not r.get("legacy_unsafe_historical"):
            out.append(
                {
                    "id": r.get("id"),
                    "locator": r.get("locator") or r.get("id"),
                    "text": r.get("text"),
                    "existing_tag": r.get("existing_tag"),
                    "preverify_final_role": r.get("preverify_final_role"),
                    "historical_final_role": r.get("historical_final_role"),
                    "action": r.get("historical_action") or r.get("action"),
                    "old_candidate": r.get("old_candidate"),
                    "corrected_candidate": r.get("corrected_candidate"),
                    "mutation_class": r.get("mutation_class"),
                    "gt_heading": r.get("gt_heading"),
                    "source_type": r.get("existing_tag"),
                    "stem": str(r.get("locator") or r.get("id") or "").rsplit(":", 1)[0],
                }
            )
    return out


def annotate_eval(rows: list[dict]) -> list[dict]:
    annotated = []
    for row in rows:
        pre = preverify_from_eval(row)
        exist = row.get("existing_tag")
        gt = bool(row.get("gt_heading"))
        decided = {
            "role": pre,
            "qwen_called": row.get("skip") is None,
            "r2_veto": row.get("skip") == "r2",
        }
        old_cand = needs_page_verify(decided, {"existing_tag": exist})
        new_cand = is_heading(pre)
        hist_final = row.get("final_role")
        hist_action = row.get("action")
        heading_flag = row.get("heading") if row.get("verify_parsed") else None
        if not row.get("verify_parsed"):
            heading_flag = None
        corrected = (
            apply_semantic_verify(pre, heading_flag, exist)
            if new_cand
            else {
                "final_role": pre,
                "action": action_of(pre, exist),
                "resolved": True,
                "parse_failure": False,
                "verify_applied": False,
            }
        )
        rec = {
            **row,
            "preverify_final_role": pre,
            "old_candidate": old_cand,
            "corrected_candidate": new_cand,
            "mutation_class": mutation_class(exist, pre),
            "historical_final_role": hist_final,
            "historical_action": hist_action,
            "legacy_unsafe_historical": legacy_unsafe_mutation(gt, hist_final, hist_action),
            "semantic_false_historical": semantic_false_heading(gt, hist_final),
            "true_removed_historical": true_heading_removed(gt, hist_final),
            "corrected_final_role": corrected["final_role"],
            "corrected_action": corrected["action"],
            "corrected_resolved": corrected["resolved"],
            "corrected_parse_failure": corrected["parse_failure"],
            "corrected_verify_applied": corrected["verify_applied"],
            "legacy_unsafe_corrected": False
            if not corrected["resolved"]
            else legacy_unsafe_mutation(gt, corrected["final_role"], corrected["action"]),
            "semantic_false_corrected": False
            if not corrected["resolved"]
            else semantic_false_heading(gt, corrected["final_role"]),
            "true_removed_corrected": False
            if not corrected["resolved"]
            else true_heading_removed(gt, corrected["final_role"]),
        }
        annotated.append(rec)
    return annotated


def eval_heading_metrics(rows: list[dict], final_key: str) -> dict:
    heading_rows = [
        r
        for r in rows
        if r.get("gt_heading") and (r.get("expect_role") in HEADING)
    ]
    exact = sum(1 for r in heading_rows if r.get(final_key) == r.get("expect_role"))
    detect = sum(1 for r in heading_rows if is_heading(r.get(final_key)))
    parse_fail = sum(1 for r in rows if r.get("corrected_parse_failure"))
    return {
        "heading_n": len(heading_rows),
        "heading_exact": exact,
        "heading_detect": detect,
        "parse_failures": parse_fail,
        "semantic_false": sum(1 for r in rows if r.get("semantic_false_corrected")),
        "true_removed": sum(1 for r in rows if r.get("true_removed_corrected")),
        "legacy_unsafe": sum(1 for r in rows if r.get("legacy_unsafe_corrected")),
        "old_candidates": sum(1 for r in rows if r.get("old_candidate")),
        "corrected_candidates": sum(1 for r in rows if r.get("corrected_candidate")),
        "same_level_added": sum(
            1
            for r in rows
            if r.get("corrected_candidate")
            and not r.get("old_candidate")
            and r.get("mutation_class") == "H_to_same_H"
        ),
    }


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def coverage_map(path: Path) -> dict[str, dict]:
    out = {}
    if not path.is_file():
        return out
    for row in load_jsonl(path):
        loc = str(row.get("locator") or "")
        flag = row.get("page_verify")
        parsed = bool(row.get("page_verify_parsed"))
        if flag is not None or parsed or row.get("verification_failure"):
            out[loc] = {
                "page_verify": flag,
                "page_verify_parsed": parsed,
                "verification_failure": bool(row.get("verification_failure")),
                "verify_input": row.get("verify_input"),
                "final_role": row.get("final_role"),
            }
    return out


def compact_row(r: dict, extra: dict | None = None) -> dict:
    d = {
        "id": r.get("id"),
        "locator": r.get("locator") or r.get("id"),
        "text": r.get("text"),
        "gt_heading": r.get("gt_heading"),
        "existing_tag": r.get("existing_tag"),
        "preverify_final_role": r.get("preverify_final_role"),
        "old_candidate": r.get("old_candidate"),
        "corrected_candidate": r.get("corrected_candidate"),
        "mutation_class": r.get("mutation_class"),
        "historical_final_role": r.get("historical_final_role"),
        "historical_action": r.get("historical_action") or r.get("action"),
        "legacy_unsafe_historical": r.get("legacy_unsafe_historical"),
        "semantic_false_historical": r.get("semantic_false_historical"),
        "true_removed_historical": r.get("true_removed_historical"),
        "heading": r.get("heading"),
        "verify_applied_historical": r.get("verify_applied"),
        "skip": r.get("skip"),
        "corrected_final_role": r.get("corrected_final_role"),
        "corrected_action": r.get("corrected_action"),
        "semantic_false_corrected": r.get("semantic_false_corrected"),
        "true_removed_corrected": r.get("true_removed_corrected"),
        "legacy_unsafe_corrected": r.get("legacy_unsafe_corrected"),
        "corrected_resolved": r.get("corrected_resolved"),
        "has_frozen_marked_eligibility_prediction": r.get(
            "has_frozen_marked_eligibility_prediction"
        ),
    }
    if extra:
        d.update(extra)
    return d


def run_audit() -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    doc07 = annotate_eval(load_jsonl(HERE / "out" / "verify-07" / "verify-marked.jsonl"))
    probes = annotate_eval(load_jsonl(HERE / "out" / "verify-probes" / "verify-marked.jsonl"))

    h1_gt = load_gt(REPO_DOCS / "holdout")
    h2_gt = load_gt(REPO_DOCS / "holdout2")
    h1_rows = annotate_holdout(
        load_jsonl(HERE / "out" / "h1-scope" / "rescored-armB.jsonl"), h1_gt
    )
    h2_frozen = load_jsonl(HERE / "out" / "h2" / "predictions.frozen.jsonl")
    h2_rows = annotate_holdout(h2_frozen, h2_gt)

    marked_h1 = coverage_map(HERE / "out" / "h1-layout" / "rescored-armB-marked-binary.jsonl")
    part10 = coverage_map(HERE / "out" / "h1-layout" / "rescored-armB-verify.jsonl")
    part11 = coverage_map(HERE / "out" / "h1-layout" / "rescored-armB-marked.jsonl")
    part12 = coverage_map(HERE / "out" / "h1-layout" / "rescored-armB-marked-role.jsonl")
    part15 = coverage_map(HERE / "out" / "h1-layout" / "rescored-armB-text-binary.jsonl")
    marked_h2 = coverage_map(HERE / "out" / "h2" / "rescored-armB-marked-binary.jsonl")
    mutations_h2 = set(json.loads((HERE / "out" / "h2" / "mutations.json").read_text())["locators"])

    for r in h1_rows:
        loc = str(r.get("locator") or "")
        r["has_frozen_marked_eligibility_prediction"] = loc in marked_h1
        r["prior_verifier"] = {
            "part10_full_page_binary": loc in part10,
            "part11_marked_base": loc in part11,
            "part12_marked_role": loc in part12,
            "part15_text_binary": loc in part15,
            "part16_marked_binary": loc in marked_h1,
        }
        if r["corrected_candidate"] and loc in marked_h1:
            flag = marked_h1[loc]["page_verify"]
            parsed = marked_h1[loc]["page_verify_parsed"]
            heading_flag = flag if parsed else None
            applied = apply_semantic_verify(r["preverify_final_role"], heading_flag, r.get("existing_tag"))
            r["corrected_final_role"] = applied["final_role"]
            r["corrected_action"] = applied["action"]
            r["corrected_resolved"] = applied["resolved"]
            r["corrected_parse_failure"] = applied["parse_failure"]
        elif r["corrected_candidate"]:
            r["corrected_final_role"] = None
            r["corrected_action"] = None
            r["corrected_resolved"] = False
            r["corrected_parse_failure"] = False
        else:
            r["corrected_final_role"] = r["preverify_final_role"]
            r["corrected_action"] = action_of(r["preverify_final_role"], r.get("existing_tag"))
            r["corrected_resolved"] = True
            r["corrected_parse_failure"] = False
        if r.get("corrected_resolved"):
            r["semantic_false_corrected"] = semantic_false_heading(
                r["gt_heading"], r.get("corrected_final_role")
            )
            r["true_removed_corrected"] = true_heading_removed(
                r["gt_heading"], r.get("corrected_final_role")
            )
            r["legacy_unsafe_corrected"] = legacy_unsafe_mutation(
                r["gt_heading"], r.get("corrected_final_role"), r.get("corrected_action")
            )
        else:
            r["semantic_false_corrected"] = None
            r["true_removed_corrected"] = None
            r["legacy_unsafe_corrected"] = None

    for r in h2_rows:
        loc = str(r.get("locator") or "")
        r["has_frozen_marked_eligibility_prediction"] = loc in marked_h2
        r["old_mutation_list"] = loc in mutations_h2
        if r["corrected_candidate"] and loc in marked_h2:
            flag = marked_h2[loc]["page_verify"]
            parsed = marked_h2[loc]["page_verify_parsed"]
            heading_flag = flag if parsed else None
            applied = apply_semantic_verify(r["preverify_final_role"], heading_flag, r.get("existing_tag"))
            r["corrected_final_role"] = applied["final_role"]
            r["corrected_action"] = applied["action"]
            r["corrected_resolved"] = applied["resolved"]
            r["corrected_parse_failure"] = applied["parse_failure"]
        elif r["corrected_candidate"]:
            r["corrected_final_role"] = None
            r["corrected_action"] = None
            r["corrected_resolved"] = False
            r["corrected_parse_failure"] = False
        else:
            r["corrected_final_role"] = r["preverify_final_role"]
            r["corrected_action"] = action_of(r["preverify_final_role"], r.get("existing_tag"))
            r["corrected_resolved"] = True
            r["corrected_parse_failure"] = False
        if r.get("corrected_resolved"):
            r["semantic_false_corrected"] = semantic_false_heading(
                r["gt_heading"], r.get("corrected_final_role")
            )
            r["true_removed_corrected"] = true_heading_removed(
                r["gt_heading"], r.get("corrected_final_role")
            )
            r["legacy_unsafe_corrected"] = legacy_unsafe_mutation(
                r["gt_heading"], r.get("corrected_final_role"), r.get("corrected_action")
            )
        else:
            r["semantic_false_corrected"] = None
            r["true_removed_corrected"] = None
            r["legacy_unsafe_corrected"] = None

    proof_ids = ("07-h1", "07-intro", "07-chart-title", "07-cap")
    proof = [r for r in doc07 if r.get("id") in proof_ids]
    four = (
        "k01-vector-chart-titles:4",
        "k01-vector-chart-titles:7",
        "k12-definition-list:2",
        "k12-definition-list:6",
    )
    four_rows = [r for r in h2_rows if r.get("locator") in four]

    h1_candidates = [r for r in h1_rows if r.get("corrected_candidate")]
    h1_covered = [r for r in h1_candidates if r.get("has_frozen_marked_eligibility_prediction")]
    h1_missing = [r for r in h1_candidates if not r.get("has_frozen_marked_eligibility_prediction")]
    h2_candidates = [r for r in h2_rows if r.get("corrected_candidate")]
    h2_covered = [r for r in h2_candidates if r.get("has_frozen_marked_eligibility_prediction")]
    h2_missing = [r for r in h2_candidates if not r.get("has_frozen_marked_eligibility_prediction")]

    h1_useful_hist = heading_usefulness(h1_rows, h1_gt, "historical_final_role")
    h2_useful_hist = heading_usefulness(h2_rows, h2_gt, "historical_final_role")

    def surface_counts(rows: list[dict], label: str) -> dict:
        old_n = sum(1 for r in rows if r.get("old_candidate"))
        new_n = sum(1 for r in rows if r.get("corrected_candidate"))
        same = sum(
            1
            for r in rows
            if r.get("corrected_candidate")
            and not r.get("old_candidate")
            and r.get("mutation_class") == "H_to_same_H"
        )
        return {
            "surface": label,
            "evaluable": len(rows),
            "old_mutation_candidates": old_n,
            "corrected_would_finish_H": new_n,
            "newly_added": new_n - old_n,
            "newly_added_same_level_H": same,
            **count_classes(rows),
            "gt_heading_among_corrected": sum(
                1 for r in rows if r.get("corrected_candidate") and r.get("gt_heading")
            ),
            "gt_nonheading_among_corrected": sum(
                1 for r in rows if r.get("corrected_candidate") and not r.get("gt_heading")
            ),
            "legacy_unsafe_historical": sum(1 for r in rows if r.get("legacy_unsafe_historical")),
            "semantic_false_historical": sum(1 for r in rows if r.get("semantic_false_historical")),
            "true_removed_historical": sum(1 for r in rows if r.get("true_removed_historical")),
            "missed_by_legacy_n": len(missed_by_legacy(rows)),
        }

    h1_partial_resolved = [r for r in h1_rows if r.get("corrected_resolved")]
    h2_partial_resolved = [r for r in h2_rows if r.get("corrected_resolved")]
    payload = {
        "policy": {
            "verifier_false_on_would_finish_H": "P",
            "caveat": (
                "P is an experimental remediation target consistent with "
                "Headings.java demotion, not a claim of paragraphhood."
            ),
            "parse_failure": "unresolved; not heading:false; not a keep-H* success",
        },
        "doc07": {
            "metrics_old": {
                "old_candidates": sum(1 for r in doc07 if r.get("old_candidate")),
                "corrected_candidates": sum(1 for r in doc07 if r.get("corrected_candidate")),
                "legacy_unsafe": sum(1 for r in doc07 if r.get("legacy_unsafe_historical")),
                "semantic_false": sum(1 for r in doc07 if r.get("semantic_false_historical")),
                "true_removed": sum(1 for r in doc07 if r.get("true_removed_historical")),
            },
            "metrics_corrected": eval_heading_metrics(doc07, "corrected_final_role"),
            "proof": [compact_row(r) for r in proof],
            "all": [compact_row(r) for r in doc07],
        },
        "probes": {
            "metrics_old": {
                "old_candidates": sum(1 for r in probes if r.get("old_candidate")),
                "corrected_candidates": sum(1 for r in probes if r.get("corrected_candidate")),
                "legacy_unsafe": sum(1 for r in probes if r.get("legacy_unsafe_historical")),
                "semantic_false": sum(1 for r in probes if r.get("semantic_false_historical")),
                "true_removed": sum(1 for r in probes if r.get("true_removed_historical")),
            },
            "metrics_corrected": eval_heading_metrics(probes, "corrected_final_role"),
            "classes": count_classes(probes),
            "rows": [compact_row(r) for r in probes],
        },
        "h1": {
            **surface_counts(h1_rows, "spent H1 Arm B"),
            "usefulness_historical": {
                "heading_n": h1_useful_hist["heading_n"],
                "heading_exact": h1_useful_hist["heading_exact"],
                "heading_detect": h1_useful_hist["heading_detect"],
                "heading_demote": h1_useful_hist["heading_demote"],
                "unmatched_gt_headings": h1_useful_hist["unmatched_gt_headings"],
                "r2_true_heading_collisions": h1_useful_hist["r2_true_heading_collisions"],
            },
            "coverage": {
                "corrected_candidates": len(h1_candidates),
                "has_frozen_marked_eligibility_prediction": len(h1_covered),
                "missing": len(h1_missing),
                "prior": {
                    "part10_full_page_binary": sum(
                        1 for r in h1_candidates if r["prior_verifier"]["part10_full_page_binary"]
                    ),
                    "part11_marked_base": sum(
                        1 for r in h1_candidates if r["prior_verifier"]["part11_marked_base"]
                    ),
                    "part12_marked_role": sum(
                        1 for r in h1_candidates if r["prior_verifier"]["part12_marked_role"]
                    ),
                    "part15_text_binary": sum(
                        1 for r in h1_candidates if r["prior_verifier"]["part15_text_binary"]
                    ),
                    "part16_marked_binary": sum(
                        1 for r in h1_candidates if r["prior_verifier"]["part16_marked_binary"]
                    ),
                },
            },
            "partial_rescore_on_covered": {
                "n": len(h1_covered),
                "semantic_false": sum(
                    1 for r in h1_covered if r.get("semantic_false_corrected")
                ),
                "true_removed": sum(1 for r in h1_covered if r.get("true_removed_corrected")),
                "legacy_unsafe": sum(1 for r in h1_covered if r.get("legacy_unsafe_corrected")),
                "unresolved_candidates": len(h1_missing),
                "parse_failures": sum(1 for r in h1_rows if r.get("corrected_parse_failure")),
            },
            "resolved_including_non_candidates": {
                "n": len(h1_partial_resolved),
                "semantic_false": sum(
                    1 for r in h1_partial_resolved if r.get("semantic_false_corrected")
                ),
                "true_removed": sum(
                    1 for r in h1_partial_resolved if r.get("true_removed_corrected")
                ),
            },
            "missed_by_legacy": missed_by_legacy(h1_rows),
            "same_level_existing_H_false_headings": [
                compact_row(r)
                for r in h1_rows
                if (not r.get("gt_heading"))
                and r.get("mutation_class") == "H_to_same_H"
                and r.get("semantic_false_historical")
            ],
        },
        "h2": {
            **surface_counts(h2_rows, "spent H2"),
            "usefulness_historical": {
                "heading_n": h2_useful_hist["heading_n"],
                "heading_exact": h2_useful_hist["heading_exact"],
                "heading_detect": h2_useful_hist["heading_detect"],
                "heading_demote": h2_useful_hist["heading_demote"],
                "unmatched_gt_headings": h2_useful_hist["unmatched_gt_headings"],
                "r2_true_heading_collisions": h2_useful_hist["r2_true_heading_collisions"],
            },
            "coverage": {
                "corrected_candidates": len(h2_candidates),
                "has_frozen_marked_eligibility_prediction": len(h2_covered),
                "missing": len(h2_missing),
                "old_mutation_list_n": len(mutations_h2),
            },
            "partial_rescore_on_covered": {
                "n": len(h2_covered),
                "semantic_false": sum(
                    1 for r in h2_covered if r.get("semantic_false_corrected")
                ),
                "true_removed": sum(1 for r in h2_covered if r.get("true_removed_corrected")),
                "legacy_unsafe": sum(1 for r in h2_covered if r.get("legacy_unsafe_corrected")),
                "unresolved_candidates": len(h2_missing),
                "parse_failures": sum(1 for r in h2_rows if r.get("corrected_parse_failure")),
            },
            "missed_by_legacy": missed_by_legacy(h2_rows),
            "part17_four": [compact_row(r) for r in four_rows],
            "same_level_existing_H_false_headings": [
                compact_row(r)
                for r in h2_rows
                if (not r.get("gt_heading"))
                and r.get("mutation_class") == "H_to_same_H"
                and r.get("semantic_false_historical")
            ],
        },
        "sources": {
            "verify_07": str(HERE / "out" / "verify-07" / "verify-marked.jsonl"),
            "verify_probes": str(HERE / "out" / "verify-probes" / "verify-marked.jsonl"),
            "h1_armB": str(HERE / "out" / "h1-scope" / "rescored-armB.jsonl"),
            "h2_frozen": str(HERE / "out" / "h2" / "predictions.frozen.jsonl"),
        },
    }

    (OUT / "audit.json").write_text(json.dumps(payload, indent=2, default=str) + "\n")
    (OUT / "doc07.jsonl").write_text("".join(json.dumps(compact_row(r)) + "\n" for r in doc07))
    (OUT / "probes.jsonl").write_text("".join(json.dumps(compact_row(r)) + "\n" for r in probes))
    (OUT / "h1-candidates.jsonl").write_text(
        "".join(json.dumps(compact_row(r)) + "\n" for r in h1_candidates)
    )
    (OUT / "h2-candidates.jsonl").write_text(
        "".join(json.dumps(compact_row(r)) + "\n" for r in h2_candidates)
    )
    (OUT / "missed-by-legacy.json").write_text(
        json.dumps(
            {
                "doc07": missed_by_legacy(doc07),
                "probes": missed_by_legacy(probes),
                "h1": missed_by_legacy(h1_rows),
                "h2": missed_by_legacy(h2_rows),
            },
            indent=2,
        )
        + "\n"
    )
    manifest = {
        "audit_sha256": sha256_file(OUT / "audit.json"),
        "policy": payload["policy"],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(
        {
            "out": str(OUT / "audit.json"),
            "doc07": payload["doc07"]["metrics_corrected"],
            "probes": payload["probes"]["metrics_corrected"],
            "h1": {k: payload["h1"][k] for k in (
                "evaluable",
                "old_mutation_candidates",
                "corrected_would_finish_H",
                "newly_added_same_level_H",
                "legacy_unsafe_historical",
                "semantic_false_historical",
                "missed_by_legacy_n",
            )},
            "h1_coverage": payload["h1"]["coverage"],
            "h2": {k: payload["h2"][k] for k in (
                "evaluable",
                "old_mutation_candidates",
                "corrected_would_finish_H",
                "newly_added_same_level_H",
                "legacy_unsafe_historical",
                "semantic_false_historical",
                "missed_by_legacy_n",
            )},
            "h2_coverage": payload["h2"]["coverage"],
            "h2_four": payload["h2"]["part17_four"],
        },
        indent=2,
        default=str,
    ))
    return payload


def main() -> None:
    if "--check-only" in sys.argv:
        run_check()
        return
    run_check()
    run_audit()


if __name__ == "__main__":
    main()
