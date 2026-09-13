"""Candidate cards from a Cards.java dump: a RECALL net, not a decider.

Keeps every source H*, every short unterminated line, every size/weight
outlier on its page, plus a 5 % random slice of everything else so the net's
own misses are measurable. The source tag rides along as `existing_tag` and
is never shown to a reviewer.

Two bounds, both measured on the real corpus BEFORE any label was written
(2026-09-13, 43 tagged PDFs: 27,793 blocks, 18,035 kept by the rules alone):
blocks inside a Table, TOC or List are a different question (TH/TOCI/Lbl)
and made up 8,758 of those, so they enter only as source H* or in the random
slice; and three long documents (n05 at 578 pages, r09, r15) supplied more
than half the rest, so each document contributes at most CAP cards, chosen
source_h > outlier > short and at random within a class. Random-slice rows
are exempt from the cap: they are the recall measurement.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
from collections import defaultdict
from pathlib import Path

from run import HEADING, blocks_to_cards, dump_pdf, text_norm

SEED = 20260913
RANDOM_SHARE = 0.05
MAX_WORDS = 15
TERMINAL = ".!?;:"
OUTLIER_RATIO = 1.15
BAND_PT = 24.0
CAP = 150
CONTAINERS = ("Table", "TOC", "L")
PRIORITY = {"source_h": 0, "outlier": 1, "short": 2, "random": 3}


def repeats_on_pages(cards: list[dict]) -> dict[str, int]:
    """Pages on which the same normalised text sits in the same vertical band."""
    seen: dict[tuple[str, int], set[int]] = defaultdict(set)
    for c in cards:
        if c.get("page") is None or c.get("y0") is None:
            continue
        seen[(text_norm(c["text"]), int(float(c["y0"]) // BAND_PT))].add(int(c["page"]))
    return {c["locator"]: len(seen.get((text_norm(c["text"]), int(float(c["y0"]) // BAND_PT)), {0})) if c.get("page") is not None and c.get("y0") is not None else 1 for c in cards}


def page_medians(cards: list[dict]) -> dict[int, tuple[float | None, str]]:
    by_page: dict[int, list[dict]] = defaultdict(list)
    for c in cards:
        if c.get("page") is not None and c.get("font_pt") is not None:
            by_page[int(c["page"])].append(c)
    out = {}
    for page, cs in by_page.items():
        pts = [float(c["font_pt"]) for c in cs]
        bold = sum(1 for c in cs if c.get("weight") == "bold")
        out[page] = (statistics.median(pts), "bold" if bold * 2 > len(cs) else "regular")
    return out


def contained(c: dict) -> bool:
    return bool(c.get("in_table_box")) or any(a in CONTAINERS for a in (c.get("ancestors") or []))


def cap_per_document(cards: list[dict], rng: random.Random, cap: int = CAP) -> list[dict]:
    """At most `cap` non-random cards per document, best reasons first."""
    out: list[dict] = []
    for doc in sorted({c["document_id"] for c in cards}):
        mine = [c for c in cards if c["document_id"] == doc]
        exempt = [c for c in mine if c["why"] == ["random"]]
        ranked = [c for c in mine if c["why"] != ["random"]]
        rng.shuffle(ranked)
        ranked.sort(key=lambda c: min(PRIORITY[w] for w in c["why"]))
        out += ranked[:cap] + exempt
    return out


def reasons(c: dict, medians: dict) -> list[str]:
    why = []
    if c.get("existing_tag") in HEADING:
        why.append("source_h")
    if contained(c):
        return why
    words = c["text"].split()
    if 0 < len(words) <= MAX_WORDS and c["text"].strip()[-1:] not in TERMINAL:
        why.append("short")
    med = medians.get(int(c["page"])) if c.get("page") is not None else None
    if med and c.get("font_pt") is not None:
        pt, wt = med
        if pt and float(c["font_pt"]) >= OUTLIER_RATIO * pt:
            why.append("outlier")
        elif c.get("weight") == "bold" and wt == "regular":
            why.append("outlier")
    return why


def select_candidates(cards: list[dict], rng: random.Random) -> list[dict]:
    medians = page_medians(cards)
    repeats = repeats_on_pages(cards)
    out = []
    for c in cards:
        why = reasons(c, medians)
        if not why and rng.random() < RANDOM_SHARE:
            why = ["random"]
        if not why:
            continue
        row = dict(c)
        row["card_id"] = c["locator"]
        row["why"] = why
        row["repeats_on_pages"] = repeats.get(c["locator"], 1)
        row["page_median_pt"] = medians.get(int(c["page"]), (None, None))[0] if c.get("page") is not None else None
        out.append(row)
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--pdfs", type=Path, default=Path("out/labels/pdfs"))
    p.add_argument("--out", type=Path, default=Path("out/labels/cards-pdf.jsonl"))
    a = p.parse_args()
    rng = random.Random(SEED)
    rows = [r for r in json.loads(a.manifest.read_text()) if r["kind"] == "pdf"]
    total = kept = 0
    first = True
    with a.out.open("w") as f:
        for r in rows:
            pdf = a.pdfs / f"{r['id']}.pdf"
            if not pdf.is_file():
                continue
            cards, _failed = blocks_to_cards(dump_pdf(pdf, compile=first).get("blocks") or [])
            first = False
            total += len(cards)
            chosen = select_candidates(cards, rng)
            for c in chosen:
                c["document_id"] = r["id"]
                c["kind"] = "pdf"
            for c in cap_per_document(chosen, rng):
                f.write(json.dumps(c) + "\n")
                kept += 1
    print(json.dumps({"blocks": total, "candidates": kept}))


if __name__ == "__main__":
    main()
