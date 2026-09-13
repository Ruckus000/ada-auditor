from pathlib import Path

from labels.stage_pdfs import plan_staging


def test_plan_staging_splits_on_tree_presence_and_skips_word():
    rows = [
        {"id": "n01", "kind": "pdf", "path": "/x/n01.pdf"},
        {"id": "n09", "kind": "pdf", "path": "/x/n09.pdf"},
        {"id": "n34", "kind": "docx", "path": "/x/n34.docx"},
    ]
    keep, tag = plan_staging(rows, has_tree=lambda p: p.name == "n01.pdf")
    assert [r["id"] for r in keep] == ["n01"]
    assert [r["id"] for r in tag] == ["n09"]
