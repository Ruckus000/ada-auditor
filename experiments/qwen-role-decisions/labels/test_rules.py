from labels.rules import caption_by_prefix, decide, forbids_heading, list_item_body, toci_by_leaders


def test_toci_needs_three_dots_and_a_trailing_page_number():
    assert toci_by_leaders({"text": "Introduction ... 12"}) == ("TOCI", 3)
    assert toci_by_leaders({"text": "Appendix A . . . . . 7"}) == ("TOCI", 3)
    assert toci_by_leaders({"text": "Budget..........103"}) == ("TOCI", 3)
    assert decide({"text": "Introduction ... 12", "repeats_on_pages": 1}) == ("TOCI", 3)


def test_toci_near_misses():
    assert toci_by_leaders({"text": "Introduction … 12"}) is None   # ellipsis, not leaders
    assert toci_by_leaders({"text": "Introduction 12"}) is None          # no leaders at all
    assert toci_by_leaders({"text": "Section 4.. 12"}) is None           # only two dots
    assert toci_by_leaders({"text": "Introduction ... 12345"}) is None   # five digits
    assert toci_by_leaders({"text": "Introduction ... 12 and more"}) is None  # not at the end


def test_caption_needs_a_number_then_punctuation():
    assert caption_by_prefix({"text": "Table 3: Revenue"}) == ("Caption", 3)
    assert caption_by_prefix({"text": "Figure 2a — Site plan"}) == ("Caption", 3)
    assert caption_by_prefix({"text": "Chart 10. Trend"}) == ("Caption", 3)
    assert caption_by_prefix({"text": "Exhibit 4-B"}) == ("Caption", 3)
    assert decide({"text": "Table 3: Revenue", "repeats_on_pages": 1}) == ("Caption", 3)


def test_caption_near_misses():
    assert caption_by_prefix({"text": "Figure it out:"}) is None      # no number
    assert caption_by_prefix({"text": "Table of Contents"}) is None
    assert caption_by_prefix({"text": "Tables 3: Revenue"}) is None   # not one of the four words
    assert caption_by_prefix({"text": "Figure 12 Site plan"}) is None  # no punctuation after the number
    assert caption_by_prefix({"text": "See Table 3: Revenue"}) is None  # not at the start


def test_list_item_body_reads_the_neighbour_fact_and_never_recomputes_it():
    assert list_item_body({"text": "Submit the form", "after_inline_label": True}) == ("Other", 3)
    assert list_item_body({"text": "Submit the form", "after_inline_label": False}) is None
    assert list_item_body({"text": "Submit the form"}) is None
    assert decide({"text": "Submit the form", "repeats_on_pages": 1, "after_inline_label": False}) is None
    assert decide({"text": "Submit the form", "repeats_on_pages": 1, "after_inline_label": True}) == ("Other", 3)


def test_the_existing_rules_still_win_first():
    # A no-letters card that also looks like a contents line stays Lbl.
    assert decide({"text": "... 12", "repeats_on_pages": 1}) == ("Lbl", 3)
    # A margin repeat stays Artifact even beside a bullet.
    assert decide({"text": "Town of X", "repeats_on_pages": 4, "in_margin_band": True, "after_inline_label": True}) == ("Artifact", 2)


def test_rules_in_front():
    assert decide({"text": "3", "repeats_on_pages": 1}) == ("Lbl", 3)
    assert decide({"text": "— — —"}) == ("Lbl", 3)
    assert decide({"text": "Town of X · Page", "repeats_on_pages": 4, "in_margin_band": True}) == ("Artifact", 2)
    assert decide({"text": "Town of X · Page", "repeats_on_pages": 2}) is None
    assert decide({"text": "Public Comment", "repeats_on_pages": 1}) is None


def test_repeat_mid_page_is_not_artifact():
    assert decide({"id": "d:1", "text": "Section", "repeats_on_pages": 5, "in_margin_band": False}) is None


def test_repeat_in_margin_band_is_artifact():
    assert decide({"id": "d:1", "text": "Running head", "repeats_on_pages": 3, "in_margin_band": True}) == ("Artifact", 2)


def test_two_repeats_is_never_artifact_whatever_the_band():
    assert decide({"text": "Header", "repeats_on_pages": 2, "in_margin_band": True}) is None
    assert decide({"text": "Header", "repeats_on_pages": 2}) is None


def test_missing_margin_fact_on_a_repeat_raises_naming_the_card():
    try:
        decide({"card_id": "doc-9:42", "text": "Header", "repeats_on_pages": 3})
    except ValueError as e:
        assert "doc-9:42" in str(e)
    else:
        raise AssertionError("expected ValueError")


def test_table_veto_is_by_ancestry_not_geometry():
    assert not forbids_heading({"in_table_box": True, "ancestors": ["Document"]})
    assert forbids_heading({"in_table_box": False, "ancestors": ["TD", "TR", "Table", "Document"]})
    assert not forbids_heading({"ancestors": ["TableOfFigures", "Tables"]})
    assert not forbids_heading({})
