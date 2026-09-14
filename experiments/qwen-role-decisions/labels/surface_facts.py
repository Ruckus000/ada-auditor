"""Surface facts of labelled cards, by type and source — the table that explained round 3.

Planted headings were bold 0.99 / Title Case 0.87 / ALL CAPS 0.00 / 12 pt
against real ones at 0.69 / 0.46 / 0.21 / 14 pt, and the model learned the
planted form. A generated cohort is measured with this before it enters an
SFT; its rows must sit within ±10 points of the real train rows on every
share below.

    python3 -B -m labels.surface_facts --labels out/keys-all-3/labels.jsonl \
        --cards out/keys-all-3/cards.jsonl --split out/keys-all-3/split/split.json
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path


def facts(cards: list[dict]) -> dict:
    if not cards:
        return {"n": 0}
    n = len(cards)
    texts = [c.get("text") or "" for c in cards]
    words = [len(t.split()) for t in texts]
    pts = [c["font_pt"] for c in cards if c.get("font_pt") is not None]
    return {
        "n": n,
        "bold": round(sum(c.get("weight") == "bold" for c in cards) / n, 2),
        "title_case": round(sum(t.istitle() for t in texts) / n, 2),
        "all_caps": round(sum(t.isupper() for t in texts if t.strip()) / n, 2),
        "ends_punct": round(sum(t.rstrip()[-1:] in ".:;" for t in texts) / n, 2),
        "median_pt": statistics.median(pts) if pts else None,
        "median_words": statistics.median(words),
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--cards", type=Path, required=True)
    p.add_argument("--split", type=Path, default=None, help="restrict to one split's ids via --on")
    p.add_argument("--on", default="train")
    p.add_argument("--pool", action="append", default=[],
                   help="also print one row per type over these label sources' cards together (repeatable)")
    a = p.parse_args()
    labels = [json.loads(l) for l in a.labels.read_text().splitlines() if l.strip()]
    cards = {c["card_id"]: c for c in (json.loads(l) for l in a.cards.read_text().splitlines() if l.strip())}
    if a.split:
        ids = set(json.loads(a.split.read_text())["ids"][a.on])
        labels = [r for r in labels if r["id"] in ids]
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in labels:
        c = cards.get(r["id"])
        if c is None:
            continue
        groups.setdefault((r["type"], r["label_source"]), []).append(c)
    for (t, src), cs in sorted(groups.items()):
        print(json.dumps({"type": t, "source": src, **facts(cs)}))
    for row in pooled(groups, a.pool):
        print(json.dumps(row))


def pooled(groups: dict[tuple[str, str], list[dict]], sources: list[str]) -> list[dict]:
    """Facts over the named sources' cards together, per type — not a mean of rounded shares."""
    if not sources:
        return []
    name = "pooled:" + "+".join(sources)
    by_type: dict[str, list[dict]] = {}
    for (t, src), cs in groups.items():
        if src in sources:
            by_type.setdefault(t, []).extend(cs)
    return [{"type": t, "source": name, **facts(cs)} for t, cs in sorted(by_type.items())]


if __name__ == "__main__":
    main()
