"""Emit the Stage 1 SFT from key labels: typed target, rule cited, prior stack in the prompt.

One row per label whose type is in the vocabulary (``Other`` rows are held
back: they are negatives for evaluation but have no word to teach). Rows the
deterministic rules already decide are held back too — the model learns what
the rules cannot say. Images are rendered from the stripped copy under
``out/keys/pages`` so they never collide with the manual pass's images.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import defaultdict
from fractions import Fraction
from pathlib import Path

from labels.keys import VOCAB
from labels.rules import decide

TYPED_STEM = (
    "You are shown a PDF page. The outlined rectangle marks the exact Element "
    "described below. Classify it by ISO 32000 structure type: H (a heading that "
    "labels a section of the document's own content), P, Artifact (pagination, "
    "not content), Caption (describes a figure, chart or table), TH (table "
    "header cell), TOCI (table of contents entry), Lbl (list marker or bare "
    "number), BlockQuote. Typography alone never decides. Cite the rule: 1 = "
    "labels a section, 2 = not the document's own content, 3 = a more specific "
    "type applies, 4 = the visual cue is the only reason. For H give the level: "
    "one deeper than the open heading, or any shallower open level; the first "
    "heading is 1. Return ONLY JSON like {\"type\":\"H\",\"level\":2,\"rule\":1} "
    "or {\"type\":\"Caption\",\"rule\":3}."
)
RULE_OF = {"H": 1, "Artifact": 2, "Caption": 3, "TH": 3, "TOCI": 3, "Lbl": 3, "BlockQuote": 3, "P": 4}


def stack_before(card_row: dict, headings_in_order: list[dict], own_locator: str | None = None) -> list[dict]:
    """Approved headings before this card in reading order (page, then y0 top-origin).

    A heading card's own key element can sit a fraction of a point above the
    card (rounding between the original and the tagged copy), which would
    otherwise put the card in its own "Approved headings so far". Skip the
    heading matching ``own_locator``, and as a guard for rows without a
    locator, skip any heading on the same page within 2.0pt of the card's y0.
    """
    card_page = card_row.get("page")
    card_y0 = card_row.get("y0")
    pos = (card_page if card_page is not None else 10**9, card_y0 if card_y0 is not None else 0.0)
    stack: list[dict] = []
    for h in headings_in_order:
        if own_locator is not None and h.get("locator") == own_locator:
            continue
        if h["page"] == card_page and card_y0 is not None and abs(h["y0"] - card_y0) <= 2.0:
            continue
        if (h["page"], h["y0"]) >= pos:
            break
        stack = [s for s in stack if s["level"] < h["level"]] + [h]
    return stack


def prompt_for(card: dict, stack: list[dict]) -> str:
    bits = [TYPED_STEM, f"Element: {card['text']!r}", f"Font: {card.get('font_pt')}pt", f"Weight: {card.get('weight')}",
            f"Previous: {card.get('prev')}", f"Next: {card.get('next')}",
            f"Repeats on pages: {card.get('repeats_on_pages', 1)}", f"Inside a table: {bool(card.get('in_table_box'))}",
            "Approved headings so far: " + (" > ".join(f"H{s['level']} {s['text']!r}" for s in stack) or "none"), "JSON:"]
    return "\n".join(bits)


def target_for(row: dict) -> str:
    t = row["type"]
    if t == "H":
        return json.dumps({"type": "H", "level": row["label"]["level"], "rule": 1}, separators=(",", ":"))
    return json.dumps({"type": t, "rule": RULE_OF[t]}, separators=(",", ":"))


def emit(rows: list[dict], cards_by_id: dict[str, dict], key_headings: dict[str, list[dict]], image_of, split_ids: set[str],
         sources: list[dict] | None = None) -> tuple[list[dict], dict]:
    """``sources``, when a list, receives one ``{id, label_source, type}`` per emitted row, index-aligned with the output."""
    out, held = [], defaultdict(int)
    for r in rows:
        if r["id"] not in split_ids:
            continue
        card = cards_by_id.get(r["id"])
        if card is None:
            held["no_card"] += 1; continue
        if r["type"] not in VOCAB:
            held["other"] += 1; continue
        if decide(card) is not None:
            held["rule_decided"] += 1; continue
        img = image_of(card)
        if img is None:
            held["no_image"] += 1; continue
        stack = stack_before(card, key_headings.get(r["document_id"], []), r.get("key_locator"))
        out.append({"messages": [{"role": "user", "content": prompt_for(card, stack)}, {"role": "assistant", "content": target_for(r)}], "image": str(img)})
        if sources is not None:
            sources.append({"id": r["id"], "label_source": r.get("label_source"), "type": r["type"]})
    return out, dict(held)


def cap_planted_headings(sft: list[dict], sources: list[dict], max_share: float) -> tuple[list[dict], list[dict], dict]:
    """Drop planted H rows until they are at most ``max_share`` of the emitted H rows (ruling P9).

    Rows to drop are taken in sha256(id) order, so the cut is deterministic and
    independent of emit order; every other row keeps its place. Raises when the
    cap cannot be met: a share outside [0, 1), or planted H rows with no other
    H rows to stand beside.
    """
    if len(sft) != len(sources):
        raise ValueError(f"{len(sft)} rows but {len(sources)} sources")
    share = Fraction(str(max_share))
    if not 0 <= share < 1:
        raise ValueError(f"--max-planted-heading-share must be in [0, 1), got {max_share}")
    planted = [i for i, s in enumerate(sources) if s["type"] == "H" and s["label_source"] == "planted"]
    total_h = sum(1 for s in sources if s["type"] == "H")
    other_h = total_h - len(planted)
    if planted and other_h == 0 and share > 0:
        raise ValueError(f"cannot cap planted headings: {len(planted)} planted H rows and no other H rows")
    keep = len(planted)
    while keep and Fraction(keep, other_h + keep) > share:
        keep -= 1
    drop = set(sorted(planted, key=lambda i: hashlib.sha256(sources[i]["id"].encode()).hexdigest())[:len(planted) - keep])
    stats = {"max_share": max_share, "planted_h": len(planted), "total_h": total_h, "dropped": len(drop),
             "planted_h_after": keep, "total_h_after": other_h + keep}
    kept = [i for i in range(len(sft)) if i not in drop]
    return [sft[i] for i in kept], [sources[i] for i in kept], stats
