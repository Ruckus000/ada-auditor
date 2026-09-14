"""Convert Word sources with the product's own tagged-export filter; the result is a tagged original."""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from run import compile_cards, dump_pdf

SOFFICE = "/opt/homebrew/bin/soffice"
EXPORT_FILTER = "pdf:writer_pdf_Export:" + json.dumps({
    "UseTaggedPDF": {"type": "boolean", "value": "true"},
    "PDFUACompliance": {"type": "boolean", "value": "true"},
}, separators=(",", ":"))


def convert_docx(src: Path, out_dir: Path) -> Path | None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run([SOFFICE, f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", EXPORT_FILTER, "--outdir", str(out_dir), str(src)], capture_output=True, text=True, timeout=300)
    pdf = out_dir / (src.stem + ".pdf")
    if not pdf.is_file():
        return None
    return pdf if dump_pdf(pdf, compile=False).get("hasStructTree") else None


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path("out/keys/word-pdfs"))
    a = p.parse_args()
    compile_cards()
    rows = [r for r in json.loads(a.manifest.read_text()) if r["kind"] == "docx"]
    converted, untagged, failed = [], [], []
    for r in rows:
        try:
            pdf = convert_docx(Path(r["path"]), a.out)
        except Exception:
            failed.append(r["id"]); continue
        if pdf is None:
            (untagged if (a.out / (Path(r["path"]).stem + ".pdf")).is_file() else failed).append(r["id"])
        else:
            converted.append(r["id"])
    print(json.dumps({"converted": len(converted), "untagged": untagged, "failed": failed}))


if __name__ == "__main__":
    main()
