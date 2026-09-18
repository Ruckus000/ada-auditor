import random
from pathlib import Path

from labels.build_keys import candidate_pool, document_cards
from labels.pdf_cards import SEED
from labels.split_heads import split_enumerated_heads


def blk(loc, text, first, lines, tag="LI", pt=12, y0=360.0, y1=490.0):
    return {"locator": loc, "existing_tag": tag, "text": text, "first_line": first, "line_count": lines,
            "font_pt": pt, "weight": "regular", "ancestors": ["L", "Document"], "in_table_box": False,
            "page": 0, "x0": 144.0, "y0": y0, "x1": 520.0, "y1": y1}


def test_li_with_short_enumerated_first_line_splits_into_head_and_body():
    out, n = split_enumerated_heads([blk("d:9", "A. Plans All tanks shall be installed in accordance", "A. Plans", 8)])
    assert n == 1 and [b["locator"] for b in out] == ["d:9h", "d:9"]
    head, body = out
    assert head["text"] == "A. Plans" and head["split"] == "head" and head["y1"] == 360.0 + 1.3 * 12
    assert body["text"] == "All tanks shall be installed in accordance" and body["split"] == "body" and body["y0"] == head["y1"]
    assert head["existing_tag"] == body["existing_tag"] == "LI"
    assert (head["y0"], body["y1"]) == (360.0, 490.0)


def test_numeral_only_lbl_and_single_line_blocks_are_untouched():
    blocks = [blk("d:10", "A.", "A.", 1, tag="Lbl", y1=367.0), blk("d:38", "D. Risk Coordinator, Office of Human Resources", "D. Risk Coordinator, Office of Human Resources", 1)]
    out, n = split_enumerated_heads(blocks)
    assert n == 0 and out == blocks


def test_a_long_or_sentence_like_first_line_does_not_split():
    long = blk("d:1", "1. Typical fire hydrants or hose connections shall be", "1. Typical fire hydrants or hose connections shall be", 3)
    lead = blk("d:2", "A. Note: the following items apply. More text", "A. Note: the following items apply.", 2)
    out, n = split_enumerated_heads([long, lead])
    assert n == 0 and out == [long, lead]


def test_h_tagged_merged_block_splits_too():
    out, n = split_enumerated_heads([blk("d:153", "IX. Tagout A. Authorized employees must tag", "IX. Tagout", 3, tag="H3")])
    assert n == 1 and out[0]["text"] == "IX. Tagout" and out[0]["existing_tag"] == "H3"


def test_other_tags_missing_first_line_and_enumerator_only_heads_are_untouched():
    blocks = [blk("d:1", "A. Plans All tanks", "A. Plans", 3, tag="P"),       # P is not a split tag
              {k: v for k, v in blk("d:2", "A. Plans All tanks", "A. Plans", 3).items() if k not in ("first_line", "line_count")},  # an old dump
              blk("d:3", "A. All tanks", "A.", 2),                             # enumerator alone: no word after it
              blk("d:4", "a. plans all tanks", "a. plans", 2),                 # lower-case enumerator is not in the rule
              {**blk("d:5", "A. Plans All tanks", "A. Plans", 3), "font_pt": None}]
    out, n = split_enumerated_heads(blocks)
    assert n == 0 and out == blocks


def test_the_input_blocks_are_not_mutated():
    b = blk("d:9", "A. Plans All tanks shall", "A. Plans", 4)
    before = dict(b)
    split_enumerated_heads([b])
    assert b == before


def test_training_key_builder_never_splits():
    """build_keys' pool and cards are the same with or without the new dump keys: the split is suggest-only."""
    shaped = [blk("d:9", "A. Plans All tanks shall be installed in accordance with the plans.", "A. Plans", 8),
              blk("d:10", "A.", "A.", 1, tag="Lbl", y1=367.0)]
    old = [{k: v for k, v in b.items() if k not in ("first_line", "line_count")} for b in shaped]
    for blocks in (shaped, old):
        pool = candidate_pool({"blocks": blocks}, "d")
        assert [(c["locator"], c["text"]) for c in pool] == [("d:9", blocks[0]["text"]), ("d:10", "A.")]
    cards = [document_cards(Path("d"), "d", random.Random(SEED), dump=lambda _p, compile=False, b=b: {"blocks": b}, select=False)
             for b in (shaped, old)]
    assert cards[0] == cards[1]
