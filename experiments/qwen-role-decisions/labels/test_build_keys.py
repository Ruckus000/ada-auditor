# labels/test_build_keys.py
import json, tempfile
from pathlib import Path
from labels.build_keys import originals


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
