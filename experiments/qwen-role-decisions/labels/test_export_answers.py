import hashlib
import io
import json
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

from eligibility_eval import refusals
from labels.export_answers import (
    HEADING_CARD_PREFIX,
    card_id_of,
    export,
    label_row,
    latest_per_ask,
    load_dump,
    type_and_level,
)

SHA = hashlib.sha256(b"doc-bytes").hexdigest()


def _row(card: str, value: str, at: str, *, id_: str | None = None, disposition: str = "decided",
         kind: str = "heading", depends_on: list[str] | None = None, document_id: str = "doc-1",
         client_id: str = "client-1") -> dict:
    return {
        "id": id_ or f"ans-{card}-{at}",
        "clientId": client_id,
        "documentId": document_id,
        "inputSha256": SHA,
        "askId": f"{HEADING_CARD_PREFIX}{card}",
        "kind": kind,
        "disposition": disposition,
        "value": value,
        "actor": "reviewer-1",
        "declaredAt": at,
        "target": {
            "page": 0,
            "box": {"x0": 0.0, "y0": 0.0, "x1": 10.0, "y1": 10.0},
            "suggested": {"type": "H", "level": 2, "rule": 1, "score": 0.99},
            **({"dependsOn": depends_on} if depends_on is not None else {}),
        },
    }


def test_type_and_level_splits_the_vocabulary_token():
    assert type_and_level("H1") == ("H", 1)
    assert type_and_level("H6") == ("H", 6)
    assert type_and_level("P") == ("P", None)
    assert type_and_level("BlockQuote") == ("BlockQuote", None)


def test_card_id_of_only_matches_heading_card_asks():
    assert card_id_of("heading-card:doc:3") == "doc:3"
    assert card_id_of("figure:2") is None
    assert card_id_of(None) is None


def test_non_heading_kind_and_non_card_asks_are_never_candidates():
    dump = [
        _row("a", "H1", "2026-09-01T00:00:00Z", kind="figure"),
        {**_row("b", "H1", "2026-09-01T00:00:00Z"), "askId": "heading-ladder:1"},
    ]
    rows, counts = export(dump)
    assert rows == []
    assert counts == {"read": 2, "decided": 0, "latest": 0, "emitted": 0,
                       "excluded": {"dependency-unanswered": 0, "dependency-rejected": 0}}


def test_only_decided_disposition_is_kept():
    dump = [_row("a", "H1", "2026-09-01T00:00:00Z", disposition="declared")]
    rows, counts = export(dump)
    assert rows == []
    assert counts["read"] == 1 and counts["decided"] == 0


def test_accept_matches_the_suggestion():
    dump = [_row("a", "H2", "2026-09-01T00:00:00Z", depends_on=[])]
    rows, _ = export(dump)
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == "a" and row["type"] == "H"
    assert row["label"] == {"heading": True, "level": 2}
    assert row["label_source"] == "human-answer" and row["unsure"] is False
    assert row["note"] == "" and row["answer_id"] == dump[0]["id"]
    assert row["actor"] == "reviewer-1" and row["labelled_at"] == "2026-09-01T00:00:00Z"


def test_correction_of_level_is_the_reviewers_level_not_the_suggestion():
    dump = [_row("a", "H1", "2026-09-01T00:00:00Z", depends_on=[])]  # suggested was H2 (see _row)
    rows, _ = export(dump)
    assert rows[0]["type"] == "H"
    assert rows[0]["label"] == {"heading": True, "level": 1}


def test_rejection_to_p_is_never_silently_h():
    dump = [_row("a", "P", "2026-09-01T00:00:00Z", depends_on=[])]
    rows, _ = export(dump)
    assert rows[0]["type"] == "P"
    assert rows[0]["label"] == {"heading": False, "level": None}


def test_later_answer_supersedes_an_earlier_one():
    dump = [
        _row("a", "P", "2026-09-01T00:00:00Z", id_="ans-1", depends_on=[]),
        _row("a", "H2", "2026-09-02T00:00:00Z", id_="ans-2", depends_on=[]),
    ]
    rows, counts = export(dump)
    assert counts["decided"] == 2 and counts["latest"] == 1
    assert len(rows) == 1
    assert rows[0]["type"] == "H" and rows[0]["answer_id"] == "ans-2"


def test_latest_ties_on_declared_at_break_by_answer_id():
    a = _row("a", "P", "2026-09-01T00:00:00Z", id_="ans-1", depends_on=[])
    b = _row("a", "H2", "2026-09-01T00:00:00Z", id_="ans-2", depends_on=[])
    winner = latest_per_ask([a, b])[0]
    assert winner["id"] == "ans-2"  # "ans-2" > "ans-1"


def test_dependency_unanswered_is_excluded_and_counted():
    dump = [_row("child", "H2", "2026-09-01T00:00:00Z", depends_on=["parent"])]
    rows, counts = export(dump)
    assert rows == []
    assert counts["excluded"]["dependency-unanswered"] == 1
    assert counts["excluded"]["dependency-rejected"] == 0


def test_dependency_rejected_is_excluded_and_counted():
    dump = [
        _row("parent", "P", "2026-09-01T00:00:00Z", depends_on=[]),
        _row("child", "H2", "2026-09-01T00:00:00Z", depends_on=["parent"]),
    ]
    rows, counts = export(dump)
    ids = {r["id"] for r in rows}
    assert ids == {"parent"}  # parent itself is a valid P label; child is excluded
    assert counts["excluded"]["dependency-rejected"] == 1
    assert counts["excluded"]["dependency-unanswered"] == 0


def test_dependency_satisfied_by_an_accepted_ancestor_is_emitted():
    dump = [
        _row("parent", "H1", "2026-09-01T00:00:00Z", depends_on=[]),
        _row("child", "H2", "2026-09-01T00:00:00Z", depends_on=["parent"]),
    ]
    rows, counts = export(dump)
    assert {r["id"] for r in rows} == {"parent", "child"}
    assert counts["excluded"] == {"dependency-unanswered": 0, "dependency-rejected": 0}


def test_dependency_check_uses_the_latest_answer_not_a_stale_one():
    # parent was rejected first, then accepted later -- child must not be excluded.
    dump = [
        _row("parent", "P", "2026-09-01T00:00:00Z", id_="ans-1", depends_on=[]),
        _row("parent", "H1", "2026-09-02T00:00:00Z", id_="ans-2", depends_on=[]),
        _row("child", "H2", "2026-09-03T00:00:00Z", depends_on=["parent"]),
    ]
    rows, counts = export(dump)
    assert {r["id"] for r in rows} == {"parent", "child"}
    assert counts["excluded"]["dependency-rejected"] == 0


def test_a_card_with_no_answer_row_never_becomes_a_label():
    # "child" depends on "parent", and nothing in the dump even mentions "parent" --
    # not proposed, not asked, not answered. No row, no label, and no crash.
    dump = [_row("child", "H2", "2026-09-01T00:00:00Z", depends_on=["parent"])]
    rows, counts = export(dump)
    assert rows == []
    assert counts["excluded"]["dependency-unanswered"] == 1


def test_load_dump_accepts_a_bare_list_or_a_wrapped_object():
    with tempfile.TemporaryDirectory() as d:
        bare = Path(d) / "bare.json"
        bare.write_text("[]")
        assert load_dump(bare) == []
        wrapped = Path(d) / "wrapped.json"
        wrapped.write_text('{"answers": [{"a": 1}]}')
        assert load_dump(wrapped) == [{"a": 1}]


def test_emitted_rows_satisfy_the_eligibility_eval_label_contract():
    dump = [
        _row("a", "H1", "2026-09-01T00:00:00Z", depends_on=[]),
        _row("b", "P", "2026-09-01T00:00:00Z", document_id="doc-2", client_id="client-2", depends_on=[]),
    ]
    rows, _ = export(dump)
    assert len(rows) == 2
    assert refusals(rows) == []


def test_cli_writes_jsonl_and_prints_counts():
    from labels import export_answers

    with tempfile.TemporaryDirectory() as d:
        dump = Path(d) / "dump.json"
        dump.write_text(json.dumps([
            _row("a", "H1", "2026-09-01T00:00:00Z", depends_on=[]),
            _row("b", "H2", "2026-09-01T00:00:00Z", depends_on=["missing"]),
        ]))
        out = Path(d) / "out" / "human-answers.jsonl"
        argv = sys.argv
        sys.argv = ["export_answers", "--dump", str(dump), "--out", str(out)]
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                export_answers.main()
        finally:
            sys.argv = argv
        lines = out.read_text().splitlines()
        assert len(lines) == 1
        counts = json.loads(buf.getvalue().strip())
        assert counts["read"] == 2 and counts["decided"] == 2 and counts["latest"] == 2
        assert counts["emitted"] == 1 and counts["excluded"]["dependency-unanswered"] == 1
