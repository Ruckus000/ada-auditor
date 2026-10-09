"""Registered read of the blind re-judge (docs/research/document-remediation/heading-rejudge-2026-10-09-registration.md).

Usage: python -B rejudge_read.py DATA_OUT
Seats agree on the heading bit (Unsure = not-H) -> that bit; otherwise the majority of the three tie-break runs.
"""
from __future__ import annotations

import collections
import glob
import json
import math
import sys
from pathlib import Path

from audit_design import MECHANISMS
from run_probe import DROP, LABELS, RUN, T


def fisher_two_sided(a: int, b: int, c: int, d: int) -> float:
    """Two-sided Fisher exact p for [[a, b], [c, d]] (sum of tables at most as likely as the observed)."""
    n1, n2, k = a + b, c + d, a + c
    lo, hi = max(0, k - n2), min(k, n1)

    def p(x):
        return math.comb(n1, x) * math.comb(n2, k - x) / math.comb(n1 + n2, k)
    obs = p(a)
    return min(1.0, sum(p(x) for x in range(lo, hi + 1) if p(x) <= obs * (1 + 1e-9)))


def main(data: Path) -> None:
    rj = data / "cpu-probes-2026-10-09/rejudge"
    design = json.load(open(data / "cpu-probes-2026-10-09/audit-design.json"))
    errors = set(design["error_ids"])
    mech = {i: m for m, ids in MECHANISMS.items() for i in ids.split()}
    rows = {}
    for f in LABELS:
        for r in map(json.loads, open(data / f)):
            rows[r["id"]] = r
    side = {c["card_id"]: c for f in sorted(glob.glob(str(data / RUN / "*/sidecar.json")))
            for s in [json.load(open(f))] if s["document"] not in DROP for c in s["cards"]}
    seat = {}
    for name in ("seat1", "seat2"):
        seat[name] = {r["id"]: r for f in glob.glob(str(rj / f"out/{name}/*.jsonl")) for r in map(json.loads, open(f))}
    runs = collections.defaultdict(list)
    for r in map(json.loads, open(rj / "tiebreak-runs.jsonl")):
        runs[r["id"]].append(r)

    new, how = {}, {}
    for i in design["sample_ids"]:
        a, b = seat["seat1"][i]["type"], seat["seat2"][i]["type"]
        if "Unsure" not in (a, b) and (a == "H") == (b == "H"):
            new[i], how[i] = a == "H", "seats-agree"
        else:
            votes = [r["type"] == "H" for r in runs[i]]
            assert len(votes) == 3, f"{i}: {len(votes)} tie-break runs"
            new[i], how[i] = sum(votes) >= 2, "tiebreak"

    said = {i: side[i]["type"] == "H" for i in new}
    err_flip = [i for i in errors if new[i] == said[i]]
    comps = [i for i in new if i not in errors]
    comp_flip = [i for i in comps if new[i] != said[i]]
    p = fisher_two_sided(len(err_flip), len(errors) - len(err_flip), len(comp_flip), len(comps) - len(comp_flip))
    by_mech = collections.Counter(mech[i] for i in err_flip)
    by_old = collections.Counter(rows[i]["resolution"] for i in err_flip)
    old_tb = collections.Counter(rows[i]["resolution"] for i in errors)
    out = {
        "cards": len(new), "tiebroken_now": sum(h == "tiebreak" for h in how.values()),
        "error_flips": len(err_flip), "errors": len(errors), "error_flip_rate": len(err_flip) / len(errors),
        "comparator_flips": len(comp_flip), "comparators": len(comps), "comparator_flip_rate": len(comp_flip) / len(comps),
        "fisher_two_sided_p": p, "significant": p < 0.05,
        "error_flips_by_mechanism": dict(by_mech), "error_flips_by_old_resolution": dict(by_old),
        "errors_by_old_resolution": dict(old_tb),
        "estimated_genuine_model_errors": len(errors) - len(err_flip) if p < 0.05 else len(errors),
    }
    json.dump(out | {"error_flip_ids": sorted(err_flip), "comparator_flip_ids": sorted(comp_flip),
                     "new_heading_bit": new, "resolution": how}, open(rj / "read.json", "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
