import random
from pathlib import Path

from labels.build_keys import candidate_pool, document_cards
from labels.pdf_cards import SEED
from labels.split_heads import split_enumerated_heads, split_run_in_heads


def blk(loc, text, first, lines, tag="LI", pt=12, y0=360.0, y1=490.0, fx1=None, in_table=False):
    b = {"locator": loc, "existing_tag": tag, "text": text, "first_line": first, "line_count": lines,
         "font_pt": pt, "weight": "regular", "ancestors": ["L", "Document"], "in_table_box": in_table,
         "page": 0, "x0": 144.0, "y0": y0, "x1": 520.0, "y1": y1}
    if fx1 is not None:
        b["first_line_x1"] = fx1
    return b


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


def test_punctuation_only_tokens_do_not_count_toward_the_word_cap():
    # "VI. Budget Process – Execution And Controls" is 7 tokens but 6 words: the dash is not a word.
    dash = blk("d:59", "VI. Budget Process – Execution And Controls The budget shall", "VI. Budget Process – Execution And Controls", 4)
    seven = blk("d:12", "A. Directors Heads and Deputy Directors Staff Each director shall", "A. Directors Heads and Deputy Directors Staff", 4)
    out, n = split_enumerated_heads([dash, seven])
    assert n == 1 and [b["locator"] for b in out] == ["d:59h", "d:59", "d:12"]


# Stage 2 run-in split: --split-run-in-heads WIDTH. The blk helper's block is 376 wide
# (x0 144, x1 520), so at width fraction 0.6 the split needs first_line_x1 - 144 < 225.6;
# fx1 = 313.2 ends the first line at 45 % of the block width, fx1 = 444.8 at 80 %.

def test_run_in_p_block_with_a_short_first_line_ending_early_splits_into_head_and_body():
    out, n = split_run_in_heads([blk("d:109", "Plant Selection Native species thrive on this site", "Plant Selection", 4, tag="P", fx1=313.2)], 0.6)
    assert n == 1 and [b["locator"] for b in out] == ["d:109h", "d:109"]
    head, body = out
    assert head["text"] == "Plant Selection" and head["split"] == "head" and head["y1"] == 360.0 + 1.3 * 12
    assert body["text"] == "Native species thrive on this site" and body["split"] == "body" and body["y0"] == head["y1"]
    assert head["existing_tag"] == body["existing_tag"] == "P"
    assert (head["y0"], body["y1"]) == (360.0, 490.0)


def test_run_in_first_line_ending_past_the_width_fraction_does_not_split():
    # a paragraph whose first line is short only because of where the wrap fell (ends at 80 %)
    out, n = split_run_in_heads([blk("d:1", "Note the following items apply here and below", "Note the following", 3, tag="P", fx1=444.8)], 0.6)
    assert n == 0


def test_run_in_two_line_title_ending_past_the_fraction_does_not_split():
    out, n = split_run_in_heads([blk("d:2", "Title Line One Title Line Two", "Title Line One", 2, tag="P", fx1=444.8)], 0.6)
    assert n == 0


def test_run_in_list_item_lead_in_ending_in_a_colon_does_not_split():
    out, n = split_run_in_heads([blk("d:3", "Note: the following items apply to all tanks", "Note:", 2, fx1=200.0)], 0.6)
    assert n == 0


def test_run_in_first_lines_ending_in_sentence_punctuation_do_not_split():
    blocks = [blk("d:4", "End. More text follows here", "End.", 2, tag="P", fx1=200.0),
              blk("d:5", "End; more text follows here", "End;", 2, tag="P", fx1=200.0),
              blk("d:6", "End: more text follows here", "End:", 2, tag="P", fx1=200.0)]
    out, n = split_run_in_heads(blocks, 0.6)
    assert n == 0 and out == blocks


def test_run_in_table_cells_never_split():
    cells = [blk("d:7", "Sieve Name 3 in 2 in 1.5 in", "Sieve Name", 2, tag="P", fx1=220.0, in_table=True),
             blk("d:8", "Sieve Name 3 in 2 in 1.5 in", "Sieve Name", 2, tag="TH", fx1=220.0)]
    out, n = split_run_in_heads(cells, 0.6)
    assert n == 0 and out == cells


def test_run_in_old_dumps_without_first_line_x1_never_split():
    out, n = split_run_in_heads([blk("d:9", "Plant Selection Native species thrive", "Plant Selection", 3, tag="P")], 0.6)
    assert n == 0


def test_run_in_a_block_whose_text_is_only_the_first_line_does_not_split():
    out, n = split_run_in_heads([blk("d:10", "Plant Selection", "Plant Selection", 2, tag="P", fx1=250.0)], 0.6)
    assert n == 0


def test_run_in_does_not_mutate_the_input_blocks():
    b = blk("d:11", "Plant Selection Native species thrive", "Plant Selection", 3, tag="P", fx1=313.2)
    before = dict(b)
    split_run_in_heads([b], 0.6)
    assert b == before


def test_run_in_width_fraction_is_validated():
    for bad in (0.0, 1.0, -0.5, 1.5):
        try:
            split_run_in_heads([], bad)
        except ValueError:
            continue
        raise AssertionError(f"width_frac {bad} accepted")


def test_a_block_matching_both_rules_splits_once():
    # enumerated first (the way suggest wires it), then run-in: the head is already
    # split off, and its empty remainder is never re-split
    b = blk("d:12", "B. Scope Every widget shall be counted twice.", "B. Scope", 3, fx1=250.0)
    once, n1 = split_enumerated_heads([b])
    twice, n2 = split_run_in_heads(once, 0.6)
    assert (n1, n2) == (1, 0) and [x["locator"] for x in twice] == ["d:12h", "d:12"]
    out, n3 = split_run_in_heads([b], 0.6)  # run-in alone splits it once, to the same cards
    assert n3 == 1 and [x["locator"] for x in out] == ["d:12h", "d:12"]
    assert [(x["text"], x["split"]) for x in out] == [("B. Scope", "head"), ("Every widget shall be counted twice.", "body")]


def test_training_key_builder_ignores_first_line_x1():
    """build_keys' pool and cards are the same with or without the new dump key: the split is suggest-only."""
    shaped = [blk("d:9", "Plant Selection Native species thrive on this site.", "Plant Selection", 4, tag="P", fx1=313.2)]
    old = [{k: v for k, v in b.items() if k != "first_line_x1"} for b in shaped]
    for blocks in (shaped, old):
        pool = candidate_pool({"blocks": blocks}, "d")
        assert [(c["locator"], c["text"]) for c in pool] == [("d:9", blocks[0]["text"])]
    cards = [document_cards(Path("d"), "d", random.Random(SEED), dump=lambda _p, compile=False, b=b: {"blocks": b}, select=False)
             for b in (shaped, old)]
    assert cards[0] == cards[1]


def _rotated(block: dict, dir_: float | None) -> dict:
    return {**block, "text_dir": dir_}


def test_a_rotated_block_is_left_whole_by_both_splits():
    """The box is page space and `first_line_x1` is the reading frame, so on a
    rotated block the width ratio compares two frames and the `y0 + 1.3 em` cut
    runs along the reading axis. Registered 2026-09-25: leave it whole."""
    enum = {"existing_tag": "LI", "line_count": 2, "first_line": "A. Plans",
            "text": "A. Plans and the body that follows", "font_pt": 10.0,
            "x0": 0.0, "y0": 0.0, "x1": 100.0, "y1": 40.0, "locator": "d:1"}
    run_in = {**enum, "first_line": "Plant Selection", "text": "Plant Selection Native species thrive",
              "existing_tag": "P", "first_line_x1": 20.0}
    for dir_ in (90, 270, 180, None):
        assert split_enumerated_heads([_rotated(enum, dir_)])[1] == 0, dir_
        assert split_run_in_heads([_rotated(run_in, dir_)], 0.5)[1] == 0, dir_
    # Upright still splits, and so does a dump from before text_dir existed.
    assert split_enumerated_heads([_rotated(enum, 0)])[1] == 1
    assert split_run_in_heads([_rotated(run_in, 0)], 0.5)[1] == 1
    assert split_enumerated_heads([enum])[1] == 1
    assert split_run_in_heads([run_in], 0.5)[1] == 1


def test_a_block_with_no_box_is_left_whole_by_both_splits():
    """Since StructText stopped inventing a box off another page, a block can
    reach the splits with no geometry. They run on raw blocks, before
    run.blocks_to_cards refuses it, and both cut at y0 + 1.3 em."""
    enum = {"existing_tag": "LI", "line_count": 2, "first_line": "A. Plans",
            "text": "A. Plans and the body that follows", "font_pt": 10.0, "locator": "d:1"}
    run_in = {**enum, "first_line": "Plant Selection", "existing_tag": "P",
              "text": "Plant Selection Native species thrive", "first_line_x1": 20.0}
    assert split_enumerated_heads([enum])[1] == 0
    assert split_run_in_heads([run_in], 0.5)[1] == 0
