#!/usr/bin/env python3
"""Falsify source-PDF tags as a safe hierarchy-context representation.

This diagnostic intentionally uses only each card's ``existing_tag`` and its
document order to construct its *source* heading stack. Ground truth is used
only afterwards to score that representation. It does not generate headings,
change a PDF, or supply ground truth to a prospective model input.

Run against the frozen development validation cards:

    python3 -B experiments/qwen-role-decisions/part28_hierarchy_context.py
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_CASES = ROOT / "role-expanded" / "role-expanded-valid.json"


def heading_level(tag: object) -> int | None:
    """Return a valid H1--H6 level, never interpreting non-heading tags."""
    if not isinstance(tag, str) or len(tag) != 2 or tag[0] != "H" or tag[1] not in "123456":
        return None
    return int(tag[1])


def next_stack(stack: list[dict[str, Any]], card: dict[str, Any], tag: object) -> list[dict[str, Any]]:
    """Apply a heading tag to a stack; paragraphs leave it unchanged."""
    level = heading_level(tag)
    if level is None:
        return stack.copy()
    return [entry for entry in stack if entry["level"] < level] + [
        {"id": card["id"], "level": level, "text": card["text"]}
    ]


def stack_ids(stack: list[dict[str, Any]]) -> list[str]:
    return [entry["id"] for entry in stack]


def diagnose(cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Score the source-tag stack against truth without leaking truth into it."""
    by_document: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for card in cases:
        if not isinstance(card.get("id"), str) or not isinstance(card.get("document"), str):
            raise ValueError(f"card is missing id/document: {card!r}")
        if not isinstance(card.get("text"), str):
            raise ValueError(f"card is missing text: {card!r}")
        expected = card.get("expect")
        if not isinstance(expected, dict) or heading_level(expected.get("role")) is None and expected.get("role") != "P":
            raise ValueError(f"card has invalid expected role: {card!r}")
        by_document[card["document"]].append(card)

    heading_cards = 0
    source_level_exact = 0
    prior_stack_exact = 0
    full_stack_exact = 0
    mismatches: list[dict[str, Any]] = []
    per_document: dict[str, dict[str, int]] = {}

    for document, document_cases in by_document.items():
        source_stack: list[dict[str, Any]] = []
        truth_stack: list[dict[str, Any]] = []
        document_heading_cards = 0
        document_prior_exact = 0
        document_full_exact = 0

        for card in document_cases:
            expected_role = card["expect"]["role"]
            expected_level = heading_level(expected_role)
            source_before = source_stack.copy()
            truth_before = truth_stack.copy()
            source_stack = next_stack(source_stack, card, card.get("existing_tag"))
            truth_stack = next_stack(truth_stack, card, expected_role)

            if expected_level is None:
                continue
            heading_cards += 1
            document_heading_cards += 1
            source_level_exact += heading_level(card.get("existing_tag")) == expected_level
            prior_equal = stack_ids(source_before) == stack_ids(truth_before)
            full_equal = stack_ids(source_stack) == stack_ids(truth_stack)
            prior_stack_exact += prior_equal
            full_stack_exact += full_equal
            document_prior_exact += prior_equal
            document_full_exact += full_equal
            if not prior_equal or not full_equal or heading_level(card.get("existing_tag")) != expected_level:
                mismatches.append(
                    {
                        "id": card["id"],
                        "document": document,
                        "text": card["text"],
                        "expected_role": expected_role,
                        "existing_tag": card.get("existing_tag"),
                        "source_prior_stack": stack_ids(source_before),
                        "truth_prior_stack": stack_ids(truth_before),
                        "source_full_stack": stack_ids(source_stack),
                        "truth_full_stack": stack_ids(truth_stack),
                    }
                )

        per_document[document] = {
            "heading_cards": document_heading_cards,
            "prior_stack_exact": document_prior_exact,
            "full_stack_exact": document_full_exact,
        }

    if not heading_cards:
        raise ValueError("no expected headings to diagnose")
    return {
        "contract": "source_tags_are_not_hierarchy_context",
        "heading_cards": heading_cards,
        "source_level_exact": source_level_exact,
        "prior_stack_exact": prior_stack_exact,
        "full_stack_exact": full_stack_exact,
        "per_document": per_document,
        "mismatches": mismatches,
    }


def self_check() -> None:
    corrupt_cards = [
        {"id": "d:0", "document": "d", "text": "Title", "existing_tag": "H1", "expect": {"role": "H1"}},
        {"id": "d:1", "document": "d", "text": "Callout", "existing_tag": "H2", "expect": {"role": "P"}},
        {"id": "d:2", "document": "d", "text": "Section", "existing_tag": "H3", "expect": {"role": "H2"}},
    ]
    result = diagnose(corrupt_cards)
    if (result["heading_cards"], result["source_level_exact"], result["prior_stack_exact"], result["full_stack_exact"]) != (2, 1, 1, 1):
        raise AssertionError(result)
    if result["mismatches"][-1]["source_prior_stack"] != ["d:0", "d:1"]:
        raise AssertionError(result["mismatches"])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--self-check", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.self_check:
        self_check()
        print("part28_hierarchy_context_self_check_ok")
        return
    payload = json.loads(args.cases.read_text())
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise SystemExit(f"{args.cases} does not contain a cases list")
    print(json.dumps(diagnose(cases), indent=2))


if __name__ == "__main__":
    main()
