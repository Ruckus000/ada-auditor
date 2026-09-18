import json
from labels.predict import after_h1_from_decisions, is_h1, post_rules, rule_prediction, prompt_for_row


def test_rule_prediction_and_table_veto():
    assert json.loads(rule_prediction({"text": "12", "repeats_on_pages": 1})) == {"type": "Lbl", "rule": 3}
    assert rule_prediction({"text": "Public Comment", "repeats_on_pages": 1}) is None
    raw = '{"type":"H","level":2,"rule":1}'
    assert post_rules(raw, {"in_table_box": False, "ancestors": ["Document"]}) == raw
    assert post_rules(raw, {"in_table_box": True, "ancestors": ["Document"]}) == raw
    assert json.loads(post_rules(raw, {"in_table_box": False, "ancestors": ["TD", "TR", "Table"]}))["type"] == "TH"
    assert post_rules('{"type":"P","rule":4}', {"ancestors": ["Table"]}) == '{"type":"P","rule":4}'


def test_prompt_for_row_excludes_cards_own_key_heading():
    card = {"card_id": "c1", "page": 1, "y0": 100.0, "text": "Section One", "font_pt": 12, "weight": "bold"}
    row = {"id": "c1", "document_id": "doc1", "key_locator": "loc-c1"}
    keys = {"doc1": [{"page": 1, "y0": 100.0, "level": 1, "text": "Section One", "locator": "loc-c1"}]}
    prompt = prompt_for_row(card, row, keys)
    assert "Section One" not in prompt.split("Approved headings so far:")[1]


def test_heading_score_normalises_over_valid_first_tokens():
    import math
    from labels.predict import VALID_TYPES, TYPE_VALUE_OPENS, heading_score, shared_first_tokens

    first = {t: i for i, t in enumerate(VALID_TYPES)}
    assert shared_first_tokens(first) == []
    lp = {i: math.log(1e-9) for i in first.values()}
    lp[first["H"]], lp[first["P"]] = math.log(0.6), math.log(0.2)  # 0.2 of the mass sits outside the valid types
    p_h, score = heading_score(first, lp)
    assert abs(p_h - 0.6 / (0.8 + 6e-9)) < 1e-9 and score == p_h
    lp[first["H"]], lp[first["P"]] = math.log(0.1), math.log(0.3)
    p_h, score = heading_score(first, lp)
    assert abs(p_h - 0.25) < 1e-6 and abs(score - 0.75) < 1e-6
    # two types sharing a first token form one group: counted once in the denominator
    shared = {**first, "TOCI": first["TH"]}
    assert shared_first_tokens(shared) == [["TH", "TOCI"]]
    lp = {i: math.log(1e-12) for i in shared.values()}
    lp[shared["H"]], lp[shared["TH"]] = math.log(0.5), math.log(0.5)
    assert abs(heading_score(shared, lp)[0] - 0.5) < 1e-9
    # ... and if H shares its first token, the whole group's mass counts as H
    with_h = {**first, "Lbl": first["H"]}
    lp = {i: math.log(1e-12) for i in with_h.values()}
    lp[with_h["H"]], lp[with_h["P"]] = math.log(0.9), math.log(0.1)
    assert abs(heading_score(with_h, lp)[0] - 0.9) < 1e-9
    assert TYPE_VALUE_OPENS.search('{"type":"') and TYPE_VALUE_OPENS.search('{"type": "') and not TYPE_VALUE_OPENS.search('{"type":"H')


def test_first_token_ids_rejects_a_token_merged_across_the_boundary():
    from labels.predict import first_token_ids

    def encode(s):  # character tokens, except '"H' is one token
        out, i = [], 0
        while i < len(s):
            if s[i : i + 2] == '"H':
                out.append(1000); i += 2
            else:
                out.append(ord(s[i])); i += 1
        return out

    try:
        first_token_ids(encode)
    except ValueError as e:
        assert "'H'" in str(e)
    else:
        raise AssertionError("expected a merge across the boundary to be refused")
    assert first_token_ids(lambda s: [ord(c) for c in s])["BlockQuote"] == ord("B")


def test_is_h1_reads_only_a_level_1_heading_decision():
    assert is_h1('{"type":"H","level":1,"rule":1}')
    assert is_h1('some preamble {"type":"H","level":1,"rule":1} tail')
    assert not is_h1('{"type":"H","level":2,"rule":1}')
    assert not is_h1('{"type":"P","rule":4}')
    assert not is_h1("no json here")


def test_after_h1_at_inference_follows_the_models_own_prior_decision_not_the_label():
    prev = {"card_id": "c1", "page": 0, "y0": 10.0}
    card = {"card_id": "c2", "page": 0, "y0": 30.0, "text": "Effective January 1", "font_pt": 10, "weight": "regular"}
    doc = [prev, card]
    row = {"id": "c2", "document_id": "doc1"}
    ladder_says_h1 = {"doc1": [{"page": 0, "y0": 10.0, "level": 1, "text": "Annual Report", "locator": "k1"}]}
    # the label ladder calls the card above an H1; the model did not, so the fact is no
    assert after_h1_from_decisions(card, doc, set()) is False
    assert "\nafter_h1: no\n" in prompt_for_row(card, row, ladder_says_h1, after_h1_from_decisions(card, doc, set()))
    # the reverse: no H1 in the ladder at all, but the model called the card above one
    assert after_h1_from_decisions(card, doc, {"c1"}) is True
    assert "\nafter_h1: yes\n" in prompt_for_row(card, row, {"doc1": []}, after_h1_from_decisions(card, doc, {"c1"}))
    # the page's first card is never after an H1, whatever was decided
    assert after_h1_from_decisions(prev, doc, {"c1", "c2"}) is False
    # a decision on another page does not carry over
    assert after_h1_from_decisions({"card_id": "c3", "page": 1, "y0": 30.0}, doc + [{"card_id": "c3", "page": 1, "y0": 30.0}], {"c1"}) is False


def test_own_stack_is_built_from_the_models_prior_heading_decisions():
    from labels.predict import heading_of_decision

    h1 = {"card_id": "d:1", "document_id": "d", "page": 0, "y0": 50.0, "text": "Alpha"}
    body = {"card_id": "d:2", "document_id": "d", "page": 0, "y0": 90.0, "text": "Body"}
    later = {"card_id": "d:3", "document_id": "d", "page": 1, "y0": 40.0, "text": "Beta"}
    assert heading_of_decision('{"type":"P","rule":4}', body) is None
    assert heading_of_decision('{"type":"H","rule":1}', body) is None  # no level, no stack entry
    keys = {"d": [heading_of_decision('{"type":"H","level":1,"rule":1}', h1)]}
    assert keys["d"][0] == {"page": 0, "y0": 50.0, "level": 1, "text": "Alpha", "locator": "d:1"}
    prompt = prompt_for_row(later, {"id": "d:3", "document_id": "d"}, keys)
    assert prompt.split("Approved headings so far:")[1].startswith(" H1 'Alpha'")
    # the card's own decision is never in its own stack
    assert "Alpha" not in prompt_for_row(h1, {"id": "d:1", "document_id": "d"}, keys).split("Approved headings so far:")[1]
