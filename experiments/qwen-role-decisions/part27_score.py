#!/usr/bin/env python3
"""Part 27: direct semantic eligibility scoring. No mutation, no existing tag."""

from __future__ import annotations

from typing import Iterable

HEADING = {"H1", "H2", "H3", "H4", "H5", "H6"}


def gt_heading(expect_role: str | None) -> bool:
    return expect_role in HEADING


def classify(expect_role: str | None, heading: bool | None) -> str:
    """Map one card to TP / FN / TN / FP / parse_fail. No mutation action."""
    if heading is not True and heading is not False:
        return "parse_fail"
    if gt_heading(expect_role):
        return "TP" if heading is True else "FN"
    return "TN" if heading is False else "FP"


def summarize(rows: Iterable[tuple[str | None, bool | None]]) -> dict[str, int]:
    counts = {"parse_fail": 0, "TP": 0, "FN": 0, "TN": 0, "FP": 0}
    n = 0
    for expect_role, heading in rows:
        n += 1
        counts[classify(expect_role, heading)] += 1
    counts["n"] = n
    counts["parsed"] = n - counts["parse_fail"]
    return counts


def perfect_pass(counts: dict[str, int]) -> bool:
    """Hard gate: every row parses, and neither error class is present."""
    return (
        counts.get("n", 0) > 0
        and counts.get("parse_fail", 0) == 0
        and counts.get("FN", 0) == 0
        and counts.get("FP", 0) == 0
    )


def main() -> None:
    fixture = [
        ("H4", True),
        ("H4", False),
        ("P", False),
        ("P", True),
    ]
    counts = summarize(fixture)
    assert counts == {
        "parse_fail": 0,
        "TP": 1,
        "FN": 1,
        "TN": 1,
        "FP": 1,
        "n": 4,
        "parsed": 4,
    }
    assert perfect_pass(counts) is False
    assert perfect_pass(summarize([("H4", True), ("P", False)])) is True
    assert perfect_pass(summarize([("H4", False), ("P", False)])) is False
    assert perfect_pass(summarize([("H4", True), ("P", True)])) is False
    print("part27_score_ok", counts)


if __name__ == "__main__":
    main()
