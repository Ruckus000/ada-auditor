"""Tests for labels.fold_view_cards."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from labels.fold_view_cards import assemble, chosen_dirs


def _doc(root: Path, round_dir: str, doc: str, ids: list[str]) -> None:
    d = root / round_dir / doc
    d.mkdir(parents=True)
    (d / "sidecar.json").write_text(json.dumps({"document": doc, "cards": []}))
    with (d / "cards.jsonl").open("w") as f:
        for i in ids:
            f.write(json.dumps({"card_id": i, "document_id": doc}) + "\n")


def _fold(path: Path, ids: list[str]) -> None:
    with path.open("w") as f:
        for i in ids:
            f.write(json.dumps({"id": i}) + "\n")


def _fixture():
    tmp = tempfile.TemporaryDirectory()
    root = Path(tmp.name)
    sug = root / "suggest"
    _doc(sug, "wild-v2", "c3-0001", ["c3-0001:0", "c3-0001:1"])
    _doc(sug, "wild-v2", "c3-0002", ["c3-0002:0"])
    _doc(sug, "wild-r3", "c3-0003", ["c3-0003:0", "c3-0003:9"])
    _doc(sug, "wild-v4-runin", "c3-0002", ["c3-0002:0"])
    _doc(sug, "wild-v5-r5", "c3-0003", ["c3-0003:0", "c3-0003:9"])
    fold = root / "fold-cards.jsonl"
    _fold(fold, ["c3-0001:0", "c3-0001:1", "c3-0002:0", "c3-0003:0", "c3-0003:9"])
    return tmp, root, sug, fold


def test_priority_order_and_fold_order():
    tmp, root, sug, _ = _fixture()
    try:
        got = chosen_dirs(sug)
        assert [d.parent.name for _, _, d in got] == ["wild-v2", "wild-v4-runin", "wild-v5-r5"], got
        assert [doc for _, doc, _ in got] == ["c3-0001", "c3-0002", "c3-0003"], got
    finally:
        tmp.cleanup()


def test_assemble_writes_when_ids_match():
    tmp, root, sug, fold = _fixture()
    try:
        out = root / "out" / "cards.jsonl"
        report = assemble(fold, sug, out, root / "out" / "report.json")
        assert [json.loads(l)["card_id"] for l in out.read_text().splitlines()] == \
            ["c3-0001:0", "c3-0001:1", "c3-0002:0", "c3-0003:0", "c3-0003:9"]
        assert report["rows"] == 5 and report["documents"] == 3
        assert report["chosen"] == {"c3-0001": "wild-v2", "c3-0002": "wild-v4-runin", "c3-0003": "wild-v5-r5"}
    finally:
        tmp.cleanup()


def test_assemble_refuses_mismatch_and_overwrite():
    tmp, root, sug, fold = _fixture()
    try:
        bad = root / "bad-fold.jsonl"
        _fold(bad, ["c3-0001:0"])
        try:
            assemble(bad, sug, root / "x.jsonl")
            raise AssertionError("mismatch not refused")
        except SystemExit:
            pass
        out = root / "out" / "cards.jsonl"
        assemble(fold, sug, out)
        try:
            assemble(fold, sug, out)
            raise AssertionError("overwrite not refused")
        except SystemExit:
            pass
    finally:
        tmp.cleanup()


def test_missing_sidecar_refuses():
    tmp, root, sug, fold = _fixture()
    try:
        (sug / "wild-v2" / "c3-0001" / "sidecar.json").unlink()
        try:
            chosen_dirs(sug)
            raise AssertionError("missing sidecar not refused")
        except SystemExit:
            pass
    finally:
        tmp.cleanup()
