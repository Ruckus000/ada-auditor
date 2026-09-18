import hashlib
import io
import json
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

from eligibility_eval import split as ee_split
from eligibility_eval import refusals
from labels.export_answers import (
    HEADING_CARD_PREFIX,
    MissingProvenance,
    card_id_of,
    export,
    label_row,
    latest_per_ask,
    load_dump,
    type_and_level,
)
from labels.manifest import host_of as manifest_host_of

SHA = hashlib.sha256(b"doc-bytes").hexdigest()
CONTENT_SHA = hashlib.sha256(b"upload-bytes").hexdigest()


def _row(card: str, value: str, at: str, *, id_: str | None = None, disposition: str = "decided",
         kind: str = "heading", depends_on: list[str] | None = None, document_id: str = "doc-1",
         client_id: str = "client-1", document_url: str | None = "https://example.test/doc-1.pdf",
         content_sha: str | None = CONTENT_SHA) -> dict:
    row = {
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
    if document_url is not None:
        row["documentUrl"] = document_url
    if content_sha is not None:
        row["contentSha256"] = content_sha
    return row


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
    assert row["client_id"] == row["template_id"] == "example.test"
    assert row["document_sha256"] == CONTENT_SHA


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
        _row("b", "P", "2026-09-01T00:00:00Z", document_id="doc-2", depends_on=[],
             document_url="https://other.example.test/doc-2.pdf",
             content_sha=hashlib.sha256(b"doc-2-bytes").hexdigest()),
    ]
    rows, _ = export(dump)
    assert len(rows) == 2
    assert refusals(rows) == []


# --- Grouping fix: client_id/template_id/document_sha256 come from the upload's own
# URL and hash (labels/manifest.py's host_of), never a fallback to clientId/documentId. ---

def test_client_and_template_id_are_the_keys_manifest_host_of():
    dump = [_row("a", "H1", "2026-09-01T00:00:00Z", depends_on=[],
                 document_url="https://portal.example.gov/doc.pdf")]
    rows, _ = export(dump)
    assert rows[0]["client_id"] == rows[0]["template_id"] == manifest_host_of("https://portal.example.gov/doc.pdf")
    assert rows[0]["client_id"] == "portal.example.gov"


def test_export_and_manifest_host_of_agree_on_www_and_port_variants():
    # Same site, three URL spellings a real upload and a later web harvest might carry.
    variants = [
        "https://example.gov/doc.pdf",
        "https://www.example.gov/doc.pdf",
        "http://example.gov:8080/other.pdf",
    ]
    hosts = set()
    for i, url in enumerate(variants):
        dump = [_row(f"a{i}", "H1", "2026-09-01T00:00:00Z", depends_on=[], document_id=f"doc-{i}",
                     document_url=url, content_sha=hashlib.sha256(url.encode()).hexdigest())]
        rows, _ = export(dump)
        assert rows[0]["client_id"] == rows[0]["template_id"] == manifest_host_of(url)
        hosts.add(rows[0]["client_id"])
    assert hosts == {"example.gov"}  # export and the keys manifest agree: one host, not three


def test_missing_url_or_sha_refuses_naming_answer_ids():
    dump = [
        _row("a", "H1", "2026-09-01T00:00:00Z", depends_on=[], id_="ans-no-url", document_url=None),
        _row("b", "H1", "2026-09-01T00:00:00Z", depends_on=[], id_="ans-no-sha", content_sha=None),
    ]
    try:
        export(dump)
        assert False, "expected MissingProvenance"
    except MissingProvenance as e:
        assert "ans-no-url" in str(e) and "ans-no-sha" in str(e)


def test_missing_provenance_is_checked_even_when_the_row_would_be_excluded():
    # A row that would be excluded for a dependency reason is still refused if it
    # itself has no provenance -- the refusal runs before dependency filtering.
    dump = [_row("child", "H2", "2026-09-01T00:00:00Z", depends_on=["parent"], id_="ans-orphan",
                 document_url=None)]
    try:
        export(dump)
        assert False, "expected MissingProvenance"
    except MissingProvenance as e:
        assert "ans-orphan" in str(e)


def test_cli_refuses_missing_provenance_naming_the_answer_id():
    from labels import export_answers

    with tempfile.TemporaryDirectory() as d:
        dump = Path(d) / "dump.json"
        dump.write_text(json.dumps([
            _row("a", "H1", "2026-09-01T00:00:00Z", depends_on=[], id_="ans-missing", document_url=None),
        ]))
        out = Path(d) / "out.jsonl"
        argv = sys.argv
        sys.argv = ["export_answers", "--dump", str(dump), "--out", str(out)]
        message = None
        try:
            try:
                export_answers.main()
            except SystemExit as e:
                message = str(e)
        finally:
            sys.argv = argv
        assert message is not None and "ans-missing" in message
        assert not out.exists()


def test_a_keys_host_collision_lands_in_the_hosts_existing_split_under_keep():
    """An exported row whose URL's host already appears in the keys labels (scratch
    copies) lands in that host's existing split under split --keep."""
    def key_label(i: int, host: str) -> dict:
        return {
            "id": f"k{i}", "label_source": "planted", "answer_id": f"key-ans-{i}", "actor": "key:planted",
            "client_id": host, "template_id": host,
            "document_sha256": hashlib.sha256(f"keydoc{i}".encode()).hexdigest(),
            "label": {"heading": True, "level": 1},
        }

    keys_rows = [key_label(i, "example.gov") for i in range(3)] + [key_label(i, f"other{i}.gov") for i in range(3, 9)]
    prior = ee_split(keys_rows, salt="grouping-fix-salt")
    membership = {rid: name for name, ids in prior["ids"].items() for rid in ids}
    example_gov_split = membership["k0"]

    # A www variant of the same host: the exported row must still be recognised as
    # the same component as the keys rows above (host_of strips www).
    dump = [_row("a", "H1", "2026-09-01T00:00:00Z", depends_on=[],
                 document_url="https://www.example.gov/new-upload.pdf",
                 content_sha=hashlib.sha256(b"new-upload-bytes").hexdigest())]
    exported, _ = export(dump)
    assert exported[0]["client_id"] == "example.gov"

    combined = keys_rows + exported
    result = ee_split(combined, salt="grouping-fix-salt", keep=prior, prior_rows=keys_rows)
    new_membership = {rid: name for name, ids in result["ids"].items() for rid in ids}
    assert new_membership["a"] == example_gov_split


def test_a_host_seen_first_through_the_product_groups_with_a_later_keys_harvest():
    """The reverse: a host that first appears through the product and is later
    harvested into keys groups identically -- same host string, same component,
    regardless of which side saw the site first."""
    product_url = "http://newsite.gov:80/uploaded.pdf"
    harvested_url = "https://www.newsite.gov/harvested-later.pdf"
    assert manifest_host_of(product_url) == manifest_host_of(harvested_url) == "newsite.gov"

    dump = [_row("a", "H1", "2026-09-01T00:00:00Z", depends_on=[], document_url=product_url,
                 content_sha=hashlib.sha256(b"uploaded-bytes").hexdigest())]
    exported, _ = export(dump)
    key_row = {
        "id": "k0", "label_source": "stripped-tree", "answer_id": "key-ans-0", "actor": "key:stripped-tree",
        "client_id": manifest_host_of(harvested_url), "template_id": manifest_host_of(harvested_url),
        "document_sha256": hashlib.sha256(b"harvested-bytes").hexdigest(),
        "label": {"heading": False, "level": None},
    }
    assert exported[0]["client_id"] == key_row["client_id"]
    combined = exported + [key_row]
    result = ee_split(combined, salt="reverse-salt")
    membership = {rid: name for name, ids in result["ids"].items() for rid in ids}
    assert membership["a"] == membership["k0"]  # one component: the shared host


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
