import json, shutil, subprocess, tempfile
from pathlib import Path
from labels.strip import strip_pdf
from run import dump_pdf

POOL = Path("out/labels/pdfs")


def test_strip_removes_tree_and_keeps_pages():
    src = next((p for p in sorted(POOL.glob("*.pdf")) if dump_pdf(p, compile=False).get("hasStructTree")), None)
    if src is None:
        print("skip: no tagged pdf staged"); return
    with tempfile.TemporaryDirectory() as d:
        dest = Path(d) / "stripped.pdf"
        info = strip_pdf(src, dest)
        assert info["hadTree"] is True and info["pages"] >= 1
        assert dump_pdf(dest, compile=False)["hasStructTree"] is False
        assert dest.stat().st_size > 0


def _catalog(pdf: Path) -> dict | None:
    """The catalog dictionary as qpdf reads it, or None without qpdf."""
    if shutil.which("qpdf") is None:
        return None
    proc = subprocess.run(["qpdf", "--json=2", "--json-key=qpdf", str(pdf)], capture_output=True, text=True)
    objects = json.loads(proc.stdout)["qpdf"][1]
    return objects["obj:" + objects["trailer"]["value"]["/Root"]]["value"]


def test_strip_removes_the_outline():
    src = next((p for p in sorted(POOL.glob("*.pdf")) if b"/Outlines" in p.read_bytes()), None)
    if src is None:
        print("skip: no staged pdf carries /Outlines in its bytes"); return
    with tempfile.TemporaryDirectory() as d:
        dest = Path(d) / "stripped.pdf"
        strip_pdf(src, dest)
        assert b"/Outlines" not in dest.read_bytes()
        catalog = _catalog(dest)
        if catalog is None:
            print("skip: qpdf not installed; byte check only")
        else:
            assert "/Outlines" not in catalog and "/StructTreeRoot" not in catalog
