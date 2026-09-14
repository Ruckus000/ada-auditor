"""Score a candidate block from the stripped copy against the original tree."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

CONTAIN_IOU = 0.3
BOX_IOU = 0.5
BOX_INSIDE = 0.9
TIE_RANK = {"TH": 0, "Caption": 0, "TOCI": 0, "Lbl": 0, "BlockQuote": 0, "H": 1, "P": 2, "Other": 3}
UNKNOWN_RANK = 3
TIE_IOU = 0.05


def intersection(a: dict, b: dict) -> float:
    if any(a.get(k) is None or b.get(k) is None for k in ("x0", "y0", "x1", "y1")):
        return 0.0
    w = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
    h = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"])
    return max(w, 0) * max(h, 0)


def inside_share(card: dict, key: dict) -> float:
    """Share of the card's area the key covers."""
    area = intersection(card, card)
    return intersection(card, key) / area if area > 0 else 0.0


def iou(a: dict, b: dict) -> float:
    if any(a.get(k) is None or b.get(k) is None for k in ("x0", "y0", "x1", "y1")):
        return 0.0
    inter = intersection(a, b)
    union = (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]) + (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]) - inter
    return inter / union if union > 0 else 0.0


def preferred(card: dict, qualifying: list[dict]) -> dict:
    """K25: the definition's §4 order governs a tie (rule-3 types, then H, then P, then Other), then IoU.
    K27: only keys within TIE_IOU of the best qualifying IoU tie; any further below are out."""
    best = max(iou(card, k) for k in qualifying)
    qualifying = [k for k in qualifying if iou(card, k) >= best - TIE_IOU]
    return min(qualifying, key=lambda k: (TIE_RANK.get(k.get("type"), UNKNOWN_RANK), -iou(card, k)))


def match_candidate(card: dict, keys_on_page: list[dict]) -> tuple[dict | None, str]:
    n = card.get("norm") or ""
    if n:
        exact = [k for k in keys_on_page if k.get("norm") == n]
        if exact:
            return preferred(card, exact), "exact"
        contains = [k for k in keys_on_page if k.get("norm") and n in k["norm"] and iou(card, k) >= CONTAIN_IOU]
        if contains:
            return preferred(card, contains), "contains"
    best = max((iou(card, k) for k in keys_on_page), default=0.0)
    boxed = [k for k in keys_on_page if iou(card, k) == best and best >= BOX_IOU and inside_share(card, k) >= BOX_INSIDE]
    if boxed:
        return preferred(card, boxed), "box"
    return None, "none"


def label_for(card: dict, key: dict | None, how: str) -> tuple[str, int | None]:
    if how == "none" or key is None:
        raise ValueError("an unmatched card is not a label (K14)")
    return key["type"], key.get("level")


def make_key_row(card: dict, doc: dict, key: dict | None, how: str, source: str) -> dict:
    type_, level = label_for(card, key, how)
    return {
        "id": card["card_id"],
        "label_source": source,
        "answer_id": str(uuid.uuid4()),
        "actor": f"key:{source}",
        "client_id": doc["host"],
        "template_id": doc["host"],
        "document_sha256": doc["sha256"],
        "document_stem": doc["id"],
        "document_id": doc["id"],
        "card_id": card["card_id"],
        "kind": card.get("kind"),
        "type": type_,
        "match": how,
        "key_locator": None if key is None else key.get("locator"),
        "label": {"heading": type_ == "H", "level": level if type_ == "H" else None},
        "text_sha256": hashlib.sha256((card.get("text") or "").encode()).hexdigest(),
        "why": card.get("why"),
        "repeats_on_pages": card.get("repeats_on_pages"),
        "in_table_box": card.get("in_table_box"),
        "font_pt": card.get("font_pt"),
        "weight": card.get("weight"),
        "page": card.get("page"),
        "existing_tag": card.get("existing_tag"),
        "labelled_at": datetime.now(timezone.utc).isoformat(),
    }
