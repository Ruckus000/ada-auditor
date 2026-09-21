import json

from labels.r5_rescore import override_row


def test_model_decided_enumerator_is_overridden():
    pred = {"id": "d:1", "raw": '{"type":"H","level":1,"rule":1}', "decided_by": "model",
            "p_H": 0.998, "score": 0.998, "score_method": "logprob"}
    out = override_row(pred, {"id": "d:1", "text": "VII."})
    assert out == {"id": "d:1", "raw": '{"type":"Lbl","rule":5}', "decided_by": "rule",
                   "p_H": None, "score": 1.0, "score_method": "rule"}


def test_rule_decided_rows_are_never_reopened():
    # An earlier rule (artifact repeat) already decided this card; R5 must not touch it.
    pred = {"id": "d:2", "raw": '{"type":"Artifact","rule":2}', "decided_by": "rule",
            "p_H": None, "score": 1.0, "score_method": "rule"}
    assert override_row(pred, {"id": "d:2", "text": "IV."}) is pred


def test_non_matching_model_rows_pass_through():
    pred = {"id": "d:3", "raw": '{"type":"P","rule":4}', "decided_by": "model",
            "p_H": 0.1, "score": 0.9, "score_method": "logprob"}
    assert override_row(pred, {"id": "d:3", "text": "VII. Budget"}) is pred
    assert override_row(pred, {"id": "d:3", "text": "3.5"}) is pred


def test_card_without_text_is_not_overridden():
    pred = {"id": "d:4", "raw": '{"type":"H","level":2,"rule":1}', "decided_by": "model",
            "score": 0.99, "score_method": "logprob"}
    assert override_row(pred, {"id": "d:4"}) is pred
