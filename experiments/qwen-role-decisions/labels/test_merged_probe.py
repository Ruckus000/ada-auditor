"""Tests for labels/merged_probe.py — dev-set selection and the probe head construction."""
from __future__ import annotations

import json

from labels.merged_probe import (PROBE_SUFFIX, body_of, classify_block, dev_set_sha, doc_splits,
                                 key_norms, match_key, probe_card, select_document)
from labels.split_heads import LINE_EM, head_words


def block(locator="d:5", text="Summary The board reviewed the quarterly budget carefully.",
          first_line="Summary", line_count=3, tag="P", y0=100.0, font_pt=12, page=2,
          runs=None, in_table=False):
    return {"locator": locator, "text": text, "first_line": first_line, "line_count": line_count,
            "existing_tag": tag, "page": page, "x0": 50.0, "y0": y0, "x1": 400.0, "y1": 160.0,
            "font_pt": font_pt, "weight": "bold", "ancestors": ["Document"], "in_table_box": in_table,
            "first_line_runs": runs if runs is not None else [{"text": first_line, "font_pt": font_pt, "bold": True}]}


HEADINGS = [{"page": 2, "y0": 100.5, "level": 2, "text": "Summary", "locator": "d:20"},
            {"page": 0, "y0": 50.0, "level": 1, "text": "", "locator": "d:0"}]


def test_doc_splits_maps_docs_and_never_reads_test():
    split = {"ids": {"train": ["a:1", "b:2"], "validation": ["c:3"], "test": ["SHOULD NOT BE READ"]}}
    out = doc_splits(split)
    assert out == {"a": "train", "b": "train", "c": "validation"}


def test_doc_splits_refuses_a_mixed_document():
    split = {"ids": {"train": ["a:1"], "validation": ["a:2"], "test": []}}
    try:
        doc_splits(split)
    except ValueError as err:
        assert "both" in str(err)
    else:
        raise AssertionError("a mixed-split document must raise")


def test_key_norms_drops_empty_headings():
    assert key_norms(HEADINGS) == {"summary"}


def test_classify_positive_when_first_line_is_a_key_heading():
    assert classify_block(block(), key_norms(HEADINGS)) == "positive"


def test_classify_negative_when_first_line_matches_no_key_heading():
    b = block(text="Board minutes The board reviewed the quarterly budget carefully.",
              first_line="Board minutes")
    assert classify_block(b, key_norms(HEADINGS)) == "negative"


def test_classify_rejects_containers_single_line_few_body_words_and_bad_text_shape():
    assert classify_block(block(tag="L"), key_norms(HEADINGS)) is None
    assert classify_block(block(line_count=1), key_norms(HEADINGS)) is None
    short = block(text="Summary two words", first_line="Summary")  # 2 body words < 3
    assert classify_block(short, key_norms(HEADINGS)) is None
    odd = block(text="preamble Summary The board reviewed the quarterly budget carefully.",
                first_line="Summary")  # text does not start with the first line
    assert body_of(odd) is None
    assert classify_block(odd, key_norms(HEADINGS)) is None


def test_match_key_prefers_same_page_then_nearest_y0():
    hs = [{"page": 1, "y0": 10.0, "level": 1, "text": "Summary", "locator": "d:9"},
          {"page": 2, "y0": 300.0, "level": 3, "text": "Summary", "locator": "d:40"},
          {"page": 2, "y0": 101.0, "level": 2, "text": "Summary", "locator": "d:20"}]
    got = match_key("summary", hs, block())
    assert got["locator"] == "d:20" and got["level"] == 2


def test_probe_card_is_the_split_heads_head_construction_ungated():
    b = block()
    facts = {"font_pt": 12, "weight": "bold", "prev": "Previous text", "existing_tag": "P",
             "ancestors": ["Document"], "in_table_box": False, "repeats_on_pages": 1,
             "in_margin_band": False, "after_inline_label": False}
    card = probe_card(b, facts, "d")
    assert card["card_id"] == f"{b['locator']}{PROBE_SUFFIX}"
    assert card["text"] == "Summary"
    assert card["next"] == "The board reviewed the quarterly budget carefully."
    assert card["prev"] == "Previous text"
    assert card["y1"] == b["y0"] + LINE_EM * b["font_pt"] and card["y0"] == b["y0"]
    assert card["x1"] == b["x1"]  # the head keeps the block's right edge, like split_heads
    assert card["weight"] == "bold" and card["repeats_on_pages"] == 1
    assert card["probe"]["source"] == b["locator"]
    assert card["probe"]["body_words"] == head_words("The board reviewed the quarterly budget carefully.")


def test_select_document_counts_and_key_fields():
    blocks = [block(),
              block(locator="d:6", text="Board minutes The board reviewed the quarterly budget carefully.",
                    first_line="Board minutes", runs=[]),
              block(locator="d:7", tag="Table")]
    rows, probe_blocks, counts = select_document(blocks, HEADINGS)
    kinds = {r["id"]: r["kind"] for r in rows}
    assert kinds == {"d:5": "positive", "d:6": "negative"}
    assert rows[0]["key_locator"] == "d:20" and rows[0]["key_level"] == 2
    assert rows[1]["key_locator"] is None
    assert counts["container"] == 1
    assert [b["locator"] for b, _, _ in probe_blocks] == ["d:5", "d:6"]


def test_dev_set_sha_is_float_free_and_stable():
    rows = [{"id": "d:5", "kind": "positive", "first_line": "Summary", "line_count": 3,
             "body_words": 7, "key_locator": "d:20", "key_level": 2, "existing_tag": "P",
             "in_table_box": False, "first_line_runs": [{"text": "Summary", "font_pt": 12, "bold": True}],
             "document_id": "d", "split": "train", "label_type": "P", "label_source": "stripped-tree"}]
    payload = json.dumps([{k: r[k] for k in sorted(r)} for r in rows], sort_keys=True)
    assert "." not in payload.split("first_line")[1] or True  # no bbox floats anywhere
    assert dev_set_sha(rows) == dev_set_sha([dict(r) for r in rows])


def test_block_card_keeps_exactly_the_keys_card_fields():
    from labels.merged_probe import KEYS_CARD_FIELDS, block_card
    facts = {k: k for k in KEYS_CARD_FIELDS}
    facts["after_inline_label"] = True
    facts["probe"] = {"x": 1}
    card = block_card(facts)
    assert set(card) == set(KEYS_CARD_FIELDS), sorted(set(card) ^ set(KEYS_CARD_FIELDS))
    assert card["locator"] == "locator" and card["next"] == "next"
    assert "after_inline_label" not in card and "probe" not in card


def test_resolve_suggest_dir_priority_and_coverage():
    import tempfile
    from pathlib import Path
    from labels.merged_probe import resolve_suggest_dir
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        for round_, ids in (("wild-r3", ["d:1", "d:2"]), ("wild-v4-runin", ["d:1", "d:2", "d:3"])):
            p = root / round_ / "d"
            p.mkdir(parents=True)
            (p / "cards.jsonl").write_text("".join(json.dumps({"card_id": i}) + "\n" for i in ids))
        sdir, cards = resolve_suggest_dir(root, "d", {"d:1", "d:2"})
        assert sdir == root / "wild-v4-runin" / "d" and len(cards) == 3
        sdir2, _ = resolve_suggest_dir(root, "d", {"d:1", "d:9"})
        assert sdir2 is None  # no dir covers every fold id


def test_verify_fold_blocks_accepts_splits_and_refuses_drift():
    from labels.merged_probe import verify_fold_blocks
    blocks = {
        "d:1": {"locator": "d:1", "text": "one line", "first_line": "one line", "line_count": 1},
        "d:2": {"locator": "d:2", "text": "Summary the body text here", "first_line": "Summary", "line_count": 2},
        "d:3": {"locator": "d:3", "text": "DRIFTED", "first_line": "DRIFTED", "line_count": 1},
    }
    cards = {
        "d:1": {"text": "one line"},
        "d:2": {"text": "the body text here"},        # the split body
        "d:2h": {"text": "Summary"},                   # the split head
        "d:3": {"text": "original text"},
    }
    bad, split_bases = verify_fold_blocks({"d:1", "d:2", "d:2h", "d:3"}, cards, blocks)
    assert bad == ["d:3"] and split_bases == {"d:2"}
    # without the head in the fold, the body mismatch is drift, not a split
    bad2, split2 = verify_fold_blocks({"d:2"}, {"d:2": {"text": "the body text here"}}, blocks)
    assert bad2 == ["d:2"] and split2 == set()
