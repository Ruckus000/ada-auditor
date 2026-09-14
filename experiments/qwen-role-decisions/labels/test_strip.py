import json, tempfile
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
