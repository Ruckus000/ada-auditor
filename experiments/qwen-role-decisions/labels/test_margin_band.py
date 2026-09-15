from labels.margin_band import in_margin_band, page_extents


def _blocks():
    return [
        {"page": 0, "y0": 50.0, "y1": 60.0},
        {"page": 0, "y0": 400.0, "y1": 410.0},
        {"page": 0, "y0": 740.0, "y1": 750.0},
        {"page": 1, "y0": 100.0, "y1": 110.0},
        {"page": 1, "y0": None, "y1": 10.0},
        {"page": None, "y0": 0.0, "y1": 1.0},
    ]


def test_page_extents_span_every_block_with_a_box():
    assert page_extents(_blocks()) == {0: (50.0, 750.0), 1: (100.0, 110.0)}


def test_top_and_bottom_bands_are_in_mid_page_is_not():
    ext = page_extents(_blocks())  # page 0 span 700, band 84
    assert in_margin_band({"page": 0, "y0": 120.0, "y1": 130.0}, ext)       # 120 <= 134
    assert in_margin_band({"page": 0, "y0": 670.0, "y1": 680.0}, ext)       # 680 >= 666
    assert not in_margin_band({"page": 0, "y0": 400.0, "y1": 410.0}, ext)
    assert not in_margin_band({"page": 0, "y0": 140.0, "y1": 150.0}, ext)
