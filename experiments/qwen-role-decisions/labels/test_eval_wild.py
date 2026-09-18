import io
import json
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

from labels.eval_wild import CURVE, DISCLOSURE, RULE_ACCURACY_LOWER, RULE_FP_UPPER, at_threshold, interval, main as eval_main, report, threshold_rule
from labels.fold_wild import fold, load_inputs

FIXTURE = Path(__file__).parent / "fixtures" / "wild-synthetic"


def _folded() -> tuple[list[dict], list[dict], list[dict]]:
    labels, preds, cards, _ = fold(**load_inputs(consensus=FIXTURE / "consensus.jsonl", sidecars=FIXTURE / "sidecars",
                                                  names=FIXTURE / "names.txt", pdfs=FIXTURE / "pdfs", source=FIXTURE / "source.jsonl"))
    return labels, preds, cards


def _synthetic(correct_pos: int, correct_neg: int, wrong: int, wrong_score: float, right_score: float = 0.999) -> tuple[list[dict], list[dict]]:
    """Labelled rows with predictions: correct ones at ``right_score``, false positives at ``wrong_score``."""
    rows, preds = [], []
    for i in range(correct_pos + correct_neg + wrong):
        heading = i < correct_pos
        rows.append({"id": f"s{i}", "document_id": f"d{i % 7}", "label_source": "claude-consensus", "label": {"heading": heading, "level": 1 if heading else None}})
        wrong_row = i >= correct_pos + correct_neg
        raw = '{"type":"H","level":1,"rule":1}' if heading or wrong_row else '{"type":"P","rule":4}'
        preds.append({"id": f"s{i}", "raw": raw, "decided_by": "model", "score": wrong_score if wrong_row else right_score})
    return rows, preds


def test_interval_is_the_registered_two_sided_exact_bound():
    # The r10 operating point (operating-point-r10.json): 1129 of 1142 right, 3 FP in 773 negatives.
    lo, hi = interval(1129, 1142)
    assert abs(lo - 0.9806124695309983) < 1e-9 and abs(hi - 0.9939252091783799) < 1e-9
    lo, hi = interval(3, 773)
    assert abs(lo - 0.0008010682511476182) < 1e-9 and abs(hi - 0.01129963830394981) < 1e-9
    assert interval(0, 0) == (None, None)


def test_direct_counts_rates_and_bounds_on_the_fixture():
    labels, preds, cards = _folded()
    got = report(labels, preds, cards)
    d = got["direct"]
    assert d["confusion"] == {"tp": 2, "fp": 1, "tn": 3, "fn": 2, "abstain": 0, "parse-failure": 1}
    assert d["n"] == 9 and d["accuracy"] == 5 / 9 and d["accuracy_ci"] == list(interval(5, 9))
    assert d["false_positive_rate"] == 1 / 5 and d["false_positive_rate_ci"] == list(interval(1, 5))
    assert d["false_negative_rate"] == 2 / 4


def test_every_section_is_tagged_and_there_is_no_calibration_column():
    labels, preds, cards = _folded()
    got = report(labels, preds, cards)
    assert DISCLOSURE == "graded against Claude-consensus labels"
    assert got["disclosure"] == DISCLOSURE
    for section in ("direct", "threshold_rule", "coverage_curve", "recall_by_weight", "level_by_depth"):
        assert got[section]["disclosure"] == DISCLOSURE, section
    assert "calibrat" not in json.dumps(got).lower()


def test_coverage_curve_at_the_registered_points():
    labels, preds, cards = _folded()
    curve = report(labels, preds, cards)["coverage_curve"]["points"]
    assert [p["t"] for p in curve] == list(CURVE) == [0.5, 0.9, 0.95, 0.99, 0.9933]
    by_t = {p["t"]: p for p in curve}
    # >= 0.9933: w-0001:0 (H 0.999, tp), w-0001:1 (P 0.9995, tn), w-0001:3 (rule 1.0, tn), w-0002:0 (H 0.9999, fp)
    assert (by_t[0.9933]["covered"], by_t[0.9933]["tp"], by_t[0.9933]["tn"], by_t[0.9933]["fp"], by_t[0.9933]["fn"]) == (4, 1, 2, 1, 0)
    assert by_t[0.9933]["coverage"] == 4 / 9
    # the parse-failure card (score None) is never covered; at 0.5 every scored card is
    assert by_t[0.5]["covered"] == 8
    assert by_t[0.9933]["documents"] == 2 and by_t[0.9933]["documents_clean"] == 1  # w-0002 has the covered FP


def test_threshold_rule_picks_the_lowest_passing_score():
    # 400 right (200 negatives) at 0.999, 20 FP at 0.6: at 0.6 the bound fails, at 0.999 it holds.
    rows, preds = _synthetic(200, 200, 20, 0.6)
    got = threshold_rule(rows, {p["id"]: p for p in preds})
    assert got["threshold"] == 0.999 and got["covered"] == 400 and got["fp"] == 0
    assert got["accuracy_ci"][0] >= RULE_ACCURACY_LOWER and got["fp_rate_ci"][1] <= RULE_FP_UPPER
    assert got["documents_clean"] == 7 and got["documents"] == 7
    # too few negatives for the FP bound: no threshold passes, and the rule says so
    rows, preds = _synthetic(300, 100, 0, 0.6)
    assert threshold_rule(rows, {p["id"]: p for p in preds})["threshold"] is None


def test_at_threshold_counts_only_decisive_scored_rows():
    rows, preds = _synthetic(2, 2, 1, 0.6)
    preds[0] = {**preds[0], "raw": '{"type":"Unsure"}'}
    preds[1] = {**preds[1], "score": None}
    got = at_threshold(rows, {p["id"]: p for p in preds}, 0.5)
    assert got["covered"] == 3 and got["fp"] == 1


def test_recall_by_weight_and_level_by_depth_on_the_fixture():
    labels, preds, cards = _folded()
    got = report(labels, preds, cards)
    w = got["recall_by_weight"]["weights"]
    # positives: w-0001:0 bold tp, w-0001:2 bold tp, w-0001:4 regular fn, w-0002:3 regular fn
    assert w == {"bold": {"positives": 2, "tp": 2, "recall": 1.0}, "regular": {"positives": 2, "tp": 0, "recall": 0.0}}
    depth = got["level_by_depth"]["depths"]
    # TP levels: w-0001:0 label 1 pred 1 exact; w-0001:2 label 3 pred 2 not exact
    assert depth == {"1": {"positives": 2, "tp": 1, "exact": 1}, "2": {"positives": 1, "tp": 0, "exact": 0},
                     "3": {"positives": 1, "tp": 1, "exact": 0}}


def test_cli_prints_the_tagged_report_and_refuses_other_label_sources():
    labels, preds, cards = _folded()
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        for name, rows in (("l.jsonl", labels), ("p.jsonl", preds), ("c.jsonl", cards)):
            (t / name).write_text("".join(json.dumps(r) + "\n" for r in rows))
        args = ["--labels", str(t / "l.jsonl"), "--predictions", str(t / "p.jsonl"), "--cards", str(t / "c.jsonl")]
        buf = io.StringIO()
        with redirect_stdout(buf):
            eval_main(args)
        out = buf.getvalue()
        assert out.splitlines()[0] == DISCLOSURE
        assert json.loads(out.split("\n", 1)[1])["direct"]["confusion"]["tp"] == 2
        (t / "l.jsonl").write_text("".join(json.dumps({**r, "label_source": "claude-audit"}) + "\n" for r in labels))
        try:
            eval_main(args)
        except SystemExit as err:
            assert "claude-consensus" in str(err)
        else:
            raise AssertionError("eval_wild must refuse labels that are not claude-consensus")
