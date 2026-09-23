"""Stage 2 Task 8: the evaluation command set for the wild population, graded against
the four-judge Claude consensus. Every number it prints is tagged
"graded against Claude-consensus labels".

Given the folded files from ``labels/fold_wild.py`` it prints one JSON report:

- ``direct``: TP/FP/TN/FN (plus abstain and parse-failure, which count as errors),
  accuracy and FP rate each with exact two-sided 95 % bounds, FN rate. Counts come
  from ``eligibility_eval.evaluate`` unchanged.
- ``threshold_rule``: the registered rule (r11, ``operating-point-r10.json``) re-run
  here -- the lowest score at which the covered subset's accuracy lower bound is
  >= 0.98 and its FP upper bound is <= 0.02 -- with coverage and the per-document
  clean rate (documents with zero covered errors) at that threshold. Coverage is
  covered rows over *scored* rows (a prediction with a non-null score), so a labels
  file carrying rows no prediction covers -- train rows beside validation, say --
  does not dilute it.
- ``coverage_curve`` at 0.5 / 0.9 / 0.95 / 0.99 / 0.9933.
- ``recall_by_weight`` (card weight from the cards file) and ``level_by_depth``
  (level exactness among true positives, by the label's level), both direct.

A row is covered at ``t`` when its score is not null, ``score >= t``, and its
prediction is decisive (heading or not-heading). Bounds are exact
Clopper-Pearson from ``eligibility_eval.upper_bound`` at 97.5 % one-sided per
side -- the two-sided 95 % interval the registered operating point reports
(checked against its numbers in the tests). There is no calibration column:
every wild card is labelled, so no row is untouched by the labels.

    python3 -B -m labels.eval_wild --labels out/labels/wild-labels.jsonl \\
        --predictions out/stage1/pred-wild-r10.jsonl --cards out/labels/wild-cards.jsonl
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from eligibility_eval import CONFIDENCE, evaluate, load_jsonl, read_prediction, refusals, upper_bound

DISCLOSURE = "graded against Claude-consensus labels"
LABEL_SOURCE = "claude-consensus"
# Registered 2026-09-21: opus-kimi-consensus rows (Claude Opus-medium seat 1
# and Kimi K3 seat 2 on page sheets, Claude Opus-quick per-card tie-break).
# Registered 2026-09-22, before the run: opus-quick-card-rejudge rows (one Claude
# Opus-quick judge, card by card), which replace the 565 sheet-round rows only if
# the page-sheet bias re-judge's model-blind verdict is CONFIRMED.
LABEL_SOURCES = ("claude-consensus", "opus-kimi-consensus", "opus-quick-card-rejudge")
DISCLOSURES = {
    "claude-consensus": "graded against Claude-consensus labels",
    "opus-kimi-consensus": "graded against consensus labels, judges: Claude Opus-medium (seat 1, sheets), "
                           "Kimi K3 (seat 2, sheets), Claude Opus-quick (per-card tie-break)",
    "opus-quick-card-rejudge": "graded against re-judged labels, judge: Claude Opus-quick (one judge, card by card)",
}
CURVE = (0.5, 0.9, 0.95, 0.99, 0.9933)
RULE_ACCURACY_LOWER = 0.98
RULE_FP_UPPER = 0.02
RULE = ("lowest score threshold where covered accuracy exact 95 % lower bound >= 0.98 "
        "and FP exact 95 % upper bound <= 0.02")
SIDE = 1 - (1 - CONFIDENCE) / 2


def interval(k: int, n: int) -> tuple[float | None, float | None]:
    """Exact two-sided 95 % (Clopper-Pearson) interval on k in n, from the evaluator's own bound."""
    if n == 0:
        return None, None
    return 1 - upper_bound(n - k, n, SIDE), upper_bound(k, n, SIDE)


def rate(k: int, n: int) -> float | None:
    return None if n == 0 else k / n


def at_threshold(rows: list[dict], preds: dict[str, dict], t: float) -> dict:
    counts = Counter()
    errors_by_doc: Counter = Counter()
    uncovered_docs = set()
    documents = {r["document_id"] for r in rows}
    scored = 0
    for r in rows:
        p = preds.get(r["id"])
        # Coverage is over scored rows, not all rows: a labels file can hold rows
        # no prediction scores (keys files carry train rows beside validation).
        if p is not None and p.get("score") is not None:
            scored += 1
        outcome = read_prediction(p["raw"])[0] if p else "parse-failure"
        if p is None or p.get("score") is None or p["score"] < t or outcome not in ("heading", "not-heading"):
            uncovered_docs.add(r["document_id"])
            continue
        truth = r["label"]["heading"]
        cell = ("tp" if truth else "fp") if outcome == "heading" else ("fn" if truth else "tn")
        counts[cell] += 1
        errors_by_doc[r["document_id"]] += cell in ("fp", "fn")
    covered = sum(counts.values())
    right, negatives, positives = counts["tp"] + counts["tn"], counts["fp"] + counts["tn"], counts["tp"] + counts["fn"]
    clean = [d for d in documents if not errors_by_doc[d]]
    return {
        "t": t, "covered": covered, "coverage": rate(covered, scored),
        **{k: counts[k] for k in ("tp", "fp", "tn", "fn")},
        "accuracy": rate(right, covered), "accuracy_ci": list(interval(right, covered)),
        "fp_rate": rate(counts["fp"], negatives), "fp_rate_ci": list(interval(counts["fp"], negatives)),
        "fn_rate": rate(counts["fn"], positives),
        "documents": len(documents), "documents_clean": len(clean),
        "documents_clean_rate": rate(len(clean), len(documents)),
        "documents_clean_fully_covered": sum(1 for d in clean if d not in uncovered_docs),
    }


def threshold_rule(rows: list[dict], preds: dict[str, dict]) -> dict:
    scores = sorted({preds[r["id"]]["score"] for r in rows if r["id"] in preds and preds[r["id"]].get("score") is not None})
    for t in scores:
        got = at_threshold(rows, preds, t)
        lo, hi = got["accuracy_ci"][0], got["fp_rate_ci"][1]
        if lo is not None and hi is not None and lo >= RULE_ACCURACY_LOWER and hi <= RULE_FP_UPPER:
            return {"rule": RULE, "threshold": t, **{k: v for k, v in got.items() if k != "t"}}
    return {"rule": RULE, "threshold": None, "note": "no score threshold meets the rule on these labels"}


def report(labels: list[dict], predictions: list[dict], cards: list[dict], disclosure: str = DISCLOSURE) -> dict:
    preds = {p["id"]: p for p in predictions}
    direct = evaluate(labels, {i: p["raw"] for i, p in preds.items()},
                      decided_by={i: p["decided_by"] for i, p in preds.items() if "decided_by" in p})
    c = direct["confusion"]
    right = c["tp"] + c["tn"]
    weight = {r["id"]: r.get("weight") or "unknown" for r in cards}
    by_weight: dict[str, dict] = {}
    by_depth: dict[str, dict] = {}
    for r in labels:
        if not r["label"]["heading"]:
            continue
        p = preds.get(r["id"])
        outcome, level = read_prediction(p["raw"]) if p else ("parse-failure", None)
        tp = outcome == "heading"
        w = by_weight.setdefault(weight.get(r["id"], "unknown"), {"positives": 0, "tp": 0})
        w["positives"] += 1
        w["tp"] += tp
        if r["label"].get("level") is not None:
            d = by_depth.setdefault(str(r["label"]["level"]), {"positives": 0, "tp": 0, "exact": 0})
            d["positives"] += 1
            d["tp"] += tp
            d["exact"] += tp and level == r["label"]["level"]
    for w in by_weight.values():
        w["recall"] = rate(w["tp"], w["positives"])
    return {
        "disclosure": disclosure,
        "direct": {
            "disclosure": disclosure, "n": direct["n"], "positives": direct["positives"], "negatives": direct["negatives"],
            "confusion": c, "missing_predictions": len(direct["missing_predictions"]),
            "accuracy": direct["accuracy"], "accuracy_ci": list(interval(right, direct["n"])),
            "false_positive_rate": direct["false_positive_rate"],
            "false_positive_rate_ci": list(interval(c["fp"], direct["negatives"])),
            "false_negative_rate": direct["false_negative_rate"],
            "type_confusion": direct["type_confusion"],
            "documents": direct["diversity"]["documents"], "clients": direct["diversity"]["clients"],
        },
        "threshold_rule": {"disclosure": disclosure, **threshold_rule(labels, preds)},
        "coverage_curve": {"disclosure": disclosure, "points": [at_threshold(labels, preds, t) for t in CURVE]},
        "recall_by_weight": {"disclosure": disclosure, "weights": dict(sorted(by_weight.items()))},
        "level_by_depth": {"disclosure": disclosure, "depths": dict(sorted(by_depth.items()))},
    }


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--predictions", type=Path, required=True)
    p.add_argument("--cards", type=Path, required=True)
    a = p.parse_args(argv)
    labels = load_jsonl(a.labels)
    present = sorted({r.get("label_source") for r in labels}, key=str)
    other = [s for s in present if s not in LABEL_SOURCES]
    if other:
        raise SystemExit(f"every row's label_source must be one of {LABEL_SOURCES}; found {other}")
    disclosure = "; ".join(DISCLOSURES[s] for s in LABEL_SOURCES if s in present)
    bad = refusals(labels)
    if bad:
        raise SystemExit("labels refused:\n" + "\n".join(bad[:30]))
    print(disclosure)
    print(json.dumps(report(labels, load_jsonl(a.predictions), load_jsonl(a.cards), disclosure), indent=2))


if __name__ == "__main__":
    main()
