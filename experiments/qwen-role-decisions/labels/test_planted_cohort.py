# labels/test_planted_cohort.py
"""The planted cohort regenerates to the same bytes and carries P2 provenance."""
import hashlib, re, shutil, subprocess, tempfile
from pathlib import Path
from labels.manifest import build_manifest

SCRIPT = Path(__file__).resolve().parent / "planted_cohort.mjs"
URL = re.compile(r"^c5-\d{4}\.docx\thttps://planted-[a-z-]+\.invalid/\d+$")
HOST = re.compile(r"^planted-[a-z-]+\.invalid$")


def _generate(out: Path) -> dict[str, str]:
    subprocess.run(["node", str(SCRIPT), "--out", str(out), "--count", "3", "--seed-base", "7100"],
                   check=True, capture_output=True)
    files = sorted((out / "real").glob("*.docx")) + [out / "real-names.txt"]
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in files}


def test_planted_cohort_is_reproducible_and_carries_p2_provenance():
    if shutil.which("node") is None:
        print("SKIP test_planted_cohort: node is not on PATH")
        return
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / "a", Path(d) / "b"
        first, second = _generate(a), _generate(b)
        assert len(first) == 4 and first == second
        lines = [l for l in (a / "real-names.txt").read_text().splitlines() if l and not l.startswith("#")]
        assert len(lines) == 3 and all(URL.match(l) for l in lines), lines
        rows = build_manifest(a / "real")
        assert len(rows) == 3
        assert all(HOST.match(r["host"]) for r in rows), [r["host"] for r in rows]
        assert len({r["host"] for r in rows}) == 3  # documents 0-2 fall in three families
