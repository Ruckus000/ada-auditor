"""Step 2: the symmetric label-audit sample for the 48 errors at the certification threshold. No judging.

Usage: python -B audit_design.py DATA_OUT RESULT_DIR
Mechanisms are the disjoint classes of
docs/research/document-remediation/heading-stage2-2026-10-09-entry-bar-error-anatomy.md (r14 branch).
"""
from __future__ import annotations

import collections
import glob
import json
import random
import sys
from pathlib import Path

from run_probe import DROP, LABELS, RUN, T

SEED = 20261009
PER_ERROR = 2          # correct comparators drawn per error
SEAT_COST = 7_300      # both seats, per card, in the shadow budget's unit
TIEBREAK_COST = 209_000

MECHANISMS = {
    "rule": "c8-0220:144 c8-0220:151 c8-0220:179 c8-0283:13 c8-0283:14 c8-0132:503 c8-0132:507 c8-0110:1 "
            "c8-0319:110 c8-0319:121 c8-0319:145 c8-0319:148 c8-0328:62",
    "scan-segmentation": "c8-0220:170 c8-0220:182 c8-0220:186 c8-0123:111 c8-0123:112 c8-0123:113 "
                         "c8-0042:3 c8-0042:84 c8-0042:198 c8-0042:233",
    "form-table": "c8-0117:11 c8-0117:21 c8-0117:27 c8-0117:35 c8-0117:43 c8-0117:53 c8-0117:78 "
                  "c8-0149:16 c8-0154:13 c8-0347:13",
    "run-in": "c8-0063:1 c8-0063:239 c8-0135:7 c8-0149:7 c8-0206:358 c8-0298:287 c8-0298:291 "
              "c8-0304:73 c8-0304:81 c8-0317:33",
    "map-title": "c8-0325:57 c8-0325:58 c8-0325:130",
    "fp": "c8-0070:182 c8-0124:8",
}


def main(data: Path, result: Path) -> None:
    mech = {i: m for m, ids in MECHANISMS.items() for i in ids.split()}
    rows = {}
    for f in LABELS:
        for r in map(json.loads, open(data / f)):
            rows[r["id"]] = r
    side = [c for f in sorted(glob.glob(str(data / RUN / "*/sidecar.json"))) for s in [json.load(open(f))]
            if s["document"] not in DROP for c in s["cards"]]
    decided = [c for c in side if c["score"] is not None and c["score"] >= T]
    errors = {c["card_id"] for c in decided if (c["type"] == "H") != rows[c["card_id"]]["label"]["heading"]}
    assert errors == set(mech), "the anatomy classes must cover exactly the 48 errors"

    table = collections.Counter((mech[i], rows[i]["resolution"]) for i in errors)
    tie_correct = sum(rows[c["card_id"]]["resolution"] != "seats-agree" for c in decided if c["card_id"] not in errors)

    # Comparators: correct decided cards from the error's document with the same predicted bit and decider,
    # so a judge cannot tell an error from a comparator by its shape or its document.
    rng = random.Random(SEED)
    pool = collections.defaultdict(list)
    for c in decided:
        if c["card_id"] not in errors:
            pool[(c["card_id"].split(":")[0], c["type"] == "H", c["decided_by"])].append(c["card_id"])
    taken, short = set(), 0
    for i in sorted(errors):
        c = next(x for x in decided if x["card_id"] == i)
        cands = sorted(set(pool[(i.split(":")[0], c["type"] == "H", c["decided_by"])]) - taken)
        pick = rng.sample(cands, min(PER_ERROR, len(cands)))
        short += PER_ERROR - len(pick)
        taken.update(pick)
    sample = sorted(errors) + sorted(taken)
    rng.shuffle(sample)  # judges see one blind list, never which cards are errors
    tie_rate = sum(rows[i]["resolution"] != "seats-agree" for i in sample) / len(sample)
    cost = {"cards": len(sample), "seats": len(sample) * SEAT_COST,
            "tiebreak_expected": round(tie_rate * len(sample)) * TIEBREAK_COST}
    cost["total"] = cost["seats"] + cost["tiebreak_expected"]
    out = {"errors_by_mechanism_and_resolution": {f"{m}|{r}": n for (m, r), n in sorted(table.items())},
           "tiebreak_among_correct_decided": tie_correct, "decided": len(decided),
           "comparators": len(taken), "comparators_short": short,
           "sample_tiebreak_share_in_existing_labels": tie_rate, "cost_unit": "dedup tokens, cache reads x0.1",
           "cost": cost}
    result.mkdir(parents=True, exist_ok=True)
    json.dump(out | {"sample_ids": sample, "error_ids": sorted(errors)}, open(result / "audit-design.json", "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
