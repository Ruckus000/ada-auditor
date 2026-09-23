r"""Rule R5 as a recompute over existing predictions: no model run.

The registered rule (heading-stage2-2026-09-18-results.md, "Rule R5
(enumerator-only = Lbl)"): a card whose whole text matches
``^(?:[IVX]+|[A-Z]|\d+)\.$`` is decided ``Lbl`` before the model, with rule
score 1.0. In the product path that is ``labels.rules.enumerator_only``, the
last rule in ``decide``; here the same decision is applied to a predictions
file offline. Only ``decided_by == "model"`` rows are eligible: a row already
decided by an earlier rule stands exactly as the product path left it.

``--r5b`` swaps the view for R5b (``labels.rules.enumerator_quote_only``: the
enumerator plus an optional opening quote), the secondary view registered for
the r13 confirmation batch on 2026-09-23. The default is R5, unchanged.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from labels.rules import ENUMERATOR_ONLY, ENUMERATOR_QUOTE_ONLY

RULE_ROW = {"raw": '{"type":"Lbl","rule":5}', "decided_by": "rule",
            "p_H": None, "score": 1.0, "score_method": "rule"}


def override_row(pred: dict, card: dict) -> dict:
    """The prediction row with R5 applied, or the same object when R5 does not fire."""
    if pred.get("decided_by") != "model":
        return pred
    if not ENUMERATOR_ONLY.match((card.get("text") or "").strip()):
        return pred
    return {"id": pred["id"], **RULE_ROW}


def override_row_r5b(pred: dict, card: dict) -> dict:
    """The opt-in second view: R5b (enumerator plus an optional opening quote,
    registered 2026-09-23 for the confirmation batch) applied instead of R5.
    Same contract as ``override_row``: model-decided rows only."""
    if pred.get("decided_by") != "model":
        return pred
    if not ENUMERATOR_QUOTE_ONLY.match((card.get("text") or "").strip()):
        return pred
    return {"id": pred["id"], **RULE_ROW}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--predictions", type=Path, required=True)
    p.add_argument("--cards", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--r5b", action="store_true",
                   help="apply the opt-in R5b view (enumerator plus an optional opening quote) instead of R5")
    a = p.parse_args()
    view = override_row_r5b if a.r5b else override_row
    cards = {json.loads(l)["id"]: json.loads(l) for l in a.cards.read_text().splitlines() if l.strip()}
    rows = [json.loads(l) for l in a.predictions.read_text().splitlines() if l.strip()]
    overridden = []
    with a.out.open("w") as f:
        for pred in rows:
            out = view(pred, cards.get(pred["id"], {}))
            if out is not pred:
                overridden.append(pred["id"])
            f.write(json.dumps(out) + "\n")
    print(json.dumps({"rows": len(rows), "overridden": len(overridden), "ids": overridden}))


if __name__ == "__main__":
    main()
