"""Tests for labels/cohort_overlay.py."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from labels.cohort_overlay import arm_of, ladder, overlay

SHA = "a" * 64


def _lab(i, type_="P", level=None, doc="c8-0001"):
    return {"id": f"{doc}:{i}", "document_id": doc, "type": type_, "label": {"heading": type_ == "H", "level": level},
            "actor": "seat1:x;seat2:y", "labelled_at": "2026-09-25T00:00:00+00:00", "label_source": "opus-fable-consensus+tb"}


def _card(i, page=0, y0=100.0, doc="c8-0001"):
    return {"card_id": f"{doc}:{i}", "id": f"{doc}:{i}", "document_id": doc, "page": page, "y0": y0, "x0": 10.0, "text": f"t{i}"}


def _setup(tmp: Path, labels, cards, base_ids=None, base_host="old.gov"):
    keys = tmp / "keys"
    keys.mkdir()
    base = {"id": "k:1", "card_id": "k:1", "document_id": "k", "client_id": base_host, "type": "P"}
    (keys / "labels.jsonl").write_text(json.dumps(base) + "\n")
    (keys / "cards.jsonl").write_text('{"card_id": "k:1"}\n')
    (keys / "key-headings.json").write_text('{"k": []}\n')
    split = tmp / "split.json"
    split.write_text(json.dumps({"ids": {"train": base_ids or ["k:1"], "validation": [], "test": []}}))
    sug = tmp / "suggest" / "c8-0001"
    sug.mkdir(parents=True)
    (sug / "cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in cards))
    lab = tmp / "labels.jsonl"
    lab.write_text("".join(json.dumps(r) + "\n" for r in labels))
    names = tmp / "names.txt"
    names.write_text("# header\nc8-0001.pdf\thttps://www.new.gov/DocumentCenter/View/300\n")
    pdfs = tmp / "real"
    pdfs.mkdir()
    (pdfs / "c8-0001.pdf").write_bytes(b"%PDF-1.4 x")
    return keys, split, lab, tmp / "suggest", names, pdfs


def test_appends_rows_cards_ladder_and_split_arm():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        labels = [_lab(1, "H", 1), _lab(2), _lab(3, "H", 2)]
        cards = [_card(1, 0, 50.0), _card(2, 0, 80.0), _card(3, 1, 20.0)]
        args = _setup(tmp, labels, cards)
        r = overlay(*args, salt="s", train_share=1.0, out=tmp / "out")
        assert r["train_rows"] == 3 and r["train_h"] == 2 and r["hosts"]["train"] == ["new.gov"]
        rows = [json.loads(l) for l in (tmp / "out" / "labels.jsonl").read_text().splitlines()]
        assert rows[0]["id"] == "k:1" and rows[1]["client_id"] == "new.gov" and rows[1]["label_source"] == "opus-fable-consensus"
        split = json.loads((tmp / "out" / "split.json").read_text())
        assert split["ids"]["train"] == ["k:1", "c8-0001:1", "c8-0001:2", "c8-0001:3"] and split["ids"]["test"] == []
        kh = json.loads((tmp / "out" / "key-headings.json").read_text())
        assert [h["locator"] for h in kh["c8-0001"]] == ["c8-0001:1", "c8-0001:3"] and kh["k"] == []


def test_share_zero_sends_every_host_to_validation():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        args = _setup(tmp, [_lab(1)], [_card(1)])
        r = overlay(*args, salt="s", train_share=0.0, out=tmp / "out")
        assert r["validation_rows"] == 1 and "train_rows" not in r


def test_refuses_an_id_already_in_the_base():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        args = _setup(tmp, [_lab(1)], [_card(1)], base_ids=["k:1", "c8-0001:1"])
        try:
            overlay(*args, salt="s", train_share=1.0, out=tmp / "out")
        except SystemExit as e:
            assert "already in the base" in str(e) and not (tmp / "out").exists()
        else:
            raise AssertionError("expected a refusal")


def test_refuses_a_host_the_base_split_placed_elsewhere():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        args = _setup(tmp, [_lab(1)], [_card(1)], base_host="new.gov")
        try:
            overlay(*args, salt="s", train_share=0.0, out=tmp / "out")
        except SystemExit as e:
            assert "already sits in train" in str(e)
        else:
            raise AssertionError("expected a refusal")


def test_arm_is_a_pure_function_of_salt_and_host():
    assert arm_of("a.gov", "s", 0.7) == arm_of("a.gov", "s", 0.7)
    assert {arm_of(f"h{i}.gov", "s", 0.7) for i in range(50)} == {"train", "validation"}


def test_ladder_orders_by_page_then_y():
    rows = [{"id": "d:2", "label": {"heading": True, "level": 2}}, {"id": "d:1", "label": {"heading": True, "level": 1}},
            {"id": "d:3", "label": {"heading": False, "level": None}}]
    cards = {"d:1": {"page": 0, "y0": 5.0, "x0": 0.0, "text": "A"}, "d:2": {"page": 1, "y0": 1.0, "x0": 0.0, "text": "B"},
             "d:3": {"page": 0, "y0": 1.0, "x0": 0.0}}
    assert [h["locator"] for h in ladder(rows, cards)] == ["d:1", "d:2"]
