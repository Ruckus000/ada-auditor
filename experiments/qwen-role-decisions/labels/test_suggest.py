from labels.suggest import CARD_KEYS, LOCATOR_KEYS, SIDECAR_KEYS, assemble_sidecar

THRESHOLD = 0.9933


def _card(n: int, page: int, y0: float) -> dict:
    return {"card_id": f"doc:{n}", "document_id": "doc", "page": page, "x0": 10.0, "y0": y0, "x1": 200.0, "y1": y0 + 12,
            "text": f"card {n}", "font_pt": 11, "ancestors": ["Document"]}


CARDS = [_card(3, 1, 20.0), _card(1, 0, 10.0), _card(2, 0, 40.0), _card(4, 1, 60.0), _card(5, 1, 80.0)]
PREDICTIONS = [
    {"id": "doc:1", "raw": '{"type":"H","level":1,"rule":1}', "decided_by": "model", "p_H": 0.9933, "score": THRESHOLD, "score_method": "logprob"},
    {"id": "doc:2", "raw": '{"type":"P","rule":4}', "decided_by": "model", "p_H": 0.0068, "score": 0.9932, "score_method": "logprob"},
    {"id": "doc:3", "raw": '{"type":"Artifact","rule":2}', "decided_by": "rule", "p_H": None, "score": 1.0, "score_method": "rule"},
    {"id": "doc:4", "raw": 'noise {"type":"H","level":2,"rule":1}', "decided_by": "model", "p_H": 0.7, "score": 0.7, "score_method": "logprob"},
    {"id": "doc:5", "raw": "no json", "decided_by": "model", "p_H": None, "score": None, "score_method": "logprob_missing"},
]


def _by_id(sidecar: dict) -> dict:
    return {c["card_id"]: c for c in sidecar["cards"]}


def test_sidecar_has_the_exact_shape_and_key_set():
    s = assemble_sidecar("doc", THRESHOLD, CARDS, PREDICTIONS)
    assert set(s) == set(SIDECAR_KEYS) == {"document", "threshold", "cards"}
    assert s["document"] == "doc" and s["threshold"] == THRESHOLD
    assert [c["card_id"] for c in s["cards"]] == ["doc:1", "doc:2", "doc:3", "doc:4", "doc:5"]  # reading order
    for c in s["cards"]:
        assert set(c) == set(CARD_KEYS) == {"card_id", "locator", "text", "type", "level", "rule", "score", "decided_by", "proposed"}
        assert set(c["locator"]) == set(LOCATOR_KEYS) == {"page", "x0", "y0", "x1", "y1"}
    one = _by_id(s)["doc:1"]
    assert one["locator"] == {"page": 0, "x0": 10.0, "y0": 10.0, "x1": 200.0, "y1": 22.0}
    assert (one["text"], one["type"], one["level"], one["rule"], one["decided_by"]) == ("card 1", "H", 1, 1, "model")


def test_proposed_at_the_threshold_boundary():
    s = _by_id(assemble_sidecar("doc", THRESHOLD, CARDS, PREDICTIONS))
    assert s["doc:1"]["proposed"] is True  # score exactly at the threshold
    assert s["doc:2"]["proposed"] is False  # just below it


def test_abstained_rows_are_present_and_not_proposed():
    s = _by_id(assemble_sidecar("doc", THRESHOLD, CARDS, PREDICTIONS))
    assert s["doc:4"]["proposed"] is False and (s["doc:4"]["type"], s["doc:4"]["level"]) == ("H", 2)
    # no score (logprob missing) and no parsable JSON: still a row, never proposed
    assert s["doc:5"]["proposed"] is False and s["doc:5"]["score"] is None
    assert (s["doc:5"]["type"], s["doc:5"]["level"], s["doc:5"]["rule"]) == (None, None, None)


def test_rule_decided_rows_are_proposed_with_score_one():
    s = _by_id(assemble_sidecar("doc", THRESHOLD, CARDS, PREDICTIONS))
    assert s["doc:3"] == {**s["doc:3"], "type": "Artifact", "rule": 2, "level": None, "score": 1.0, "decided_by": "rule", "proposed": True}


def test_a_card_without_a_prediction_or_a_prediction_without_a_card_is_refused():
    for cards, preds in ((CARDS, PREDICTIONS[:-1]), (CARDS[:-1], PREDICTIONS)):
        try:
            assemble_sidecar("doc", THRESHOLD, cards, preds)
        except ValueError:
            continue
        raise AssertionError("expected a mismatch between cards and predictions to be refused")
