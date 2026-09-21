import json
import tempfile
from collections import Counter
from pathlib import Path

from labels.measure_run_in_split import FALSE_SPLIT_MAX, freeze, key_counter, main, measure_document, tagged_copies, validation_docs, wild_docs
from labels.split_heads import split_enumerated_heads, split_run_in_heads


def blk(loc, text, first, lines, tag="P", pt=12, y0=360.0, fx1=None):
    """A 376-wide block (x0 144, x1 520); fx1 313.2 ends the first line at 45 %, 444.8 at 80 %."""
    b = {"locator": loc, "existing_tag": tag, "text": text, "first_line": first, "line_count": lines,
         "font_pt": pt, "weight": "regular", "ancestors": ["Document"], "in_table_box": False,
         "page": 0, "x0": 144.0, "y0": y0, "x1": 520.0, "y1": y0 + 40.0}
    if fx1 is not None:
        b["first_line_x1"] = fx1
    return b


def test_validation_docs_reads_only_the_validation_ids():
    split = {"ids": {"train": ["d1:0"], "validation": ["d2:0", "d2:1", "d3:4"], "test": ["d4:0"]}}
    assert validation_docs(split) == ["d2", "d3"]  # test ids are never read


def test_wild_docs_finds_sidecar_documents_two_levels_down():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "wild" / "c3-0001").mkdir(parents=True)
        (root / "wild" / "c3-0001" / "sidecar.json").write_text("{}")
        (root / "wild-v2" / "c3-0002").mkdir(parents=True)
        (root / "wild-v2" / "c3-0002" / "sidecar.json").write_text("{}")
        (root / "plain").mkdir()  # a bare suggest work dir is not a wild run
        (root / "plain" / "sidecar.json").write_text("{}")
        assert wild_docs(root) == {"c3-0001", "c3-0002"}
        assert wild_docs(root / "missing") == set()


def test_measure_document_recovers_a_merged_run_in_head_and_counts_false_splits():
    merged = blk("d:9", "Plant Selection Native species thrive on this site.", "Plant Selection", 4, fx1=313.2)
    not_a_head = blk("d:10", "Short Line but the rest of the paragraph runs on and on.", "Short Line", 3, fx1=313.2)
    whole = blk("d:11", "Already Own Heading", "Already Own Heading", 1, tag="H2")
    keys = key_counter([{"text": "Plant Selection"}, {"text": "Already Own Heading"}])
    off, n0 = split_enumerated_heads([merged, not_a_head, whole])
    assert n0 == 0
    on, n1 = split_run_in_heads(off, 0.6)
    assert n1 == 2
    m = measure_document(off, on, keys)
    # "Plant Selection" had no own card off and is a head card on; "Already Own Heading" was never lost
    assert (m["lost"], m["recovered"]) == (1, 1)
    # "Short Line" splits but matches no key heading: one false split of two splits
    assert (m["splits"], m["false_splits"]) == (2, 1)


def test_measure_document_no_recovery_when_the_first_line_ends_past_the_width():
    merged = blk("d:9", "Plant Selection Native species thrive on this site.", "Plant Selection", 4, fx1=444.8)
    keys = key_counter([{"text": "Plant Selection"}])
    off, _ = split_enumerated_heads([merged])
    on, n = split_run_in_heads(off, 0.6)
    assert n == 0
    m = measure_document(off, on, keys)
    assert m == {"lost": 1, "recovered": 0, "splits": 0, "false_splits": 0}


def test_measure_document_counts_repeated_heading_texts_as_a_multiset():
    a = blk("d:9", "Summary First body paragraph text goes here.", "Summary", 3, fx1=250.0)
    b = blk("d:20", "Summary Second body paragraph text goes here.", "Summary", 3, y0=560.0, fx1=250.0)
    keys = key_counter([{"text": "Summary"}, {"text": "Summary"}])
    off, _ = split_enumerated_heads([a, b])
    on, n = split_run_in_heads(off, 0.6)
    assert n == 2
    m = measure_document(off, on, keys)
    assert (m["lost"], m["recovered"], m["false_splits"]) == (2, 2, 0)


def test_enumerated_heads_in_the_baseline_are_not_counted_as_run_in_splits():
    enum = blk("d:9", "B. Scope Every widget shall be counted twice.", "B. Scope", 3, tag="LI", fx1=250.0)
    keys = key_counter([{"text": "B. Scope"}])
    off, n0 = split_enumerated_heads([enum])
    assert n0 == 1  # the baseline already recovers it: not lost, not a run-in split
    on, _ = split_run_in_heads(off, 0.6)
    m = measure_document(off, on, keys)
    assert m == {"lost": 0, "recovered": 0, "splits": 0, "false_splits": 0}


def test_freeze_adopts_the_highest_recall_under_the_cap_ties_smaller():
    table = {0.5: {"false_split_rate": 0.004, "recall": 0.80},
             0.6: {"false_split_rate": 0.002, "recall": 0.80},
             0.7: {"false_split_rate": 0.001, "recall": 0.70}}
    assert freeze(table)["width"] == 0.5  # 0.5 and 0.6 tie on recall; the smaller wins
    table[0.5]["false_split_rate"] = FALSE_SPLIT_MAX + 1e-9  # over the cap: excluded
    assert freeze(table)["width"] == 0.6
    table[0.6]["recall"] = 0.9
    assert freeze(table)["width"] == 0.6  # highest recall among the capped
    for m in table.values():
        m["false_split_rate"] = 0.9
    assert freeze(table)["width"] is None


def test_freeze_with_nothing_lost_takes_the_smallest_capped_width():
    table = {w: {"false_split_rate": 0.0, "recall": None} for w in (0.5, 0.6, 0.7)}
    assert freeze(table)["width"] == 0.5


def test_main_measures_a_synthetic_keys_build():
    """End-to-end over a tiny keys build: one tagged PDF with a merged run-in, plus
    key-headings.json and a split manifest. Compiles and runs Cards.java."""
    from labels.test_pdf_cards import _tagged_pdf
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        keys = root / "keys"
        (keys / "tagged").mkdir(parents=True)
        _tagged_pdf(keys / "tagged" / "d1.pdf", ["Scope", "Every widget shall be counted", "twice over here."])
        (keys / "key-headings.json").write_text(json.dumps({"d1": [{"page": 0, "y0": 700, "level": 2, "text": "Scope"}]}))
        split = root / "split.json"
        split.write_text(json.dumps({"ids": {"train": [], "validation": ["d1:0"], "test": ["d9:0"]}}))
        out = root / "result.json"
        main(["--keys-dir", str(keys), "--split", str(split), "--wild-root", str(root / "no-wild"), "--out", str(out)])
        got = json.loads(out.read_text())
    row = got["per_document"][0]
    assert got["documents"]["measured"] == 1 and got["documents"]["excluded"] == {}
    assert row["per_width"]["0.6"]["recovered"] == 1 and row["per_width"]["0.6"]["lost"] == 1
    assert got["per_width"]["0.6"]["recall"] == 1.0
    assert got["freeze"]["width"] == 0.5  # all widths recover; the smallest capped width wins
    assert len(got["training_keys_sha256"]) == 64


def test_main_refuses_to_overwrite_and_refuses_wild_documents():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        keys = root / "keys"
        (keys / "tagged").mkdir(parents=True)
        (keys / "key-headings.json").write_text(json.dumps({"d1": [], "d2": []}))
        split = root / "split.json"
        split.write_text(json.dumps({"ids": {"train": [], "validation": ["d1:0", "d2:0"], "test": []}}))
        wild = root / "suggest"
        (wild / "wild" / "d2").mkdir(parents=True)
        (wild / "wild" / "d2" / "sidecar.json").write_text("{}")
        out = root / "result.json"
        # d1 has no tagged copy -> excluded; d2 is wild -> excluded before measurement
        main(["--keys-dir", str(keys), "--split", str(split), "--wild-root", str(wild), "--out", str(out)])
        got = json.loads(out.read_text())
        assert got["documents"]["excluded_wild"] == ["d2"] and got["documents"]["measured"] == 0
        assert got["documents"]["excluded"] == {"d1": "no-tagged-copy"}
        try:
            main(["--keys-dir", str(keys), "--split", str(split), "--wild-root", str(wild), "--out", str(out)])
        except SystemExit:
            return
        raise AssertionError("an existing --out was overwritten without --overwrite")


def test_tagged_copies_resolve_through_the_per_cohort_builds():
    """keys-all-4 has no tagged/ of its own: each document's copy is in the build whose
    manifest lists it; a document in no source raises rather than being skipped."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        for build, ids in (("keys-c3", ["c3-1"]), ("keys-c6", ["c6-1", "c6-2"])):
            (root / build / "tagged").mkdir(parents=True)
            (root / build / "manifest.json").write_text(json.dumps([{"id": i, "kind": "pdf"} for i in ids]))
        sources = [f"{root / b}:{root / b / 'manifest.json'}" for b in ("keys-c3", "keys-c6")]
        got = tagged_copies(root / "keys-all-4", sources, ["c3-1", "c6-2"])
        assert got == {"c3-1": root / "keys-c3" / "tagged" / "c3-1.pdf",
                       "c6-2": root / "keys-c6" / "tagged" / "c6-2.pdf"}
        try:
            tagged_copies(root / "keys-all-4", sources, ["c3-1", "nowhere"])
        except ValueError:
            pass
        else:
            raise AssertionError("a document in no source was not refused")


def test_no_source_and_no_tagged_dir_refuses_instead_of_excluding_everything():
    with tempfile.TemporaryDirectory() as d:
        try:
            tagged_copies(Path(d) / "keys-all-4", [], ["d1"])
        except SystemExit as e:
            assert "--source" in str(e)
        else:
            raise AssertionError("a keys dir without tagged/ was accepted")
