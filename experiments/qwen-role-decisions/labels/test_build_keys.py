# labels/test_build_keys.py
import json, tempfile
from pathlib import Path
from labels.build_keys import originals, row_coverage, unmatched_row


def test_originals_excludes_tagger_output_and_adds_word_conversions():
    rows = [{"id": "n01", "kind": "pdf", "path": "/x/n01.pdf", "host": "a", "sha256": "1" * 64},
            {"id": "n09", "kind": "pdf", "path": "/x/n09.pdf", "host": "b", "sha256": "2" * 64},
            {"id": "n34", "kind": "docx", "path": "/x/n34.docx", "host": "c", "sha256": "3" * 64}]
    with tempfile.TemporaryDirectory() as d:
        staged = Path(d) / "labels"; staged.mkdir()
        (staged / "staging.json").write_text(json.dumps([{"id": "n01", "source": "original", "tagged": True}, {"id": "n09", "source": "opendataloader", "tagged": True}]))
        word = Path(d) / "word-pdfs"; word.mkdir(); (word / "n34.pdf").write_bytes(b"x")
        out = originals(rows, word, staged)
    assert [(o["id"], o["source"]) for o in out] == [("n01", "stripped-tree"), ("n34", "word-outline")]
    assert out[1]["original"].endswith("n34.pdf") and out[0]["original"] == "/x/n01.pdf"


def test_unmatched_row_carries_geometry_and_hash_but_no_text():
    card = {"card_id": "n01:7", "document_id": "n01", "page": 3, "x0": 1, "y0": 2, "x1": 3, "y1": 4, "font_pt": 9.5, "weight": "regular",
            "in_table_box": False, "why": ["short"], "existing_tag": None, "text": "Page 4", "norm": "page4", "locator": "n01:7"}
    row = unmatched_row(card)
    assert list(row) == ["card_id", "document_id", "page", "x0", "y0", "x1", "y1", "font_pt", "weight", "in_table_box", "why", "existing_tag", "text_sha256"]
    assert row["card_id"] == "n01:7" and row["page"] == 3 and len(row["text_sha256"]) == 64
    assert "Page 4" not in json.dumps(row) and "page4" not in json.dumps(row)


def test_hosts_count_only_documents_that_wrote_rows():
    usable = [{"id": "n01", "host": "a"}, {"id": "n02", "host": "b"}, {"id": "n03", "host": "a"}, {"id": "n04", "host": "c"}]
    assert row_coverage(usable, {"n01", "n03", "n04"}) == {"documents_with_rows": 3, "hosts": 2}


def test_container_cards_are_not_candidates():
    from labels.build_keys import non_container_cards
    cards = [{"locator": "a", "existing_tag": "Table"}, {"locator": "b", "existing_tag": "TD"}, {"locator": "c", "existing_tag": "L"},
             {"locator": "d", "existing_tag": "LI"}, {"locator": "e", "existing_tag": "TOC"}, {"locator": "f", "existing_tag": None}]
    assert [c["locator"] for c in non_container_cards(cards)] == ["b", "d", "f"]


def test_staging_optional_asks_the_tree_not_staging_json():
    rows = [{"id": "c01", "kind": "pdf", "path": "/x/c01.pdf", "host": "a", "sha256": "1" * 64},
            {"id": "c02", "kind": "pdf", "path": "/x/c02.pdf", "host": "b", "sha256": "2" * 64},
            {"id": "c03", "kind": "docx", "path": "/x/c03.docx", "host": "c", "sha256": "3" * 64},
            {"id": "c04", "kind": "docx", "path": "/x/c04.docx", "host": "d", "sha256": "4" * 64}]
    asked = []

    def has_tree(p):
        asked.append(p)
        return p.name == "c01.pdf"

    with tempfile.TemporaryDirectory() as d:
        word = Path(d) / "word-pdfs"; word.mkdir(); (word / "c03.pdf").write_bytes(b"x")
        out = originals(rows, word, Path(d) / "no-staging-here", staging_optional=True, has_tree=has_tree)
    assert [(o["id"], o["source"]) for o in out] == [("c01", "stripped-tree"), ("c03", "word-outline")]
    assert out[0]["original"] == "/x/c01.pdf" and asked == [Path("/x/c01.pdf"), Path("/x/c02.pdf")]


def test_batches_hold_at_most_the_batch_size():
    from labels.build_keys import batches
    got = batches(list(range(120)), 50)
    assert [len(b) for b in got] == [50, 50, 20] and sum(got, []) == list(range(120))
    assert batches([], 50) == [] and [len(b) for b in batches(list(range(50)), 50)] == [50]


def test_odl_batches_gather_outputs_and_record_a_failed_batch():
    import subprocess
    from labels.build_keys import run_odl_batches
    with tempfile.TemporaryDirectory() as d:
        stripped, tagged, work = Path(d) / "stripped", Path(d) / "tagged", Path(d) / "tagged-batches"
        stripped.mkdir(); tagged.mkdir()
        for i in range(120):
            (stripped / f"c{i:03d}.pdf").write_bytes(b"%PDF")
        calls = []

        def runner(inp, outp):
            calls.append(inp.name)
            if inp.name == "batch-001":
                raise subprocess.CalledProcessError(1, "node")
            outp.mkdir(parents=True, exist_ok=True)
            for f in inp.glob("*.pdf"):
                (outp / f.name).write_bytes(b"tagged")

        failed = run_odl_batches(stripped, tagged, work, 50, runner)
        assert calls == ["batch-000", "batch-001", "batch-002"]
        assert failed == [{"batch": "batch-001", "ids": [f"c{i:03d}" for i in range(50, 100)]}]
        assert len(list(tagged.glob("*.pdf"))) == 70 and not (tagged / "c050.pdf").exists() and (tagged / "c119.pdf").is_file()
        assert all(len(list((stripped / b).glob("*.pdf"))) <= 50 for b in calls)


def test_cli_defaults_follow_out_and_copy_nothing():
    from labels.build_keys import parse_args
    a = parse_args(["--salt", "s", "--out", "out/keys-c3"])
    assert a.word_pdfs == Path("out/keys-c3/word-pdfs") and a.split_copy is None
    a = parse_args(["--salt", "s", "--word-pdfs", "w", "--split-copy", "labels/split-keys-x.json"])
    assert a.out == Path("out/keys") and a.word_pdfs == Path("w") and a.split_copy == Path("labels/split-keys-x.json")


def test_existing_labels_refuse_without_overwrite():
    from labels.build_keys import refuse_existing_labels
    with tempfile.TemporaryDirectory() as d:
        out = Path(d)
        refuse_existing_labels(out, overwrite=False)  # nothing there: fine
        (out / "labels.jsonl").write_text("{}\n")
        try:
            refuse_existing_labels(out, overwrite=False)
        except SystemExit as err:
            assert "labels.jsonl" in str(err) and "--overwrite" in str(err)
        else:
            raise AssertionError("an existing labels.jsonl must stop the build")
        refuse_existing_labels(out, overwrite=True)
    assert parse_args_overwrite()


def parse_args_overwrite():
    from labels.build_keys import parse_args
    return parse_args(["--salt", "s", "--overwrite"]).overwrite and not parse_args(["--salt", "s"]).overwrite


def test_unreadable_original_is_excluded_in_the_tree_check_and_the_run_goes_on():
    rows = [{"id": "c01", "kind": "pdf", "path": "/x/c01.pdf", "host": "a", "sha256": "1" * 64},
            {"id": "c02", "kind": "pdf", "path": "/x/c02.pdf", "host": "b", "sha256": "2" * 64},
            {"id": "c03", "kind": "pdf", "path": "/x/c03.pdf", "host": "c", "sha256": "3" * 64}]

    def has_tree(p):
        if p.name == "c02.pdf":
            raise RuntimeError("Cards: encrypted")
        return True

    excluded = {}
    with tempfile.TemporaryDirectory() as d:
        out = originals(rows, Path(d), Path(d), staging_optional=True, has_tree=has_tree, excluded=excluded)
    assert [o["id"] for o in out] == ["c01", "c03"] and excluded == {"c02": ["unreadable"]}


def test_unreadable_original_is_excluded_in_the_key_step():
    from labels.build_keys import key_document
    doc = {"id": "c01", "original": "/x/c01.pdf"}

    def broken(p, compile=False):
        raise RuntimeError("damaged xref")

    assert key_document(doc, dump=broken, failures=lambda p: set()) == (None, ["unreadable"])
    dump = {"blocks": [{"locator": "d:0", "existing_tag": "H1", "text": "Fees", "page": 0},
                       {"locator": "d:1", "existing_tag": "P", "text": "The fee is due.", "page": 0}]}
    kb, reasons = key_document(doc, dump=lambda p, compile=False: dump, failures=lambda p: set())
    assert [k["locator"] for k in kb] == ["d:0", "d:1"] and reasons == []


def test_documents_in_a_failed_batch_say_so():
    from labels.build_keys import tagger_miss_reason
    failed = [{"batch": "batch-001", "ids": ["c050", "c051"]}]
    assert tagger_miss_reason("c051", failed) == ["tagger-batch-failed"]
    assert tagger_miss_reason("c007", failed) == ["tagger-produced-nothing"]


def test_the_card_path_filters_containers_before_selection():
    import random
    from labels.build_keys import document_cards

    def block(i, tag, text):
        return {"locator": f"t:{i}", "existing_tag": tag, "text": text, "font_pt": 11, "weight": "regular", "page": 0,
                "x0": 0, "y0": i * 12, "x1": 100, "y1": i * 12 + 10, "ancestors": []}

    blocks = [block(0, "Table", "Fee Amount"), block(1, "TH", "Fee"), block(2, "L", "One Two"), block(3, "TOC", "Intro 1"),
              block(4, "H1", "Fees"), block(5, "P", "Short line")]
    cards = document_cards(Path("/x/c01.pdf"), "c01", random.Random(1), dump=lambda p, compile=False: {"blocks": blocks})
    tags = {c["existing_tag"] for c in cards}
    assert not tags & {"Table", "L", "TOC"} and "H1" in tags, tags
    assert all(c["document_id"] == "c01" and c["kind"] == "pdf" and c["card_id"] == c["locator"] and c["norm"] for c in cards)
