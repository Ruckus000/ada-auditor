from labels.rules import caption_by_prefix, decide, enumerator_only, enumerator_quote_only, forbids_heading, list_item_body, toci_by_leaders


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


def test_r5_enumerator_only_is_lbl():
    # The registered R5 pattern: split_heads' enumerator with no words after the dot.
    assert enumerator_only({"text": "A."}) == ("Lbl", 5)
    assert enumerator_only({"text": "IV."}) == ("Lbl", 5)
    assert enumerator_only({"text": "XIII."}) == ("Lbl", 5)
    assert enumerator_only({"text": "3."}) == ("Lbl", 5)
    assert enumerator_only({"text": "  VII.  "}) == ("Lbl", 5)  # surrounding whitespace is not text


def test_r5_near_misses():
    assert enumerator_only({"text": "A.5"}) is None        # not the enumerator alone
    assert enumerator_only({"text": "IV"}) is None         # no closing dot
    assert enumerator_only({"text": "A.B"}) is None        # wrong tail
    assert enumerator_only({"text": "3.5"}) is None
    assert enumerator_only({"text": "A. Plans"}) is None   # words after the enumerator
    assert enumerator_only({"text": "AB."}) is None        # one letter only
    assert enumerator_only({"text": "a."}) is None         # upper case only
    assert enumerator_only({"text": "VII. Budget"}) is None
    assert enumerator_only({"text": ""}) is None
    assert enumerator_only({}) is None


def test_r5_runs_after_the_earlier_rules():
    # A digit enumerator has no letters: r2 already says Lbl (rule 3), unchanged.
    assert decide({"text": "3.", "repeats_on_pages": 1}) == ("Lbl", 3)
    # A margin-band repeat enumerator stays Artifact (rule 2), never Lbl.
    assert decide({"text": "IV.", "repeats_on_pages": 4, "in_margin_band": True}) == ("Artifact", 2)
    # A roman or letter enumerator with words is not R5's.
    assert decide({"text": "IV. Budget", "repeats_on_pages": 1}) is None
    # The new shape R5 exists for: a bare roman/letter enumerator reaches it.
    assert decide({"text": "IV.", "repeats_on_pages": 1}) == ("Lbl", 5)
    assert decide({"text": "B.", "repeats_on_pages": 1}) == ("Lbl", 5)


def test_r5b_enumerator_with_opening_quote_is_lbl():
    # The registered R5b pattern: R5's enumerator plus an optional opening quote.
    assert enumerator_quote_only({"text": "F. “"}) == ("Lbl", 5)
    assert enumerator_quote_only({"text": "G. '"}) == ("Lbl", 5)
    assert enumerator_quote_only({"text": "IV. ‘"}) == ("Lbl", 5)
    assert enumerator_quote_only({"text": '3. "'}) == ("Lbl", 5)
    assert enumerator_quote_only({"text": "A."}) == ("Lbl", 5)  # R5's shape still matches


def test_r5b_near_misses():
    assert enumerator_quote_only({"text": "F. Fees"}) is None   # words after the enumerator
    assert enumerator_quote_only({"text": "F. “Fees"}) is None  # a quote does not open a word run
    assert enumerator_quote_only({"text": "F.5"}) is None
    assert enumerator_quote_only({"text": "F. ”"}) is None      # a closing quote is not an opening one
    assert enumerator_quote_only({"text": "AB. “"}) is None     # one letter only
    assert enumerator_quote_only({"text": "a. “"}) is None      # upper case only
    assert enumerator_quote_only({"text": "F. ' x"}) is None
    assert enumerator_quote_only({"text": ""}) is None
    assert enumerator_quote_only({}) is None


def test_r5b_stays_out_of_the_default_chain():
    # Opt-in only: decide's output is unchanged by R5b's existence.
    assert decide({"text": "F. “", "repeats_on_pages": 1}) is None
    assert decide({"text": "G. '", "repeats_on_pages": 1}) is None
    assert decide({"text": "IV. ‘", "repeats_on_pages": 1}) is None


# Guard 1 (docs/superpowers/plans/2026-09-24-rule-fixes-registration.md): a repeat in
# the top band at body size or larger is a per-page title, so rule 2 abstains.
def _repeat(**facts):
    return {"id": "d:1", "text": "Blue Earth County Buffer Protection", "repeats_on_pages": 5, "in_margin_band": True, **facts}


def test_top_band_repeat_at_body_size_or_larger_abstains():
    assert decide(_repeat(margin_band="top", font_pt=15, body_font_pt=9)) is None
    assert decide(_repeat(margin_band="top", font_pt=12, body_font_pt=12)) is None   # equal to body counts


def test_small_top_repeat_and_any_bottom_repeat_stay_artifact():
    assert decide(_repeat(margin_band="top", font_pt=8, body_font_pt=11)) == ("Artifact", 2)
    assert decide(_repeat(margin_band="bottom", font_pt=15, body_font_pt=9)) == ("Artifact", 2)


def test_repeat_without_the_new_facts_behaves_as_before():
    assert decide(_repeat()) == ("Artifact", 2)
    assert decide(_repeat(margin_band="top", font_pt=15)) == ("Artifact", 2)          # no body size
    assert decide(_repeat(margin_band="top", body_font_pt=9)) == ("Artifact", 2)      # no font size


# Guard 2: a no-letters card whose own crop OCRs to a word (conf >= 80) has a text
# layer that contradicts the page, so the no-letters rule abstains.
def test_no_letters_card_contradicted_by_ocr_abstains():
    assert decide({"text": "552,579", "repeats_on_pages": 1, "ocr_word_conf": 95.0}) is None
    assert decide({"text": "552,579", "repeats_on_pages": 1, "ocr_word_conf": 80.0}) is None   # the bound is inclusive


def test_no_letters_card_confirmed_or_unchecked_is_still_lbl():
    assert decide({"text": "3", "repeats_on_pages": 1, "ocr_word_conf": 79.9}) == ("Lbl", 3)
    assert decide({"text": "3", "repeats_on_pages": 1, "ocr_word_conf": 0.0}) == ("Lbl", 3)
    assert decide({"text": "—", "repeats_on_pages": 1}) == ("Lbl", 3)                 # no fact: as before


def test_rule_2_guard_leaves_the_later_rules_in_place():
    # rule 2 abstains, so a later rule may still decide the card
    assert decide(_repeat(text="Figure 2: Site plan", margin_band="top", font_pt=12, body_font_pt=12)) == ("Caption", 3)


def test_a_contradicted_text_layer_stops_every_rule():
    # after_inline_label is derived from the same lying text layer, so list_item_body must not decide
    assert decide({"text": "..", "repeats_on_pages": 1, "after_inline_label": True, "ocr_word_conf": 93.0}) is None
    assert decide({"text": "3.", "repeats_on_pages": 1, "ocr_word_conf": 88.0}) is None          # nor R5
    assert decide({"text": "..", "repeats_on_pages": 1, "after_inline_label": True}) == ("Lbl", 3)  # unchecked: as before
