# labels/test_manifest.py
import hashlib, json, tempfile
from pathlib import Path
from labels.manifest import build_manifest, host_of


def test_host_of_strips_scheme_and_www():
    assert host_of("https://www.fnsb.gov/DocumentCenter/View/1308") == "fnsb.gov"
    assert host_of("http://policies.osu.edu/x.pdf") == "policies.osu.edu"
    assert host_of("https://www.acf.gov:443/sites/x.docx") == "acf.gov"  # a port is not another host (S28)


def test_build_manifest_reads_both_provenance_files_and_hashes_bytes():
    with tempfile.TemporaryDirectory() as d:
        corpus = Path(d)
        (corpus / "n01.pdf").write_bytes(b"%PDF-1.7 fake")
        (corpus / "r27.docx").write_bytes(b"PK fake")
        (corpus / "real-names.txt").write_text("# comment\nr27.docx\thttps://policies.northwestern.edu/docs/t.docx\n")
        (corpus / "new-names.txt").write_text("n01.pdf https://www.fnsb.gov/DocumentCenter/View/1\n")
        rows = build_manifest(corpus)
    assert [r["id"] for r in rows] == ["n01", "r27"]
    assert rows[0]["kind"] == "pdf" and rows[0]["host"] == "fnsb.gov"
    assert rows[1]["kind"] == "docx" and rows[1]["host"] == "policies.northwestern.edu"
    assert rows[0]["sha256"] == hashlib.sha256(b"%PDF-1.7 fake").hexdigest()


def test_build_manifest_refuses_a_file_without_provenance():
    with tempfile.TemporaryDirectory() as d:
        corpus = Path(d)
        (corpus / "n02.pdf").write_bytes(b"x")
        (corpus / "real-names.txt").write_text("")
        (corpus / "new-names.txt").write_text("")
        try:
            build_manifest(corpus)
        except ValueError as e:
            assert "n02.pdf" in str(e)
        else:
            raise AssertionError("expected ValueError")
