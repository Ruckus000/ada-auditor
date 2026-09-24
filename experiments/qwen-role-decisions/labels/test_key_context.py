import json
import tempfile
from pathlib import Path

from labels.key_context import original_of, parse_source, resolve_sources


def _source(root: Path, name: str, entries: list[dict]) -> tuple[Path, Path]:
    build = root / name
    build.mkdir()
    manifest = root / f"{name}-manifest.json"
    manifest.write_text(json.dumps(entries))
    return build, manifest, build / "word-pdfs"


def test_each_document_resolves_to_the_one_build_whose_manifest_lists_it():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        a = _source(root, "a", [{"id": "n01", "kind": "pdf", "path": "/x/n01.pdf"}])
        b = _source(root, "b", [{"id": "c3-0001", "kind": "docx", "path": "/y/c3-0001.docx"}])
        got = resolve_sources({"n01", "c3-0001"}, [a, b])
        assert got["n01"][0] == a and got["n01"][1]["path"] == "/x/n01.pdf"
        assert got["c3-0001"][0] == b


def test_an_id_in_no_source_raises():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        a = _source(root, "a", [{"id": "n01", "kind": "pdf", "path": "/x/n01.pdf"}])
        try:
            resolve_sources({"n01", "missing"}, [a])
        except ValueError as e:
            assert "missing" in str(e)
        else:
            raise AssertionError("expected ValueError")


def test_an_id_in_two_sources_raises():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        a = _source(root, "a", [{"id": "n01", "kind": "pdf", "path": "/x/n01.pdf"}])
        b = _source(root, "b", [{"id": "n01", "kind": "pdf", "path": "/y/n01.pdf"}])
        try:
            resolve_sources({"n01"}, [a, b])
        except ValueError as e:
            assert "n01" in str(e)
        else:
            raise AssertionError("expected ValueError")


def test_original_is_the_manifest_path_for_pdf_and_the_build_word_pdf_for_docx():
    build = Path("/b")
    assert original_of(build, {"id": "n01", "kind": "pdf", "path": "/x/n01.pdf"}) == Path("/x/n01.pdf")
    assert original_of(build, {"id": "w1", "kind": "docx", "path": "/x/w1.docx"}) == Path("/b/word-pdfs/w1.pdf")


def test_parse_source_splits_build_dir_and_manifest():
    assert parse_source("out/keys-c3:out/keys-c3/manifest.json") == (Path("out/keys-c3"), Path("out/keys-c3/manifest.json"), Path("out/keys-c3/word-pdfs"))


def test_parse_source_takes_an_optional_word_pdfs_dir_for_builds_that_reused_another_builds_conversions():
    build, manifest, word = parse_source("out/keys-b4r2:out/labels/manifest.json:out/keys/word-pdfs")
    assert (build, manifest, word) == (Path("out/keys-b4r2"), Path("out/labels/manifest.json"), Path("out/keys/word-pdfs"))
    assert original_of(build, {"id": "w1", "kind": "docx", "path": "/x/w1.docx"}, word) == Path("out/keys/word-pdfs/w1.pdf")


def test_stripped_copy_is_found_flat_or_in_the_one_odl_batch_dir_it_was_moved_to():
    from labels.key_context import stripped_of
    with tempfile.TemporaryDirectory() as d:
        build = Path(d)
        (build / "stripped").mkdir()
        (build / "stripped" / "n01.pdf").write_bytes(b"%PDF-")
        (build / "stripped" / "batch-001").mkdir()
        (build / "stripped" / "batch-001" / "c3-0008.pdf").write_bytes(b"%PDF-")
        assert stripped_of(build, "n01") == build / "stripped" / "n01.pdf"
        assert stripped_of(build, "c3-0008") == build / "stripped" / "batch-001" / "c3-0008.pdf"
        for bad in ("absent",):
            try:
                stripped_of(build, bad)
            except FileNotFoundError:
                pass
            else:
                raise AssertionError("expected FileNotFoundError")
        (build / "stripped" / "batch-000").mkdir()
        (build / "stripped" / "batch-000" / "c3-0008.pdf").write_bytes(b"%PDF-")
        try:
            stripped_of(build, "c3-0008")
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError for two copies")


def _block(loc, text, page, y0, font=10.0):
    return {"locator": loc, "text": text, "font_pt": font, "weight": "regular", "existing_tag": None,
            "page": page, "x0": 50.0, "y0": y0, "x1": 300.0, "y1": y0 + font}


def test_context_cards_carry_the_band_side_and_the_documents_body_size():
    from labels.key_context import context_cards
    blocks = [_block("d:0", "Title", 0, 50.0, font=18.0), _block("d:1", "Body one", 0, 400.0),
              _block("d:2", "Body two", 0, 420.0), _block("d:3", "Page 1", 0, 740.0, font=8.0)]
    cards = {c["locator"]: c for c in context_cards(blocks, "d", {"d:0", "d:1", "d:3"})}
    assert cards["d:0"]["margin_band"] == "top" and cards["d:0"]["in_margin_band"] is True
    assert cards["d:1"]["margin_band"] is None and cards["d:1"]["in_margin_band"] is False
    assert cards["d:3"]["margin_band"] == "bottom"
    # the median over every card of the document, not only the wanted ones
    assert {c["body_font_pt"] for c in cards.values()} == {10.0}
