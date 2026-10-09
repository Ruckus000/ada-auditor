"""Pure parts of the CPU second-opinion probe: card features and the vetoed gate read.

Registered in docs/research/document-remediation/heading-cpu-probes-2026-10-09-registration.md.
No I/O here, so the tests need no data.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

# Copied verbatim from out/r15/tools/runin_probe3.py (which is not importable from here).
KW = re.compile(r"^(section|article|chapter|part|item)\s+([ivxlcdm]+|\d+(?:\.\d+)*|[a-z])\b[.):]?\s*", re.I)
ROMAN = re.compile(r"^([ivxlcdm]{2,}|i)[.)]\s+", re.I)
ARABIC = re.compile(r"^(\d{1,3}(?:\.\d+)+\.?|\d{1,3}[.)])\s+")
LETTER = re.compile(r"^[a-z][.)]\s+", re.I)

CATEGORICAL = ("weight", "existing_tag", "margin_band", "enum", "prev_enum", "next_enum")


def enum_class(text: str) -> str:
    """Which enumerator a line opens with, if any; mirrors out/r15/tools/runin_probe3.enum."""
    t = " ".join((text or "").split())
    for name, rx in (("kw", KW), ("roman", ROMAN), ("arabic", ARABIC), ("letter", LETTER)):
        if rx.match(t):
            return name
    return "none"


def text_shape(text: str | None, prefix: str = "") -> dict:
    t = " ".join((text or "").split())
    letters = [ch for ch in t if ch.isalpha()]
    return {
        f"{prefix}len": len(t),
        f"{prefix}words": len(t.split()),
        f"{prefix}caps": sum(ch.isupper() for ch in letters) / len(letters) if letters else 0.0,
        f"{prefix}digits": sum(ch.isdigit() for ch in t) / len(t) if t else 0.0,
        f"{prefix}enum": enum_class(t),
        f"{prefix}colon": t.endswith(":"),
        f"{prefix}period": t.endswith("."),
    }


def host_of(url: str) -> str:
    h = urlparse(url).hostname or ""
    return h[4:] if h.startswith("www.") else h


def rank(values: list[float], v: float) -> float:
    """Share of ``values`` strictly below ``v``: 0 for the smallest, near 1 for the largest."""
    return sum(x < v for x in values) / len(values) if values else 0.0


def features(card: dict, doc_fonts: list[float], page_y: list[float], page_x: list[float]) -> dict:
    """One card's features. ``doc_fonts`` are every card's font in its document, ``page_y``/``page_x``
    every card's y0/x0 on its page. No image, no model output, nothing derived from a label."""
    anc = card.get("ancestors") or []
    font, body = card.get("font_pt"), card.get("body_font_pt")
    prev, nxt = card.get("prev"), card.get("next")
    f = {
        "font_pt": font,
        "body_font_pt": body,
        "font_ratio": font / body if font and body else None,
        "font_rank_doc": rank(doc_fonts, font) if font is not None else None,
        "weight": card.get("weight") or "unknown",
        "existing_tag": card.get("existing_tag") or "none",
        "anc_L": "L" in anc,
        "anc_LI": "LI" in anc,
        "anc_Table": "Table" in anc,
        "anc_cell": "TD" in anc or "TR" in anc or "TH" in anc,
        "anc_depth": len(anc),
        "in_table_box": bool(card.get("in_table_box")),
        "repeats_on_pages": card.get("repeats_on_pages") or 1,
        "margin_band": card.get("margin_band") or "none",
        "after_inline_label": bool(card.get("after_inline_label")),
        "width": card["x1"] - card["x0"],
        "height": card["y1"] - card["y0"],
        "y_rank_page": rank(page_y, card["y0"]),
        "x_rank_page": rank(page_x, card["x0"]),
    }
    f.update(text_shape(card.get("text")))
    f.update(text_shape(None if prev == "none" else prev, "prev_"))
    f.update(text_shape(None if nxt == "none" else nxt, "next_"))
    return f


def vetoed_read(decided: list[dict], c: float, cards_total: int, e_max_share: float = 0.0035) -> dict:
    """The registered read at veto confidence ``c``.

    ``decided`` rows: ``said_h`` (the combination's heading bit), ``truth`` (label heading bit),
    ``p_h`` (second opinion's out-of-fold P(H)), ``by`` ("model" or "rule"), ``doc``.
    A card is vetoed when the second opinion disagrees with confidence >= c.
    """
    def veto(r):
        return r["p_h"] <= 1 - c if r["said_h"] else r["p_h"] >= c

    def kind(r):
        return "FP" if r["said_h"] else f"{r['by']}-FN"

    errors = [r for r in decided if r["said_h"] != r["truth"]]
    kept = [r for r in decided if not veto(r)]
    kept_errors = [r for r in kept if r["said_h"] != r["truth"]]
    caught = [r for r in errors if veto(r)]
    n = len(kept)
    return {
        "c": c,
        "caught": len(caught),
        "caught_by_kind": {k: sum(kind(r) == k for r in caught) for k in ("model-FN", "rule-FN", "FP")},
        "correct_lost": len(decided) - len(errors) - (n - len(kept_errors)),
        "decided": n,
        "errors": len(kept_errors),
        "bar_errors": int(e_max_share * n),
        "coverage": n / cards_total if cards_total else 0.0,
        "fp": sum(r["said_h"] for r in kept_errors),
        "negatives": sum(not r["truth"] for r in kept),
        "documents_with_error": len({r["doc"] for r in kept_errors}),
    }
