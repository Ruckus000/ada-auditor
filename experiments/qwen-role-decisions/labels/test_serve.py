# labels/test_serve.py
import random
from labels.serve import State, allowed_levels, apply_heading, make_row, next_card, order_cards
from eligibility_eval import refusals


def test_allowed_levels_forbid_skips():
    assert allowed_levels([]) == [1]
    assert allowed_levels([1]) == [1, 2]
    assert allowed_levels([1, 2, 3]) == [1, 2, 3, 4]
    assert apply_heading([1, 2, 3], 2) == [1, 2]
    assert apply_heading([1], 2) == [1, 2]


def test_order_cards_shuffles_documents_but_keeps_reading_order():
    cards = [{"card_id": "a:2", "document_id": "a", "page": 0, "y0": 500}, {"card_id": "a:1", "document_id": "a", "page": 0, "y0": 700},
             {"card_id": "b:p3", "document_id": "b", "index": 3}, {"card_id": "b:p1", "document_id": "b", "index": 1}]
    manifest = [{"id": "a", "kind": "pdf"}, {"id": "b", "kind": "docx"}]
    out = [c["card_id"] for c in order_cards(cards, manifest, random.Random(3))]
    assert out.index("a:1") < out.index("a:2") and out.index("b:p1") < out.index("b:p3")
    assert next_card(order_cards(cards, manifest, random.Random(3)), {"a:1", "a:2", "b:p1", "b:p3"}) is None


def test_make_row_passes_the_evaluator_contract_and_hides_text():
    card = {"card_id": "n34:p7", "document_id": "n34", "kind": "docx", "text": "Public Comment", "prev": "x", "next": "y",
            "existing_tag": "P", "why": ["short"], "repeats_on_pages": 1, "bold": True, "size_pt": 14.0}
    doc = {"id": "n34", "sha256": "a" * 64, "host": "fnsb.gov"}
    row = make_row(card, doc, "reviewer-a", "H", 2)
    assert refusals([row]) == []
    assert row["label"] == {"heading": True, "level": 2} and row["type"] == "H"
    assert "text" not in row and len(row["text_sha256"]) == 64
    assert row["client_id"] == row["template_id"] == "fnsb.gov" and row["document_stem"] == "n34"
    p = make_row(card, doc, "reviewer-a", "Caption", None)
    assert p["label"] == {"heading": False, "level": None} and refusals([p]) == []
    u = make_row(card, doc, "reviewer-a", "Unsure", None)
    assert u["unsure"] is True


def test_sample_mode_waives_the_skip_refusal_and_keeps_reading_order():
    cards = [{"card_id": "a:2", "document_id": "a", "page": 0, "y0": 500, "text": "t", "kind": "pdf"},
             {"card_id": "a:1", "document_id": "a", "page": 0, "y0": 700, "text": "t", "kind": "pdf"},
             {"card_id": "b:p3", "document_id": "b", "index": 3, "text": "t", "kind": "docx"},
             {"card_id": "b:p1", "document_id": "b", "index": 1, "text": "t", "kind": "docx"}]
    manifest = [{"id": "a", "kind": "pdf", "sha256": "a" * 64, "host": "a.gov"},
                {"id": "b", "kind": "docx", "sha256": "b" * 64, "host": "b.gov"}]

    sample_state = State(cards, manifest, "reviewer-b", sample=4)
    assert sample_state.allowed_levels_for("a") == [1, 2, 3, 4, 5, 6]
    ids = [c["card_id"] for c in sample_state.cards if c["document_id"] == "a"]
    assert ids == sorted(ids, key=lambda cid: cid) or ids.index("a:1") < ids.index("a:2")

    normal_state = State(cards, manifest, "reviewer-a", sample=None)
    assert normal_state.allowed_levels_for("a") == [1]
