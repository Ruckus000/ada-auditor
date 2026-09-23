"""labels.operating_point: the coverage field divides by scored rows.

Regression for request 15 (out/overnight/15-op-r13): the labels file held 10,901
rows (train beside validation) while 1,525 validation rows were scored, so the
reported coverage read 0.0996 where covered/scored is 0.7121. The threshold, the
covered count and the bounds are threshold_rule's and must not move.
"""
from labels.operating_point import operating_point


def _row(i: int, heading: bool) -> dict:
    return {"id": f"s{i}", "document_id": f"d{i % 7}", "label": {"heading": heading, "level": None}}


def _scored(correct_pos: int, correct_neg: int, wrong: int, wrong_score: float, right_score: float = 0.999):
    rows, preds = [], []
    for i in range(correct_pos + correct_neg + wrong):
        heading = i < correct_pos
        rows.append(_row(i, heading))
        wrong_row = i >= correct_pos + correct_neg
        raw = '{"type":"H","level":1,"rule":1}' if heading or wrong_row else '{"type":"P","rule":4}'
        preds.append({"id": f"s{i}", "raw": raw, "decided_by": "model", "score": wrong_score if wrong_row else right_score})
    return rows, preds


def test_coverage_is_over_scored_rows_only():
    rows, preds = _scored(200, 200, 0, 0.5)
    unscored = [_row(1000 + i, False) for i in range(9600)]  # never predicted, like train rows
    got = operating_point("rX", rows + unscored, preds)["point"]
    assert got["covered"] == 400 and got["coverage"] == 1.0  # not 400/10000
    scored_only = operating_point("rX", rows, preds)["point"]
    for key in ("threshold", "covered", "counts", "accuracy", "accuracy_ci", "fp_rate", "fp_ci", "fn_rate"):
        assert got[key] == scored_only[key], key
    assert got["coverage"] != 400 / 10_000


def test_null_scored_rows_leave_the_denominator():
    rows, preds = _scored(200, 200, 0, 0.5)
    preds[1] = {**preds[1], "score": None}  # one abstained row: scored nowhere
    got = operating_point("rX", rows, preds)["point"]
    # 399 scored of 400 label rows; at the chosen threshold every scored row is covered
    assert got["covered"] == 399 and got["coverage"] == 1.0  # not 399/400
