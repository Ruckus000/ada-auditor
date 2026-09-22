import copy
import hashlib
import io
import json
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace

from eligibility_eval import evaluate, read_prediction, refusals
from eligibility_eval import split as ee_split
from labels.fold_wild import ACTOR, CONSENSUS_MIN, fold, load_inputs, main as fold_main, prediction_row

FIXTURE = Path(__file__).parent / "fixtures" / "wild-synthetic"


def _inputs() -> dict:
    return load_inputs(consensus=FIXTURE / "consensus.jsonl", sidecars=FIXTURE / "sidecars", names=FIXTURE / "names.txt",
                       pdfs=FIXTURE / "pdfs", source=FIXTURE / "source.jsonl")


def _fold(**changes) -> tuple:
    kw = {**copy.deepcopy(_inputs()), **changes}
    return fold(**kw)


def _refused(needle: str, **changes) -> None:
    try:
        _fold(**changes)
    except ValueError as err:
        assert needle in str(err), (needle, str(err))
    else:
        raise AssertionError(f"fold must refuse ({needle})")


def test_labels_are_one_row_per_consensus_card_and_pass_the_label_contract():
    labels, _, _, counts = _fold()
    assert [r["id"] for r in labels] == ["w-0001:0", "w-0001:1", "w-0001:2", "w-0001:3", "w-0001:4",
                                         "w-0002:0", "w-0002:1", "w-0002:2", "w-0002:3"]
    assert "w-0001:5" not in {r["id"] for r in labels}  # no consensus: left out
    assert refusals(labels) == []
    assert counts == {"cards": 10, "documents": 2, "consensus_kept": 9, "no_consensus_excluded": 1,
                      "by_type": {"H": 4, "Lbl": 1, "P": 3, "TH": 1}, "by_heading": {"heading": 4, "not_heading": 5}}
    one = labels[0]
    assert one["label_source"] == "claude-consensus" and one["actor"] == ACTOR == "consensus-4judge"
    assert one["document_id"] == "w-0001" and one["type"] == "H" and one["label"] == {"heading": True, "level": 1}
    assert one["votes"] == {"judges": 4, "agree": 4}
    assert isinstance(one["answer_id"], str) and one["answer_id"]


def test_hosts_come_from_the_names_file_through_manifest_host_of_and_sha_from_the_pdf_bytes():
    labels, _, _, _ = _fold()
    by_doc = {r["document_id"]: r for r in labels}
    assert by_doc["w-0001"]["client_id"] == by_doc["w-0001"]["template_id"] == "alpha.invalid"  # www. stripped
    assert by_doc["w-0002"]["client_id"] == by_doc["w-0002"]["template_id"] == "beta.invalid"  # port stripped
    for doc in ("w-0001", "w-0002"):
        assert by_doc[doc]["document_sha256"] == hashlib.sha256((FIXTURE / "pdfs" / f"{doc}.pdf").read_bytes()).hexdigest()


def test_predictions_rebuild_raw_as_predict_writes_it_for_every_sidecar_card():
    _, preds, _, _ = _fold()
    by_id = {p["id"]: p for p in preds}
    assert len(preds) == 10  # every card, the no-consensus one included
    assert by_id["w-0001:0"] == {"id": "w-0001:0", "raw": '{"type":"H","level":1,"rule":1}', "decided_by": "model",
                                 "score": 0.999, "score_method": "logprob"}
    assert by_id["w-0001:3"] == {"id": "w-0001:3", "raw": '{"type":"Lbl","rule":3}', "decided_by": "rule",
                                 "score": 1.0, "score_method": "rule"}
    assert read_prediction(by_id["w-0002:2"]["raw"]) == ("parse-failure", None) and by_id["w-0002:2"]["score"] is None
    assert "p_H" not in by_id["w-0001:0"]  # the sidecar does not carry it; never derived
    assert read_prediction(prediction_row({"card_id": "x", "type": "H", "level": 2, "rule": 1, "score": 0.5,
                                           "decided_by": "model"})["raw"]) == ("heading", 2)


def test_cards_file_carries_the_source_facts_under_the_same_ids():
    labels, _, cards, _ = _fold()
    source = {json.loads(l)["id"]: json.loads(l) for l in (FIXTURE / "source.jsonl").read_text().splitlines()}
    assert [c["id"] for c in cards] == [c["card_id"] for s in _inputs()["sidecars"] for c in s["cards"]]
    assert all(c == source[c["id"]] for c in cards)
    assert {r["id"] for r in labels} <= {c["id"] for c in cards}


def test_folded_rows_evaluate_and_split_unchanged():
    labels, preds, _, _ = _fold()
    got = evaluate(labels, {p["id"]: p["raw"] for p in preds})
    assert got["confusion"] == {"tp": 2, "fp": 1, "tn": 3, "fn": 2, "abstain": 0, "parse-failure": 1}, got["confusion"]
    prior_row = {**labels[0], "id": "p1", "client_id": "gamma.invalid", "template_id": "gamma.invalid", "document_sha256": "c" * 64}
    prior = {"salt": "old", "group_keys": ["document_sha256", "template_id", "client_id"], "ids": {"train": ["p1"], "validation": [], "test": []}}
    result = ee_split([prior_row] + labels, "s", keep=prior, prior_rows=[prior_row], assign_new="validation")
    assert result["ids"]["train"] == ["p1"] and set(result["ids"]["validation"]) == {r["id"] for r in labels}


def test_refuses_inputs_that_would_misstate_the_fold():
    inputs = _inputs()
    rows = inputs["consensus"]
    _refused("no consensus row", consensus=rows[1:])
    _refused("not a sidecar card", consensus=rows + [{**rows[0], "id": "w-0009:0"}])
    _refused("duplicate", consensus=rows + [rows[0]])
    _refused(f"agree >= {CONSENSUS_MIN}", consensus=[{**rows[0], "votes": {"judges": 4, "agree": 2}}] + rows[1:])
    _refused("votes", consensus=[{k: v for k, v in rows[0].items() if k != "votes"}] + rows[1:])
    _refused("agree exceeds judges", consensus=[{**rows[0], "votes": {"judges": 3, "agree": 4}}] + rows[1:])
    _refused("actor", consensus=[{**rows[0], "actor": "claude-coordinator"}] + rows[1:])
    _refused("model fields", consensus=[{**rows[0], "raw": "{}"}] + rows[1:])
    _refused("type", consensus=[{**rows[0], "type": "P"}] + rows[1:])  # P with heading true
    _refused("type", consensus=[{**rows[0], "type": "Heading"}] + rows[1:])
    _refused("a non-heading carries no level", consensus=[rows[0], {**rows[1], "label": {"heading": False, "level": 2}}] + rows[2:])
    _refused("no url", urls={"w-0001": inputs["urls"]["w-0001"]})
    _refused("no pdf", pdf_sha256={"w-0001": inputs["pdf_sha256"]["w-0001"]})
    _refused("source", source=[r for r in inputs["source"] if r["id"] != "w-0002:3"])


def test_cli_writes_three_files_and_prints_counts_and_writes_nothing_when_refused():
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        args = ["--consensus", str(FIXTURE / "consensus.jsonl"), "--sidecars", str(FIXTURE / "sidecars"),
                "--names", str(FIXTURE / "names.txt"), "--pdfs", str(FIXTURE / "pdfs"), "--source", str(FIXTURE / "source.jsonl"),
                "--out-labels", str(t / "l" / "wild-labels.jsonl"), "--out-predictions", str(t / "p" / "pred-wild-r10.jsonl"),
                "--out-cards", str(t / "l" / "wild-cards.jsonl")]
        buf = io.StringIO()
        with redirect_stdout(buf):
            fold_main(args)
        printed = json.loads(buf.getvalue())
        assert printed["consensus_kept"] == 9 and printed["no_consensus_excluded"] == 1 and printed["cards"] == 10
        assert len((t / "l" / "wild-labels.jsonl").read_text().splitlines()) == 9
        assert len((t / "p" / "pred-wild-r10.jsonl").read_text().splitlines()) == 10
        assert len((t / "l" / "wild-cards.jsonl").read_text().splitlines()) == 10
        bad = t / "bad.jsonl"
        bad.write_text("".join(l + "\n" for l in (FIXTURE / "consensus.jsonl").read_text().splitlines()[1:]))
        out = t / "refused"
        refused_args = [a if a != str(FIXTURE / "consensus.jsonl") else str(bad) for a in args]
        refused_args = [a.replace(str(t / "l"), str(out)).replace(str(t / "p"), str(out)) for a in refused_args]
        try:
            fold_main(refused_args)
        except SystemExit as err:
            assert "no consensus row" in str(err)
        else:
            raise AssertionError("the CLI must refuse")
        assert not out.exists()


def test_accepts_the_handover_shapes_with_their_extra_keys():
    # The shapes the judging session writes (confirmed 2026-09-18): full label keys and votes.by on consensus rows;
    # type null, no label keys, on no-consensus rows.
    base = _inputs()
    rows = []
    for r in base["consensus"]:
        by = {"low": r.get("type"), "medium": r.get("type"), "high": r.get("type"), "fable": r.get("type")}
        if r.get("label") is None:
            rows.append({"id": r["id"], "type": None, "label": None, "votes": {**r["votes"], "by": by}, "note": ""})
        else:
            rows.append({"id": r["id"], "answer_id": f"consensus:{r['id']}", "actor": "consensus-4judge",
                         "label_source": "claude-consensus", "type": r["type"], "unsure": False, "label": r["label"],
                         "votes": {**r["votes"], "by": by}, "note": "", "labelled_at": "2026-09-18T12:00:00Z"})
    labels, _, _, counts = _fold(consensus=rows)
    plain, _, _, plain_counts = _fold()
    assert counts == plain_counts
    assert [r["answer_id"] for r in labels][:1] == ["consensus:w-0001:0"]
    assert all(r["votes"].keys() == {"judges", "agree"} for r in labels)  # votes.by is not carried into labels
    assert refusals(labels) == []
    unsure = copy.deepcopy(rows)
    next(r for r in unsure if r.get("label"))["unsure"] = True
    _refused("unsure", consensus=unsure)


def test_opus_kimi_consensus_source_folds_with_two_seat_rules():
    """Registered 2026-09-21: sheet-method consensus rows (actor
    consensus-2seat-tiebreak, label_source opus-kimi-consensus, agree >= 2 of
    <= 3 judges) fold; the four-judge rules still govern claude-consensus."""
    inputs = _inputs()
    rows = copy.deepcopy(inputs["consensus"])
    for r in rows:
        if r.get("label") is not None:
            r["label_source"] = "opus-kimi-consensus"
            r["actor"] = "consensus-2seat-tiebreak"
            r["votes"] = {"judges": 2, "agree": 2}
    labels, _, _, counts = _fold(consensus=rows)
    assert counts["consensus_kept"] == 9
    assert all(r["label_source"] == "opus-kimi-consensus" for r in labels)
    assert all(r["actor"] == "consensus-2seat-tiebreak" for r in labels)
    assert all(r["votes"] == {"judges": 2, "agree": 2} for r in labels)
    assert refusals(labels) == []
    # a one-vote agreement is not a consensus under this source either
    bad = copy.deepcopy(rows)
    for r in bad:
        if r.get("label") is not None:
            r["votes"] = {"judges": 2, "agree": 1}
    _refused("agree >= 2", consensus=bad)
    # and three agreeing judges of four is fine for the old source, but a
    # 2-of-2 row under claude-consensus is still refused
    bad2 = copy.deepcopy(inputs["consensus"])
    for r in bad2:
        if r.get("label") is not None:
            r["votes"] = {"judges": 2, "agree": 2}
    _refused("agree >= 3", consensus=bad2)


def test_opus_quick_card_rejudge_source_folds_as_one_judge():
    """Registered 2026-09-22 before the run: the page-sheet bias re-judge's rows
    (actor opus-quick-card, one judge card by card, agree 1 of 1) fold; a second
    judge or a different actor under this source is refused."""
    inputs = _inputs()
    rows = copy.deepcopy(inputs["consensus"])
    for r in rows:
        if r.get("label") is not None:
            r["label_source"] = "opus-quick-card-rejudge"
            r["actor"] = "opus-quick-card"
            r["votes"] = {"judges": 1, "agree": 1}
    labels, _, _, counts = _fold(consensus=rows)
    assert counts["consensus_kept"] == 9
    assert all(r["label_source"] == "opus-quick-card-rejudge" for r in labels)
    assert refusals(labels) == []
    two = copy.deepcopy(rows)
    for r in two:
        if r.get("label") is not None:
            r["votes"] = {"judges": 2, "agree": 2}
    _refused("judges exceeds 1", consensus=two)
    wrong_actor = copy.deepcopy(rows)
    next(r for r in wrong_actor if r.get("label") is not None)["actor"] = "consensus-2seat-tiebreak"
    _refused("is not 'opus-quick-card'", consensus=wrong_actor)
