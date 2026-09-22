"""The registered r11 operating-point rule, re-run for a new adapter on validation labels.

The rule (heading-stage1-r11-2026-09-18-results.md; ``labels.eval_wild.threshold_rule``):
the lowest score threshold at which the covered subset's exact 95 % accuracy
lower bound is >= 0.98 and the FP upper bound is <= 0.02. r10's point is
``out/stage1/operating-point-r10.json`` (0.993316 on ``labels-audited-r10``).

``eval_wild.py`` cannot run this on keys labels (its main gates label sources
to the wild judges), so this module drives the same functions for the keys
side. It writes one JSON per predictions file in the operating-point-r10
shape, plus the per-score curve the numbers were read from, so every figure
can be recomputed without the labels file. With ``--reference`` it also prints
the registered strategy-C guard: covered-accuracy lower bound and FP upper
bound no worse than the reference's.

    python3 -B -m labels.operating_point \
        --labels out/keys-all-4/labels-audited-r10.jsonl \
        --predictions out/stage1/pred-validation-r10.jsonl \
        --predictions out/overnight/06-predval-r13/pred-validation-r13.jsonl \
        --reference out/stage1/operating-point-r10.json \
        --out out/overnight/07-op-r13
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from labels.eval_wild import at_threshold, threshold_rule


def curve(rows: list[dict], preds: dict[str, dict]) -> list[dict]:
    """One line per distinct score: threshold, covered, right, fp, negatives — the whole
    table threshold_rule reads, so the point can be re-derived without the labels."""
    scores = sorted({p["score"] for p in preds.values() if p.get("score") is not None})
    out = []
    for t in scores:
        got = at_threshold(rows, preds, t)
        right = got["tp"] + got["tn"]
        out.append({"t": t, "covered": got["covered"], "right": right, "fp": got["fp"],
                    "negatives": got["fp"] + got["tn"], "tp": got["tp"], "fn": got["fn"],
                    "accuracy_ci": got["accuracy_ci"], "fp_rate_ci": got["fp_rate_ci"]})
    return out


def operating_point(name: str, labels: list[dict], predictions: list[dict]) -> dict:
    preds = {p["id"]: p for p in predictions}
    rule = threshold_rule(labels, preds)
    point = {"adapter": name, "rule": rule["rule"], "threshold": rule.get("threshold")}
    if rule.get("threshold") is None:
        point["note"] = rule.get("note")
        return {"point": point, "curve": curve(labels, preds)}
    got = at_threshold(labels, preds, rule["threshold"])
    point.update({
        "covered": got["covered"], "coverage": got["coverage"],
        "counts": {"tn": got["tn"], "tp": got["tp"], "fn": got["fn"], "fp": got["fp"]},
        "accuracy": got["accuracy"], "accuracy_ci": got["accuracy_ci"],
        "fp_rate": got["fp_rate"], "fp_ci": got["fp_rate_ci"], "fn_rate": got["fn_rate"],
        "documents": got["documents"], "documents_clean": got["documents_clean"],
    })
    return {"point": point, "curve": curve(labels, preds)}


def guard(point: dict, reference: dict) -> dict:
    """Strategy C's registered guard: validation covered-accuracy lower bound and FP upper
    bound no worse than the reference operating point's."""
    lo, ref_lo = (point.get("accuracy_ci") or [None])[0], (reference.get("accuracy_ci") or [None])[0]
    hi, ref_hi = (point.get("fp_ci") or [None, None])[1], (reference.get("fp_ci") or [None, None])[1]
    ok = (lo is not None and ref_lo is not None and hi is not None and ref_hi is not None
          and lo >= ref_lo and hi <= ref_hi)
    return {"accuracy_lower": {"new": lo, "reference": ref_lo, "no_worse": None if lo is None or ref_lo is None else lo >= ref_lo},
            "fp_upper": {"new": hi, "reference": ref_hi, "no_worse": None if hi is None or ref_hi is None else hi <= ref_hi},
            "guard_passed": ok}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--predictions", type=Path, action="append", required=True)
    p.add_argument("--reference", type=Path, default=None)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args(argv)
    if a.out.exists():
        raise SystemExit(f"{a.out} exists; choose a new name (provenance)")
    rows = [json.loads(l) for l in a.labels.read_text().splitlines() if l.strip()]
    a.out.mkdir(parents=True)
    result = {}
    for pred_path in a.predictions:
        name = pred_path.stem.replace("pred-validation-", "")
        got = operating_point(name, rows, [json.loads(l) for l in pred_path.read_text().splitlines() if l.strip()])
        (a.out / f"operating-point-{name}.json").write_text(json.dumps(got["point"], indent=1) + "\n")
        (a.out / f"curve-{name}.json").write_text(json.dumps(got["curve"]) + "\n")
        result[name] = got["point"]
    if a.reference is not None:
        ref = json.loads(a.reference.read_text())
        for name, point in result.items():
            if point.get("threshold") is not None:
                result[name] = {"point": point, "guard": guard(point, ref)}
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
