"""Registered threshold rules for the merged-heading probe (strategies A and B).

Reads the dev set (``merged_probe.py``) and the probe's predictions
(``predict.py --scores``) and applies the rules registered 2026-09-22 in
``docs/superpowers/plans/2026-09-22-merged-heading-strategies.md``:

- ``tau_A`` (probe-and-ask): the smallest tau whose false-trigger rate on dev
  negatives is <= 2.0 %. A row triggers when its probe was model-decided and
  ``p_H >= tau``; rule-decided rows (``p_H`` null) never trigger. Dev recall is
  the share of dev positives triggering at ``tau_A``; the wild look is taken
  only when recall >= 0.5.
- ``tau_B`` (probe-and-split): the smallest tau with dev split precision
  >= 0.9 — of the dev rows triggering at tau, the share that are positives.
  Dev-only: precision and recall are reported; no gate look is registered.

Candidates are the distinct non-null probe p_H values over all dev rows. When
no candidate meets a cap the tau is None and the strategy is reported as
spent — never a tau fitted past the cap.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

FALSE_TRIGGER_MAX = 0.02
PRECISION_MIN = 0.9
RECALL_FOR_WILD = 0.5


def load_probe_scores(predictions_path: Path) -> dict[str, float | None]:
    """probe card id -> p_H (None for rule-decided rows)."""
    out = {}
    for line in predictions_path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        out[row["id"]] = row.get("p_H")
    return out


def triggers(rows: list[dict], p_h: dict[str, float | None], kind: str | None, tau: float) -> int:
    """Dev rows (optionally one kind) whose model-decided probe p_H reaches tau."""
    return sum(1 for r in rows
               if (kind is None or r["kind"] == kind)
               and (p := p_h.get(probe_id_of(r))) is not None and p >= tau)


def probe_id_of(row: dict) -> str:
    return f"{row['id']}mh"


def candidates(rows: list[dict], p_h: dict[str, float | None]) -> list[float]:
    return sorted({p for r in rows if (p := p_h.get(probe_id_of(r))) is not None})


def tau_a(rows: list[dict], p_h: dict[str, float | None], cap: float = FALSE_TRIGGER_MAX) -> dict:
    """The registered probe-and-ask threshold and its dev numbers."""
    negatives = sum(1 for r in rows if r["kind"] == "negative")
    positives = sum(1 for r in rows if r["kind"] == "positive")
    chosen = None
    for t in candidates(rows, p_h):
        if negatives and triggers(rows, p_h, "negative", t) / negatives <= cap:
            chosen = t
            break
    if chosen is None:
        return {"tau_A": None, "note": f"no probe score keeps false triggers <= {cap} of dev negatives",
                "negatives": negatives, "positives": positives, "dev_recall": 0.0, "wild_look": False}
    false_triggers = triggers(rows, p_h, "negative", chosen)
    recovered = triggers(rows, p_h, "positive", chosen)
    recall = recovered / positives if positives else None
    return {"tau_A": chosen, "negatives": negatives, "positives": positives,
            "false_triggers": false_triggers, "false_trigger_rate": false_triggers / negatives if negatives else None,
            "recovered": recovered, "dev_recall": recall,
            "wild_look": recall is not None and recall >= RECALL_FOR_WILD}


def tau_b(rows: list[dict], p_h: dict[str, float | None], precision_min: float = PRECISION_MIN) -> dict:
    """The registered probe-and-split threshold and its dev numbers (dev-only)."""
    positives = sum(1 for r in rows if r["kind"] == "positive")
    chosen = None
    for t in candidates(rows, p_h):
        fired = triggers(rows, p_h, None, t)
        if fired and triggers(rows, p_h, "positive", t) / fired >= precision_min:
            chosen = t
            break
    if chosen is None:
        return {"tau_B": None, "note": f"no probe score reaches dev split precision {precision_min}"}
    fired = triggers(rows, p_h, None, chosen)
    recovered = triggers(rows, p_h, "positive", chosen)
    return {"tau_B": chosen, "fired": fired, "recovered": recovered,
            "dev_precision": recovered / fired if fired else None,
            "dev_recall": recovered / positives if positives else None}


def report(dev_set_path: Path, predictions_path: Path) -> dict:
    dev = json.loads(dev_set_path.read_text())
    rows = dev["rows"]
    p_h = load_probe_scores(predictions_path)
    missing = [probe_id_of(r) for r in rows if probe_id_of(r) not in p_h]
    if missing:
        raise SystemExit(f"{len(missing)} dev rows have no probe prediction, first: {missing[:5]}")
    return {"dev_set_sha256": dev.get("sha256"), "rows": len(rows),
            "false_trigger_max": FALSE_TRIGGER_MAX, "precision_min": PRECISION_MIN,
            "recall_for_wild": RECALL_FOR_WILD, "A": tau_a(rows, p_h), "B": tau_b(rows, p_h)}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dev-set", type=Path, required=True)
    p.add_argument("--predictions", type=Path, required=True)
    a = p.parse_args(argv)
    print(json.dumps(report(a.dev_set, a.predictions), indent=1))


if __name__ == "__main__":
    main()
