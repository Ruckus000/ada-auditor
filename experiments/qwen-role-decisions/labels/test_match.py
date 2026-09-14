from labels.match import iou, label_for, make_key_row, match_candidate
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
