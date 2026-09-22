"""Strategy A's wild look: apply the registered probe abstention to folded predictions.

Registered 2026-09-22 in
``docs/superpowers/plans/2026-09-22-merged-heading-strategies.md``: a wild card
whose multi-line block's first-line probe (``labels.merged_probe``, ids with
the ``mh`` suffix) was model-decided at ``p_H >= tau_A`` abstains. The
abstention is applied to the fold's predictions, never to labels: the row's
``score`` becomes null (the evaluator's uncovered shape), with the firing
probe score kept beside it for the record. Rows without a firing probe are
copied unchanged, so the baseline fold is reproduced exactly when nothing
fires.

    python3 -B -m labels.abstain_probe --predictions 23-pred.jsonl \
        --probe pred-merged-probe-wild.jsonl --tau 0.XX --out 23-pred-abstain.jsonl
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from labels.merged_probe import PROBE_SUFFIX


def firing(probe_path: Path, tau: float) -> dict[str, float]:
    """Fold card id -> probe p_H for every model-decided probe at or above tau."""
    out = {}
    for line in probe_path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        p = row.get("p_H")
        if p is None or p < tau:
            continue
        probe_id = row["id"]
        if not probe_id.endswith(PROBE_SUFFIX):
            raise SystemExit(f"probe row id {probe_id!r} does not end with {PROBE_SUFFIX!r}")
        out[probe_id[: -len(PROBE_SUFFIX)]] = p
    return out


def apply_abstention(predictions_path: Path, probe_path: Path, tau: float, out_path: Path) -> dict:
    if out_path.exists():
        raise SystemExit(f"{out_path} exists; choose a new name (provenance)")
    fired = firing(probe_path, tau)
    rows = [json.loads(l) for l in predictions_path.read_text().splitlines() if l.strip()]
    n_abstain = 0
    out_rows = []
    for row in rows:
        p = fired.get(row["id"])
        if p is None:
            out_rows.append(row)
            continue
        n_abstain += 1
        out_rows.append({**row, "score": None, "abstained": "merged-probe", "probe_p_H": p})
    out_path.write_text("".join(json.dumps(r) + "\n" for r in out_rows))
    return {"rows": len(rows), "abstained": n_abstain, "tau": tau, "out": str(out_path)}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--predictions", type=Path, required=True)
    p.add_argument("--probe", type=Path, required=True)
    p.add_argument("--tau", type=float, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args(argv)
    print(json.dumps(apply_abstention(a.predictions, a.probe, a.tau, a.out), indent=1))


if __name__ == "__main__":
    main()
