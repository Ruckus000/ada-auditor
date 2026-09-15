from labels.rules import decide, forbids_heading


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
