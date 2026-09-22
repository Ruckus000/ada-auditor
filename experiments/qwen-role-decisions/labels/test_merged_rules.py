"""Strategy D rule-only detector (labels.merged_rules)."""
import json
import tempfile
from pathlib import Path

from labels.merged_rules import FALSE_TRIGGER_MAX, fire, predicates, report


def _row(kind, first_line, runs=None):
    return {"id": "d:1", "kind": kind, "first_line": first_line, "first_line_runs": runs or []}


def test_predicates_on_a_numbered_short_heading():
    p = predicates(_row("positive", "3. Definitions"))
    assert p == {"D1_short": True, "D2_no_closing_punct": True,
                 "D3_style_boundary": False, "D4_numbering": True}
    assert fire(_row("positive", "3. Definitions")) is True


def test_long_or_punctuated_first_lines_do_not_fire():
    assert fire(_row("negative", "The quick brown fox jumps over the lazy dog")) is False  # D1
    assert fire(_row("negative", "1. Scope.")) is False                                    # D2
    assert fire(_row("negative", "")) is False


def test_style_boundary_alone_can_fire():
    runs = [{"text": "Definitions", "font_pt": 14, "bold": True},
            {"text": " the rest", "font_pt": 12, "bold": False}]
    p = predicates(_row("positive", "Definitions the rest", runs))
    assert p["D3_style_boundary"] is True and p["D4_numbering"] is False
    assert fire(_row("positive", "Definitions the rest", runs)) is True


def test_report_counts_marginals_and_the_cap():
    rows = [
        _row("positive", "3. Definitions"),                 # fires
        _row("positive", "A very long heading that keeps going"),  # D1 fails
        _row("negative", "1. First item."),                 # D2 fails
        _row("negative", "2. Second item"),                 # fires (D4)
        _row("negative", "body text that is long enough to pass nothing"),  # no
    ]
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "dev.json"
        path.write_text(json.dumps({"sha256": "x", "rows": rows}))
        rep = report(path)
    assert rep["totals"] == {"positive": 2, "negative": 3}
    assert rep["fired"] == {"positive": 1, "negative": 1}
    assert rep["marginals"]["D4_numbering"] == {"positive": 1, "negative": 2}
    assert abs(rep["negative_fire_share"] - 1 / 3) < 1e-9
    assert rep["cap_met"] == (1 / 3 <= FALSE_TRIGGER_MAX) is False
    assert abs(rep["recall"] - 0.5) < 1e-9
