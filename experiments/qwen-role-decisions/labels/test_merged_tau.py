"""Tests for labels/merged_tau.py — the registered tau rules for strategies A and B."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from labels.merged_tau import tau_a, tau_b


def _rows(n_pos, n_neg):
    return ([{"id": f"d:p{i}", "kind": "positive"} for i in range(n_pos)]
            + [{"id": f"d:n{i}", "kind": "negative"} for i in range(n_neg)])


def _scores(pos, neg):
    out = {f"d:p{i}mh": p for i, p in enumerate(pos)}
    out.update({f"d:n{i}mh": p for i, p in enumerate(neg)})
    return out


def test_tau_a_is_the_smallest_score_inside_the_cap():
    rows = _rows(2, 100)
    # two negatives at 0.7 and 0.9 -> at most 2%: tau can sit at 0.7 (2 triggers),
    # the smallest qualifying candidate among all rows' scores.
    p_h = _scores([0.8, 0.95], [0.9, 0.7] + [0.001] * 98)
    got = tau_a(rows, p_h)
    assert got["tau_A"] == 0.7
    assert got["false_triggers"] == 2 and abs(got["false_trigger_rate"] - 0.02) < 1e-12
    assert got["recovered"] == 2 and got["dev_recall"] == 1.0 and got["wild_look"] is True


def test_tau_a_takes_the_lowest_candidate_when_nothing_fires():
    rows = _rows(3, 50)
    p_h = _scores([0.4, 0.6, 0.9], [0.001] * 50)
    got = tau_a(rows, p_h)
    # at 0.001 every negative triggers (100% > 2%); 0.4 is the smallest candidate inside the cap
    assert got["tau_A"] == 0.4
    assert got["dev_recall"] == 1.0


def test_tau_a_none_when_the_cap_cannot_be_met():
    rows = _rows(1, 10)  # cap 2% of 10 = 0.2 -> a single trigger breaks it
    p_h = _scores([0.5], [0.9] + [0.001] * 9)
    got = tau_a(rows, p_h)
    assert got["tau_A"] is None and got["wild_look"] is False


def test_tau_a_ignores_rule_decided_rows():
    rows = _rows(1, 4)
    p_h = {"d:p0mh": 0.9, "d:n0mh": None, "d:n1mh": None, "d:n2mh": 0.001, "d:n3mh": 0.001}
    got = tau_a(rows, p_h)
    # n2/n3 trigger at 0.001 (2/4 > 2%); 0.9 keeps triggers at 0 — rule-decided rows never trigger
    assert got["false_triggers"] == 0 and got["tau_A"] == 0.9


def test_tau_b_is_the_smallest_score_at_precision_cap():
    rows = _rows(3, 3)
    p_h = _scores([0.95, 0.9, 0.2], [0.99, 0.3, 0.1])
    got = tau_b(rows, p_h)
    # at 0.9: fired = {p0, p1, n0} -> precision 2/3 < 0.9; at 0.95: {p0, n0} -> 1/2;
    # at 0.99: {n0} -> 0. No candidate reaches 0.9.
    assert got["tau_B"] is None
    p_h2 = _scores([0.95, 0.9, 0.2], [0.3, 0.1, 0.05])
    got2 = tau_b(rows, p_h2)
    assert got2["tau_B"] == 0.9 and got2["dev_precision"] == 1.0
    assert abs(got2["dev_recall"] - 2 / 3) < 1e-12


def test_report_shape(tmp_path=None):
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        rows = _rows(1, 2)
        (tmp / "dev.json").write_text(json.dumps({"sha256": "x", "rows": rows}))
        (tmp / "pred.jsonl").write_text(
            json.dumps({"id": "d:p0mh", "p_H": 0.9}) + "\n"
            + json.dumps({"id": "d:n0mh", "p_H": 0.001}) + "\n"
            + json.dumps({"id": "d:n1mh", "p_H": None}) + "\n")
        from labels.merged_tau import report
        got = report(tmp / "dev.json", tmp / "pred.jsonl")
        assert got["dev_set_sha256"] == "x" and got["A"]["dev_recall"] == 1.0
