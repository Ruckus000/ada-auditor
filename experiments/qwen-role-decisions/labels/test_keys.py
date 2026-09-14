from labels.keys import heading_sentence_share, key_blocks, key_type


def test_key_type_maps_vocabulary_levels_and_other():
    assert key_type("H2") == ("H", 2) and key_type("H6") == ("H", 6)
    assert key_type("Caption") == ("Caption", None) and key_type("TH") == ("TH", None)
    assert key_type("TD") == ("Other", None) and key_type("") == ("Other", None) and key_type("Figure") == ("Other", None)


def test_key_blocks_and_sentence_share():
    dump = {"hasStructTree": True, "blocks": [
        {"locator": "d:0", "existing_tag": "H1", "text": "Title", "page": 0, "x0": 1, "y0": 1, "x1": 2, "y1": 2},
        {"locator": "d:1", "existing_tag": "H2", "text": "This heading is a sentence.", "page": 0, "x0": 1, "y0": 3, "x1": 2, "y1": 4},
        {"locator": "d:2", "existing_tag": "P", "text": "Body.", "page": 0},
    ]}
    ks = key_blocks(dump)
    assert [k["type"] for k in ks] == ["H", "H", "P"] and ks[0]["level"] == 1 and ks[2].get("x0") is None
    assert ks[0]["norm"] == "title"
    assert heading_sentence_share(ks) == 0.5
    assert heading_sentence_share([ks[2]]) is None
