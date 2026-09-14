import json
from labels.sft import emit, prompt_for, stack_before, target_for


def test_stack_before_is_the_approved_ladder_in_reading_order():
    hs = [{"page": 0, "y0": 10, "level": 1, "text": "Title"}, {"page": 0, "y0": 50, "level": 2, "text": "Logging"},
          {"page": 1, "y0": 20, "level": 3, "text": "Paper"}, {"page": 1, "y0": 60, "level": 2, "text": "Storage"}]
    assert [s["text"] for s in stack_before({"page": 1, "y0": 30}, hs)] == ["Title", "Logging", "Paper"]
    assert [s["text"] for s in stack_before({"page": 1, "y0": 70}, hs)] == ["Title", "Storage"]
    assert stack_before({"page": 0, "y0": 5}, hs) == []


def test_stack_before_excludes_the_cards_own_key_heading():
    hs = [{"page": 0, "y0": 100.0, "level": 2, "text": "Logging", "locator": "k:7"},
          {"page": 0, "y0": 90.3, "level": 1, "text": "Above"}]
    card = {"page": 0, "y0": 100.3}
    assert [s["text"] for s in stack_before(card, hs, own_locator="k:7")] == ["Above"]
    assert [s["text"] for s in stack_before(card, hs, own_locator=None)] == ["Above"]


def test_targets_and_emit_hold_back_other_and_rule_decided():
    assert json.loads(target_for({"type": "H", "label": {"level": 2}})) == {"type": "H", "level": 2, "rule": 1}
    assert json.loads(target_for({"type": "TH", "label": {}})) == {"type": "TH", "rule": 3}
    rows = [{"id": "a:1", "document_id": "a", "type": "H", "label": {"heading": True, "level": 1}},
            {"id": "a:2", "document_id": "a", "type": "Other", "label": {"heading": False, "level": None}},
            {"id": "a:3", "document_id": "a", "type": "Lbl", "label": {"heading": False, "level": None}},
            {"id": "a:4", "document_id": "a", "type": "P", "label": {"heading": False, "level": None}}]
    cards = {"a:1": {"text": "Title", "page": 0, "y0": 10, "repeats_on_pages": 1}, "a:2": {"text": "cell", "page": 0, "y0": 20},
             "a:3": {"text": "3", "page": 0, "y0": 30}, "a:4": {"text": "Body", "page": 0, "y0": 40, "repeats_on_pages": 1}}
    out, held = emit(rows, cards, {"a": []}, lambda c: "/img.png", {"a:1", "a:2", "a:3"})
    assert len(out) == 1 and held == {"other": 1, "rule_decided": 1}
    assert "Approved headings so far: none" in out[0]["messages"][0]["content"]
    assert json.loads(out[0]["messages"][1]["content"])["type"] == "H"
