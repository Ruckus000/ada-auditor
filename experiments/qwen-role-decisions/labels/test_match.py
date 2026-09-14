from labels.match import iou, label_for, make_key_row, match_candidate, resolve_exact_duplicates
from eligibility_eval import refusals


def box(x0, y0, x1, y1, **k):
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1, **k}


def test_iou():
    assert iou(box(0, 0, 10, 10), box(0, 0, 10, 10)) == 1.0
    assert iou(box(0, 0, 10, 10), box(5, 0, 15, 10)) == 1 / 3
    assert iou(box(0, 0, 10, 10), box(20, 20, 30, 30)) == 0.0


def test_match_prefers_text_then_containment_then_box():
    keys = [box(0, 0, 100, 10, norm="publiccomment", type="H", level=2, locator="k:1"),
            box(0, 20, 100, 30, norm="thefeeschedulefor2026", type="P", level=None, locator="k:2"),
            box(0, 40, 100, 50, norm="fee", type="TH", level=None, locator="k:3")]
    assert match_candidate(box(0, 0, 100, 10, norm="publiccomment"), keys)[1] == "exact"
    k, how = match_candidate(box(0, 20, 60, 30, norm="thefeeschedule"), keys)
    assert how == "contains" and k["locator"] == "k:2"
    k, how = match_candidate(box(2, 41, 98, 49, norm="glyphsoup"), keys)  # OCR-ish text, box still says TH
    assert how == "box" and k["locator"] == "k:3"
    assert match_candidate(box(0, 200, 100, 210, norm="runningfooter"), keys) == (None, "none")


def test_containment_runs_one_way_only():
    keys = [box(0, 0, 100, 10, norm="publiccomment", type="H", level=2, locator="k:1")]
    card = box(0, 0, 40, 10, norm="publiccommentthemeetingopens")  # IoU 0.4: over CONTAIN_IOU, under BOX_IOU
    assert match_candidate(card, keys) == (None, "none")


def test_box_requires_the_card_inside_the_key():
    keys = [box(0, 0, 60, 10, norm="applicantowner", type="Other", level=None, locator="k:1")]
    card = box(0, 0, 100, 10, norm="glyphsoupmerged")  # IoU 0.6, but the key covers 60% of the card
    assert match_candidate(card, keys) == (None, "none")


def test_label_and_row_contract():
    assert label_for({}, {"type": "H", "level": 2}, "exact") == ("H", 2)
    try:
        label_for({}, None, "none")
    except ValueError:
        pass
    else:
        raise AssertionError("an unmatched card is not a label")
    card = {"card_id": "n01:5", "document_id": "n01", "kind": "pdf", "text": "Public Comment", "existing_tag": "H1", "why": ["source_h"], "repeats_on_pages": 1, "in_table_box": False, "font_pt": 14, "weight": "bold", "page": 0}
    doc = {"id": "n01", "sha256": "b" * 64, "host": "example.gov"}
    row = make_key_row(card, doc, {"type": "H", "level": 2, "locator": "k:9"}, "exact", "stripped-tree")
    assert row["label"] == {"heading": True, "level": 2} and row["type"] == "H" and row["match"] == "exact"
    assert row["label_source"] == "stripped-tree" and row["actor"] == "key:stripped-tree"
    assert "text" not in row and row["existing_tag"] == "H1"
    assert refusals([row]) == []  # after Task 6 widens the evaluator; before it, this line fails


def test_ties_break_by_section_4_order_not_list_order():
    card = box(0, 0, 100, 10, norm="fee")
    td = box(0, 0, 100, 10, norm="fee", type="Other", level=None, locator="k:td")
    p = box(0, 0, 100, 10, norm="fee", type="P", level=None, locator="k:p")
    assert match_candidate(card, [td, p]) == (p, "exact")
    th = box(0, 0, 100, 10, norm="fee", type="TH", level=None, locator="k:th")
    h2 = box(0, 0, 100, 10, norm="fee", type="H", level=2, locator="k:h2")
    assert match_candidate(card, [h2, th]) == (th, "exact")
    assert match_candidate(card, [td, h2]) == (h2, "exact")
    # containment and box ties follow the same order
    k, how = match_candidate(box(0, 0, 60, 10, norm="fe"), [box(0, 0, 100, 10, norm="feeschedule", type="Other", locator="k:o"), box(0, 0, 100, 10, norm="feeschedule", type="H", level=1, locator="k:h")])
    assert how == "contains" and k["locator"] == "k:h"
    k, how = match_candidate(box(2, 1, 98, 9, norm="glyph"), [box(0, 0, 100, 10, norm="x", type="Other", locator="k:o"), box(0, 0, 100, 10, norm="y", type="Caption", locator="k:c")])
    assert how == "box" and k["locator"] == "k:c"


def test_rank_then_iou_and_single_candidate_unchanged():
    card = box(0, 0, 100, 10, norm="fee")
    near = box(0, 0, 100, 10, norm="fee", type="P", locator="k:near")
    far = box(0, 0, 200, 10, norm="fee", type="P", locator="k:far")
    unknown = box(0, 0, 100, 10, norm="fee", type="Figure", locator="k:u")
    assert match_candidate(card, [far, near, unknown])[0]["locator"] == "k:near"
    assert match_candidate(card, [far])[0]["locator"] == "k:far"


def test_rank_applies_only_inside_the_iou_window():
    card = box(0, 0, 100, 10, norm="fee")
    th_far = box(200, 0, 300, 10, norm="fee", type="TH", locator="k:th")  # IoU 0.0
    h_near = box(0, 0, 100, 11.11, norm="fee", type="H", level=2, locator="k:h")  # IoU ~0.9
    assert match_candidate(card, [th_far, h_near])[0]["locator"] == "k:h"
    td = box(0, 0, 100, 10.2, norm="fee", type="Other", locator="k:td")  # IoU ~0.98
    p = box(0, 0, 100, 10.5, norm="fee", type="P", locator="k:p")  # IoU ~0.95
    assert match_candidate(card, [td, p])[0]["locator"] == "k:p"


def test_every_rule_3_type_outranks_h_and_p():
    card = box(0, 0, 100, 10, norm="fee")
    h = box(0, 0, 100, 10, norm="fee", type="H", level=2, locator="k:h")
    p = box(0, 0, 100, 10, norm="fee", type="P", locator="k:p")
    for t in ("TH", "Caption", "TOCI", "Lbl", "BlockQuote"):
        rule3 = box(0, 0, 100, 10, norm="fee", type=t, locator=f"k:{t}")
        assert match_candidate(card, [h, p, rule3])[0]["locator"] == f"k:{t}", t


def test_resolve_exact_duplicates_keeps_larger_iou_and_ties_keep_first():
    key = box(0, 0, 100, 10, norm="fee", type="H", level=1, locator="k:1")
    big = box(0, 0, 100, 10, norm="fee")  # IoU 1.0
    small = box(0, 0, 100, 20, norm="fee")  # IoU 0.5
    result = resolve_exact_duplicates([(small, key, "exact"), (big, key, "exact")])
    assert result[0] == (small, None, "none")
    assert result[1] == (big, key, "exact")
    tied_a = box(0, 0, 100, 10, norm="fee")
    tied_b = box(0, 0, 100, 10, norm="fee")
    result = resolve_exact_duplicates([(tied_a, key, "exact"), (tied_b, key, "exact")])
    assert result[0] == (tied_a, key, "exact")
    assert result[1] == (tied_b, None, "none")


def test_tie_window_is_exactly_tie_iou():
    from labels.match import TIE_IOU
    assert TIE_IOU == 0.05
    card = box(0, 0, 100, 10, norm="fee")
    best = box(0, 0, 100, 10, norm="fee", type="P", locator="k:p")  # IoU 1.0
    inside = box(0, 0, 100, 10 / (1 - 0.049), norm="fee", type="TOCI", locator="k:in")  # IoU 0.951
    outside = box(0, 0, 100, 10 / (1 - 0.051), norm="fee", type="TOCI", locator="k:out")  # IoU 0.949
    assert match_candidate(card, [best, inside])[0]["locator"] == "k:in"
    assert match_candidate(card, [best, outside])[0]["locator"] == "k:p"
