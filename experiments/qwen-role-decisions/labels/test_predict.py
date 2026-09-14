import json
from labels.predict import post_rules, rule_prediction, prompt_for_row


def test_rule_prediction_and_table_veto():
    assert json.loads(rule_prediction({"text": "12", "repeats_on_pages": 1})) == {"type": "Lbl", "rule": 3}
    assert rule_prediction({"text": "Public Comment", "repeats_on_pages": 1}) is None
    raw = '{"type":"H","level":2,"rule":1}'
    assert post_rules(raw, {"in_table_box": False}) == raw
    assert json.loads(post_rules(raw, {"in_table_box": True}))["type"] == "TH"
    assert post_rules('{"type":"P","rule":4}', {"in_table_box": True}) == '{"type":"P","rule":4}'


def test_prompt_for_row_excludes_cards_own_key_heading():
    card = {"card_id": "c1", "page": 1, "y0": 100.0, "text": "Section One", "font_pt": 12, "weight": "bold"}
    row = {"id": "c1", "document_id": "doc1", "key_locator": "loc-c1"}
    keys = {"doc1": [{"page": 1, "y0": 100.0, "level": 1, "text": "Section One", "locator": "loc-c1"}]}
    prompt = prompt_for_row(card, row, keys)
    assert "Section One" not in prompt.split("Approved headings so far:")[1]
