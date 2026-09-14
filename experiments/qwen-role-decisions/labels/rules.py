"""Deterministic rules in front of the model, from the frozen definition.

The model decides only what these cannot. Each rule returns the type and the
definition rule number, or None. Order matters and is the definition's §7.
"""
from __future__ import annotations

MIN_REPEATS = 3  # same text, same band, on three or more pages: pagination, not content


def r2_no_letters(card: dict) -> tuple[str, int] | None:
    text = (card.get("text") or "").strip()
    if text and not any(ch.isalpha() for ch in text):
        return "Lbl", 3
    return None


def artifact_by_repeat(card: dict) -> tuple[str, int] | None:
    if (card.get("repeats_on_pages") or 1) >= MIN_REPEATS:
        return "Artifact", 2
    return None


def in_table(card: dict) -> tuple[str, int] | None:
    # Inside a table box the element cannot be a document heading (definition
    # §4 rule 3); which cell type it is stays with the model.
    return None


def decide(card: dict) -> tuple[str, int] | None:
    for rule in (r2_no_letters, artifact_by_repeat):
        hit = rule(card)
        if hit:
            return hit
    return None


def forbids_heading(card: dict) -> bool:
    return bool(card.get("in_table_box"))
