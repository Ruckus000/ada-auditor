"""Inter-rater agreement on the shared sample. The ceiling on any 99 % claim."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def agreement(a: list[dict], b: list[dict]) -> dict:
    by_a = {r["id"]: r for r in a}
    by_b = {r["id"]: r for r in b}
    shared = [i for i in by_a if i in by_b]
    unsure = {"a": sum(by_a[i].get("unsure", False) for i in shared), "b": sum(by_b[i].get("unsure", False) for i in shared)}
    pairs = [(by_a[i], by_b[i]) for i in shared if not by_a[i].get("unsure") and not by_b[i].get("unsure")]
    n = len(pairs)
    type_ok = sum(x["type"] == y["type"] for x, y in pairs)
    head_ok = sum(x["label"]["heading"] == y["label"]["heading"] for x, y in pairs)
    both_h = [(x, y) for x, y in pairs if x["label"]["heading"] and y["label"]["heading"]]
    level_ok = sum(x["label"]["level"] == y["label"]["level"] for x, y in both_h)
    return {
        "n": n,
        "type_agreement": None if not n else type_ok / n,
        "heading_agreement": None if not n else head_ok / n,
        "level_agreement": None if not both_h else level_ok / len(both_h),
        "disagreements": [{"id": x["id"], "a": f"{x['type']}{x['label']['level'] or ''}", "b": f"{y['type']}{y['label']['level'] or ''}"} for x, y in pairs if x["type"] != y["type"] or x["label"]["level"] != y["label"]["level"]],
        "unsure": unsure,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("a", type=Path)
    p.add_argument("b", type=Path)
    args = p.parse_args()
    load = lambda f: [json.loads(l) for l in f.read_text().splitlines() if l.strip()]
    print(json.dumps(agreement(load(args.a), load(args.b)), indent=2))


if __name__ == "__main__":
    main()
