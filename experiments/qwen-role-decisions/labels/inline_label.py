"""Does a card sit on the same line as, and to the right of, a bullet or number?

Definition §4 rule 3's list-item case: a card whose line begins with a block
holding no letters at all — a bullet glyph, a number, a lettered marker — is the
body of a list item, not a document heading. The neighbour is a fact about the
document's cards, so it is computed here once per document and written onto the
card (``after_inline_label``); ``labels/rules.py`` only reads it, exactly as it
reads ``in_margin_band``.

y is top-origin, as in cards. "Same line" is y0 within SAME_LINE_PT; "to the
left" is the neighbour's x1 at or before this card's x0.
"""
from __future__ import annotations

SAME_LINE_PT = 2.0


def _boxed(card: dict) -> bool:
    return all(card.get(k) is not None for k in ("page", "x0", "y0", "x1"))


def has_no_letters(text: str | None) -> bool:
    t = (text or "").strip()
    return bool(t) and not any(ch.isalpha() for ch in t)


def after_inline_label(cards: list[dict], tolerance: float = SAME_LINE_PT) -> dict[str, bool]:
    """One document's cards to ``card_id -> bool``. Pure; reads no file.

    True when some *other* card of the same page has ``y0`` within ``tolerance``,
    ``x1 <= this card's x0``, and text with no alphabetic character.
    """
    by_page: dict[int, list[dict]] = {}
    for c in cards:
        if _boxed(c) and has_no_letters(c.get("text")):
            by_page.setdefault(int(c["page"]), []).append(c)
    out: dict[str, bool] = {}
    for c in cards:
        key = c.get("card_id") or c.get("locator") or c.get("id")
        if not _boxed(c):
            out[key] = False
            continue
        y0, x0 = float(c["y0"]), float(c["x0"])
        out[key] = any(
            n is not c
            and abs(float(n["y0"]) - y0) <= tolerance
            and float(n["x1"]) <= x0
            for n in by_page.get(int(c["page"]), ())
        )
    return out
