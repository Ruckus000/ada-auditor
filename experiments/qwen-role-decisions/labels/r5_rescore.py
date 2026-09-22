r"""Rule R5 as a recompute over existing predictions: no model run.

The registered rule (heading-stage2-2026-09-18-results.md, "Rule R5
(enumerator-only = Lbl)"): a card whose whole text matches
``^(?:[IVX]+|[A-Z]|\d+)\.$`` is decided ``Lbl`` before the model, with rule
score 1.0. In the product path that is ``labels.rules.enumerator_only``, the
last rule in ``decide``; here the same decision is applied to a predictions
file offline. Only ``decided_by == "model"`` rows are eligible: a row already
decided by an earlier rule stands exactly as the product path left it.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from labels.rules import ENUMERATOR_ONLY

RULE_ROW = {"raw": '{"type":"Lbl","rule":5}', "decided_by": "rule",
            "p_H": None, "score": 1.0, "score_method": "rule"}


def override_row(pred: dict, card: dict) -> dict:
    """The prediction row with R5 applied, or the same object when R5 does not fire."""
    if pred.get("decided_by") != "model":
        return pred
    if not ENUMERATOR_ONLY.match((card.get("text") or "").strip()):
        return pred
    return {"id": pred["id"], **RULE_ROW}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--predictions", type=Path, required=True)
    p.add_argument("--cards", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    cards = {json.loads(l)["id"]: json.loads(l) for l in a.cards.read_text().splitlines() if l.strip()}
    rows = [json.loads(l) for l in a.predictions.read_text().splitlines() if l.strip()]
    overridden = []
    with a.out.open("w") as f:
        for pred in rows:
            out = override_row(pred, cards.get(pred["id"], {}))
            if out is not pred:
                overridden.append(pred["id"])
            f.write(json.dumps(out) + "\n")
    print(json.dumps({"rows": len(rows), "overridden": len(overridden), "ids": overridden}))


if __name__ == "__main__":
    main()
