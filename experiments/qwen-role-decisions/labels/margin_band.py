"""Is a card in its page's top or bottom margin band? The "same place" of definition §4 rule 2.

A running head or footer repeats in the margin; a heading that repeats mid-page
(a per-section title, a form field) is content. The band is measured against
the page's content extent — min y0 and max y1 over every block of that page
in a Cards dump — not the media box, so a page's own margins do not count.
y is top-origin, as in cards.
"""
from __future__ import annotations

# A ceiling taken from the definition's "in the same place" (the top or bottom
# eighth of the content), not tuned against any label or prediction.
SHARE = 0.12


def page_extents(blocks: list[dict]) -> dict[int, tuple[float, float]]:
    ext: dict[int, tuple[float, float]] = {}
    for b in blocks:
        if b.get("page") is None or b.get("y0") is None or b.get("y1") is None:
            continue
        page, y0, y1 = int(b["page"]), float(b["y0"]), float(b["y1"])
        lo, hi = ext.get(page, (y0, y1))
        ext[page] = (min(lo, y0), max(hi, y1))
    return ext


def in_margin_band(card: dict, extents: dict[int, tuple[float, float]], share: float = SHARE) -> bool:
    if card.get("page") is None or card.get("y0") is None or card.get("y1") is None:
        return False
    span = extents.get(int(card["page"]))
    if span is None:
        return False
    lo, hi = span
    band = share * (hi - lo)
    return float(card["y0"]) <= lo + band or float(card["y1"]) >= hi - band
