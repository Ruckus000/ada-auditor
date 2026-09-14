# labels/test_planted_cohort.py
"""The planted cohorts regenerate to the same bytes and carry P2 provenance; c7 carries varied surfaces."""
import hashlib, re, shutil, subprocess, tempfile, zipfile
from pathlib import Path
from labels.manifest import build_manifest

SCRIPT = Path(__file__).resolve().parent / "planted_cohort.mjs"
URL = re.compile(r"^c5-\d{4}\.docx\thttps://planted-[a-z-]+\.invalid/\d+$")
URL7 = re.compile(r"^c7-\d{4}\.docx\thttps://planted-[a-z-]+\.invalid/\d+$")
HOST = re.compile(r"^planted-[a-z-]+\.invalid$")
HEADING_P = re.compile(r'<w:p><w:pPr><w:pStyle w:val="Heading[1-4]"/></w:pPr>(.*?)</w:p>')


def _generate(out: Path, *extra: str, count: int = 3) -> dict[str, str]:
    subprocess.run(["node", str(SCRIPT), "--out", str(out), "--count", str(count), "--seed-base", "7100", *extra],
                   check=True, capture_output=True)
    files = sorted((out / "real").glob("*.docx")) + [out / "real-names.txt"]
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in files}


def _headings(docx: Path) -> list[str]:
    """Text headings by Heading style (image-only headings have no run to surface)."""
    return [h for h in HEADING_P.findall(zipfile.ZipFile(docx).read("word/document.xml").decode()) if "<w:drawing>" not in h]


def test_planted_cohort_is_reproducible_and_carries_p2_provenance():
    if shutil.which("node") is None:
        print("SKIP test_planted_cohort: node is not on PATH")
        return
    with tempfile.TemporaryDirectory() as d:
        a, b, c = Path(d) / "a", Path(d) / "b", Path(d) / "c"
        first, second = _generate(a), _generate(b)
        assert len(first) == 4 and first == second
        assert _generate(c, "--cohort", "c5") == first  # c5 is the default, byte for byte
        lines = [l for l in (a / "real-names.txt").read_text().splitlines() if l and not l.startswith("#")]
        assert len(lines) == 3 and all(URL.match(l) for l in lines), lines
        rows = build_manifest(a / "real")
        assert len(rows) == 3
        assert all(HOST.match(r["host"]) for r in rows), [r["host"] for r in rows]
        assert len({r["host"] for r in rows}) == 3  # documents 0-2 fall in three families
        # c5 headings take their surface from the style: no run properties.
        assert all("<w:rPr>" not in h for f in sorted((a / "real").glob("*.docx")) for h in _headings(f))


def test_c7_is_reproducible_and_its_headings_carry_varied_run_surfaces():
    if shutil.which("node") is None:
        print("SKIP test_planted_cohort c7: node is not on PATH")
        return
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / "a", Path(d) / "b"
        first = _generate(a, "--cohort", "c7", count=16)
        assert first == _generate(b, "--cohort", "c7", count=16)
        text = (a / "real-names.txt").read_text()
        assert text.startswith("# cohort 7") and "--cohort c7" in text
        lines = [l for l in text.splitlines() if l and not l.startswith("#")]
        assert len(lines) == 16 and all(URL7.match(l) for l in lines), lines
        heads = [h for f in sorted((a / "real").glob("*.docx")) for h in _headings(f)]
        assert heads and all(re.search(r'<w:rPr>.*<w:sz w:val="\d+"/>.*</w:rPr>', h) for h in heads)
        sizes = {int(s) // 2 for h in heads for s in re.findall(r'<w:sz w:val="(\d+)"/>', h)}
        assert min(sizes) >= 11 and max(sizes) <= 18 and len(sizes) >= 5, sizes
        plain = sum('<w:b w:val="0"/>' in h for h in heads)
        assert 0.1 < plain / len(heads) < 0.6, (plain, len(heads))
        texts = [re.sub(r"<[^>]+>", "", h) for h in heads]
        assert any(t.isupper() for t in texts) and any(t.istitle() for t in texts)
        assert any(re.match(r"^(ARTICLE [IVX]+|Section \d|\d+\.\d+ |\([a-z]\) )", t) for t in texts), texts
