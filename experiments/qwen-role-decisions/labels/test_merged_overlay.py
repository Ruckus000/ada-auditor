"""Tests for labels/merged_overlay.py and labels/operating_point.py."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from labels.merged_overlay import LABEL_SOURCE, overlay, overlay_row
from labels.operating_point import guard, operating_point


def _row(i, type_="P", level=None, source="stripped-tree"):
    return {"id": f"d:{i}", "document_id": "d", "label_source": source, "actor": f"key:{source}",
            "type": type_, "label": {"heading": type_ == "H", "level": level}, "answer_id": f"u-{i}"}


def _write_keys(tmp: Path, rows):
    keys = tmp / "keys"
    keys.mkdir()
    (keys / "labels.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (keys / "cards.jsonl").write_text('{"card_id": "d:1"}\n')
    (keys / "key-headings.json").write_text('{"d": []}\n')
    return keys


def test_overlay_relabels_only_listed_non_h_rows():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        keys = _write_keys(tmp, [_row(1), _row(2, "H", 1), _row(3, "Other")])
        pos = tmp / "pos.json"
        pos.write_text(json.dumps([
            {"id": "d:1", "document_id": "d", "key_locator": "d:9", "key_level": 2,
             "label_type": "P", "label_source": "stripped-tree"},
            {"id": "d:2", "document_id": "d", "key_locator": "d:2", "key_level": 1,
             "label_type": "H", "label_source": "stripped-tree"},
            {"id": "d:7", "document_id": "d", "key_locator": "d:9", "key_level": 2,
             "label_type": None, "label_source": None},
        ]))
        report = overlay(keys, pos, tmp / "out")
        assert report["relabelled"] == 1 and report["already_h"] == 1 and report["no_label_row"] == 1
        rows = [json.loads(l) for l in (tmp / "out" / "labels.jsonl").read_text().splitlines()]
        assert rows[0]["type"] == "H" and rows[0]["label"] == {"heading": True, "level": 2}
        assert rows[0]["label_source"] == LABEL_SOURCE
        assert rows[0]["superseded"]["type"] == "P"
        assert rows[1]["type"] == "H" and "superseded" not in rows[1]  # already H: untouched
        assert rows[2]["type"] == "Other"  # not listed: untouched
        assert (tmp / "out" / "cards.jsonl").read_bytes() == (keys / "cards.jsonl").read_bytes()


def test_overlay_refuses_a_type_mismatch():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        keys = _write_keys(tmp, [_row(1)])
        pos = tmp / "pos.json"
        pos.write_text(json.dumps([{"id": "d:1", "document_id": "d", "key_locator": "d:9", "key_level": 2,
                                    "label_type": "Other", "label_source": "stripped-tree"}]))
        try:
            overlay(keys, pos, tmp / "out")
        except SystemExit as err:
            assert "d:1" in str(err)
        else:
            raise AssertionError("a stale list must be refused")


def test_overlay_row_shape():
    got = overlay_row(_row(1), {"id": "d:1", "key_locator": "d:9", "key_level": 3})
    assert got["actor"] == "key:merged-first-line"
    assert got["answer_id"] == "key:merged-first-line:d:1"
    assert got["key_locator"] == "d:9"
    assert got["superseded"]["label"] == {"heading": False, "level": None}


def _labels_and_preds():
    # 400 rows, half headings, every prediction right: the exact 95 % bounds then meet
    # the r11 rule (accuracy LB >= 0.98 needs n well past 40; FP UB <= 0.02 needs
    # ~180+ negatives), so threshold_rule must return the lowest score on the file.
    labels, preds = [], []
    for i in range(400):
        heading = i % 2 == 0
        labels.append({"id": f"d:{i}", "document_id": "d", "label": {"heading": heading, "level": 1 if heading else None}})
        preds.append({"id": f"d:{i}", "raw": json.dumps({"type": "H" if heading else "P", "rule": 1}),
                      "decided_by": "model", "score": 0.9999 - i * 0.000001, "p_H": None})
    return labels, preds


def test_operating_point_finds_a_threshold_and_guard_compares():
    labels, preds = _labels_and_preds()
    got = operating_point("rX", labels, preds)
    point = got["point"]
    assert point["threshold"] == preds[-1]["score"]  # no errors: the lowest score qualifies
    assert point["covered"] == 400 and point["counts"]["fp"] == 0 and point["counts"]["fn"] == 0
    assert len(got["curve"]) == 400
    ref = {"accuracy_ci": [0.0, 1.0], "fp_ci": [0.0, 1.0]}
    assert guard(point, ref)["guard_passed"] is True
    hard = {"accuracy_ci": [0.99999, 1.0], "fp_ci": [0.0, 0.00001]}
    assert guard(point, hard)["guard_passed"] is False


def _block_card(cid):
    from labels.merged_probe import KEYS_CARD_FIELDS
    return {k: (cid if k in ("card_id", "id", "locator") else "d" if k == "document_id"
                else "some text" if k in ("text", "next", "prev", "norm", "kind", "weight", "existing_tag")
                else 1 if k in ("page", "font_pt", "repeats_on_pages")
                else 1.0 if k in ("x0", "x1", "y0", "y1")
                else False if k in ("in_margin_band", "in_table_box")
                else [] if k == "ancestors" else None)
            for k in KEYS_CARD_FIELDS}


def _write_split(tmp: Path):
    split = tmp / "split.json"
    split.write_text(json.dumps({"ids": {"train": ["d:1"], "validation": ["d:2"]}}))
    return split


def test_overlay_append_mode_adds_rows_cards_and_split_ids():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        keys = _write_keys(tmp, [_row(1)])
        bc = tmp / "block-cards.jsonl"
        bc.write_text(json.dumps(_block_card("d:7")) + "\n")
        pos = tmp / "pos.json"
        pos.write_text(json.dumps([
            {"id": "d:1", "document_id": "d", "key_locator": "d:9", "key_level": 2,
             "label_type": "P", "label_source": "stripped-tree"},
            {"id": "d:7", "document_id": "d", "key_locator": "d:9", "key_level": 3,
             "label_type": None, "label_source": None},
        ]))
        report = overlay(keys, pos, tmp / "out", bc, _write_split(tmp))
        assert report["relabelled"] == 1 and report["appended"] == 1 and report["added_to_split_train"] == 1
        rows = [json.loads(l) for l in (tmp / "out" / "labels.jsonl").read_text().splitlines()]
        assert len(rows) == 2
        new = rows[1]
        assert new["id"] == "d:7" and new["type"] == "H" and new["label"] == {"heading": True, "level": 3}
        assert new["label_source"] == LABEL_SOURCE and new["match"] == "merged-first-line"
        cards = [json.loads(l) for l in (tmp / "out" / "cards.jsonl").read_text().splitlines()]
        assert [c["card_id"] for c in cards] == ["d:1", "d:7"]
        split = json.loads((tmp / "out" / "split.json").read_text())
        assert split["ids"]["train"] == ["d:1", "d:7"] and split["ids"]["validation"] == ["d:2"]
        assert (tmp / "out" / "key-headings.json").read_bytes() == (keys / "key-headings.json").read_bytes()


def test_overlay_append_refuses_a_missing_block_card():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        keys = _write_keys(tmp, [_row(1)])
        bc = tmp / "block-cards.jsonl"
        bc.write_text("")
        pos = tmp / "pos.json"
        pos.write_text(json.dumps([{"id": "d:7", "document_id": "d", "key_locator": "d:9", "key_level": 3,
                                    "label_type": None, "label_source": None}]))
        try:
            overlay(keys, pos, tmp / "out", bc, _write_split(tmp))
        except SystemExit as err:
            assert "d:7" in str(err)
        else:
            raise AssertionError("a positive with no row and no card must be refused")


def test_overlay_append_needs_block_cards_and_split_together():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        keys = _write_keys(tmp, [_row(1)])
        pos = tmp / "pos.json"
        pos.write_text("[]")
        try:
            overlay(keys, pos, tmp / "out", None, _write_split(tmp))
        except SystemExit:
            pass
        else:
            raise AssertionError("--split without --block-cards must be refused")
