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
