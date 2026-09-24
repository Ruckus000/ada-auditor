"""Deterministic rules in front of the model, from the frozen definition.

The model decides only what these cannot. Each rule returns the type and the
definition rule number, or None. Order matters and is the definition's §7.
"""
from __future__ import annotations

import re

MIN_REPEATS = 3  # same text, same band, on three or more pages: pagination, not content
# Guard 2 (docs/superpowers/plans/2026-09-24-rule-fixes-registration.md): a no-letters
# card whose own crop OCRs to a word at this confidence has a text layer that
# contradicts its page (a broken encoding, a typewritten scan).
OCR_WORD_CONF = 80.0

# §4 rule 3: a more specific ISO type wins over H. Three shapes, registered in
# the round 8 record before implementation, each written to the letter of that
# registration and no wider.
#
# Dot leaders then a page number: ">= 3 dots, optionally separated by spaces,
# optional whitespace, then 1-4 digits at end of text". Only the ASCII full stop
# counts as a dot, so an ellipsis ("Introduction … 12") is not a leader.
TOCI_TAIL = re.compile(r"\.(?:[ \t]*\.){2,}\s*\d{1,4}$")
# "Table|Figure|Chart|Exhibit", whitespace, a number with an optional single
# letter suffix, then one of : . - en-dash em-dash. Case as written. The
# whitespace before that punctuation is optional because the standard
# typographic form spaces the dash ("Figure 2 — Site plan"); nothing else in the
# pattern is loosened.
CAPTION_HEAD = re.compile(r"^(?:Table|Figure|Chart|Exhibit)\s+\d+[A-Za-z]?\s*[:.\-–—]")
# Rule R5 (enumerator-only = Lbl), registered 2026-09-18 on validation
# (heading-stage2-2026-09-18-results.md): a card whose whole text is a bare
# enumerator -- split_heads' enumerator pattern with no words after the dot.
ENUMERATOR_ONLY = re.compile(r"^(?:[IVX]+|[A-Z]|\d+)\.$")
# Rule R5b, registered 2026-09-23 as a secondary view only
# (docs/superpowers/plans/2026-09-23-r13-confirmation-batch-registration.md):
# R5's enumerator plus an optional opening quote mark ("F. “", "G. '"). It comes
# from r13's wild errors c3-0722:55 and :57, so it is post-hoc and never joins
# decide's default chain; labels.r5_rescore applies it as an opt-in second view.
ENUMERATOR_QUOTE_ONLY = re.compile(r"^(?:[IVX]+|[A-Z]|\d+)\.\s*[“\"‘']?$")


def r2_no_letters(card: dict) -> tuple[str, int] | None:
    text = (card.get("text") or "").strip()
    if text and not any(ch.isalpha() for ch in text):
        return "Lbl", 3
    return None


def artifact_by_repeat(card: dict) -> tuple[str, int] | None:
    # "In the same place": a repeat is pagination only in the page's top or
    # bottom margin band (labels/margin_band.py). A card without the fact is
    # refused, never guessed — a legacy cards file must be enriched first.
    if (card.get("repeats_on_pages") or 1) < MIN_REPEATS:
        return None
    if "in_margin_band" not in card:
        raise ValueError(f"{card.get('card_id') or card.get('id') or card.get('locator')}: repeats on {card['repeats_on_pages']} pages but has no in_margin_band fact")
    if not card["in_margin_band"]:
        return None
    # The band is measured from the top of the page's content, so a page's own
    # first-line title is always in it. A top-band repeat at body size or larger
    # can be a per-page title (each map of a series, each form of a packet), so
    # the rule abstains; without both size facts it decides as before.
    font, body = card.get("font_pt"), card.get("body_font_pt")
    if card.get("margin_band") == "top" and font is not None and body is not None and font >= body:
        return None
    return "Artifact", 2


def in_table(card: dict) -> tuple[str, int] | None:
    # Inside a table box the element cannot be a document heading (definition
    # §4 rule 3); which cell type it is stays with the model.
    return None


def toci_by_leaders(card: dict) -> tuple[str, int] | None:
    # A contents entry, not a heading: dot leaders carrying a page number.
    return ("TOCI", 3) if TOCI_TAIL.search((card.get("text") or "").strip()) else None


def caption_by_prefix(card: dict) -> tuple[str, int] | None:
    # "Table 3: ...", "Figure 2a — ...": a numbered caption, not a heading.
    return ("Caption", 3) if CAPTION_HEAD.match((card.get("text") or "").strip()) else None


def list_item_body(card: dict) -> tuple[str, int] | None:
    # A bullet or number sits on this card's line, to its left: the card is the
    # list item's text. The neighbour fact is computed once per document in
    # labels/inline_label.py and written onto the card; it is never recomputed
    # here, and a card without it is simply not decided by this rule.
    return ("Other", 3) if card.get("after_inline_label") is True else None


def enumerator_only(card: dict) -> tuple[str, int] | None:
    # R5: "A.", "IV.", "3." alone on the card is a list marker, never a heading.
    return ("Lbl", 5) if ENUMERATOR_ONLY.match((card.get("text") or "").strip()) else None


def enumerator_quote_only(card: dict) -> tuple[str, int] | None:
    # R5b: an enumerator followed by at most an opening quote is still a list
    # marker. Opt-in only -- decide does not call this.
    return ("Lbl", 5) if ENUMERATOR_QUOTE_ONLY.match((card.get("text") or "").strip()) else None


def text_layer_contradicted(card: dict) -> bool:
    # The text layer can lie ("NORTH" extracts as "552,579"). When OCR of the card's
    # own crop reads a word, no rule reading that text (or facts derived from it) is
    # certain, so none decides and the model, which sees the image, does.
    return (card.get("ocr_word_conf") or 0.0) >= OCR_WORD_CONF


def decide(card: dict) -> tuple[str, int] | None:
    if text_layer_contradicted(card):
        return None
    for rule in (r2_no_letters, artifact_by_repeat, toci_by_leaders, caption_by_prefix, list_item_body, enumerator_only):
        hit = rule(card)
        if hit:
            return hit
    return None


def forbids_heading(card: dict) -> bool:
    # Tree ancestry, not the geometric table box: the box also covers true
    # headings laid out in a grid. in_table_box stays a prompt fact.
    return "Table" in (card.get("ancestors") or [])
