from labels.rules import decide, forbids_heading


def test_rules_in_front():
    assert decide({"text": "3", "repeats_on_pages": 1}) == ("Lbl", 3)
    assert decide({"text": "— — —"}) == ("Lbl", 3)
    assert decide({"text": "Town of X · Page", "repeats_on_pages": 4}) == ("Artifact", 2)
    assert decide({"text": "Town of X · Page", "repeats_on_pages": 2}) is None
    assert decide({"text": "Public Comment", "repeats_on_pages": 1}) is None
    assert forbids_heading({"in_table_box": True}) and not forbids_heading({"in_table_box": False})
