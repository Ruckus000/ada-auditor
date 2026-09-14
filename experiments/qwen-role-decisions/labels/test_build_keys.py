# labels/test_build_keys.py
import json, tempfile
from pathlib import Path
from labels.build_keys import originals, unmatched_row


def test_originals_excludes_tagger_output_and_adds_word_conversions():
    rows = [{"id": "n01", "kind": "pdf", "path": "/x/n01.pdf", "host": "a", "sha256": "1" * 64},
            {"id": "n09", "kind": "pdf", "path": "/x/n09.pdf", "host": "b", "sha256": "2" * 64},
            {"id": "n34", "kind": "docx", "path": "/x/n34.docx", "host": "c", "sha256": "3" * 64}]
    with tempfile.TemporaryDirectory() as d:
        staged = Path(d) / "labels"; staged.mkdir()
        (staged / "staging.json").write_text(json.dumps([{"id": "n01", "source": "original", "tagged": True}, {"id": "n09", "source": "opendataloader", "tagged": True}]))
        word = Path(d) / "word-pdfs"; word.mkdir(); (word / "n34.pdf").write_bytes(b"x")
        out = originals(rows, word, staged)
    assert [(o["id"], o["source"]) for o in out] == [("n01", "stripped-tree"), ("n34", "word-outline")]
    assert out[1]["original"].endswith("n34.pdf") and out[0]["original"] == "/x/n01.pdf"


def test_unmatched_row_carries_geometry_and_hash_but_no_text():
    card = {"card_id": "n01:7", "document_id": "n01", "page": 3, "x0": 1, "y0": 2, "x1": 3, "y1": 4, "font_pt": 9.5, "weight": "regular",
            "in_table_box": False, "why": ["short"], "existing_tag": None, "text": "Page 4", "norm": "page4", "locator": "n01:7"}
    row = unmatched_row(card)
    assert list(row) == ["card_id", "document_id", "page", "x0", "y0", "x1", "y1", "font_pt", "weight", "in_table_box", "why", "existing_tag", "text_sha256"]
    assert row["card_id"] == "n01:7" and row["page"] == 3 and len(row["text_sha256"]) == 64
    assert "Page 4" not in json.dumps(row) and "page4" not in json.dumps(row)
