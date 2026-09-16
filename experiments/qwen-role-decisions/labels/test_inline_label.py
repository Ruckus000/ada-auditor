from labels.inline_label import after_inline_label, has_no_letters


def _card(cid, page, x0, y0, x1, text):
    return {"card_id": cid, "page": page, "x0": x0, "y0": y0, "x1": x1, "y1": y0 + 10.0, "text": text}


def test_no_letters_is_about_alphabetics_not_emptiness():
    assert has_no_letters("1.")
    assert has_no_letters("•")
    assert not has_no_letters("")
    assert not has_no_letters("   ")
    assert not has_no_letters("a)")


def test_bullet_to_the_left_on_the_same_line_marks_the_body():
    got = after_inline_label([
        _card("d:1", 0, 72.0, 100.0, 80.0, "•"),
        _card("d:2", 0, 90.0, 101.5, 400.0, "Submit the form by Friday"),
    ])
    assert got == {"d:1": False, "d:2": True}


def test_a_neighbour_that_is_too_far_down_or_to_the_right_does_not_count():
    rows = [
        _card("d:1", 0, 72.0, 100.0, 80.0, "1."),
        _card("d:2", 0, 90.0, 104.0, 400.0, "Next line, not the same one"),
        _card("d:3", 0, 60.0, 100.0, 400.0, "Left of the bullet, so the bullet is not before it"),
    ]
    got = after_inline_label(rows)
    assert got["d:2"] is False
    assert got["d:3"] is False


def test_a_lettered_neighbour_is_not_a_label_and_pages_do_not_mix():
    rows = [
        _card("d:1", 0, 72.0, 100.0, 80.0, "Note"),
        _card("d:2", 0, 90.0, 100.0, 400.0, "Body text"),
        _card("d:3", 1, 72.0, 100.0, 80.0, "•"),
        _card("d:4", 0, 90.0, 100.0, 400.0, "Other page body"),
    ]
    got = after_inline_label(rows)
    assert got["d:2"] is False
    assert got["d:4"] is False


def test_a_card_without_a_box_is_false_not_an_error():
    rows = [{"card_id": "d:9", "text": "No geometry at all"}]
    assert after_inline_label(rows) == {"d:9": False}
