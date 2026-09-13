"""Stage every manifest PDF under out/labels/pdfs/ with a structure tree.

Tagged originals are copied. Untagged ones go through the spike's existing
OpenDataLoader runner — its tags are CANDIDATES for a reviewer, never labels
and never shown. Defaults only, as the runner insists.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

from run import dump_pdf

MAIN = Path("/Users/jphilistin/Documents/Coding/ADA Auditor")
ODL_RUNNER = MAIN / "experiments" / "document-remediation" / "run-opendataloader.mjs"


def plan_staging(rows: list[dict], has_tree: Callable[[Path], bool]) -> tuple[list[dict], list[dict]]:
    keep, tag = [], []
    for r in rows:
        if r["kind"] != "pdf":
            continue
        (keep if has_tree(Path(r["path"])) else tag).append(r)
    return keep, tag


def has_struct_tree(pdf: Path) -> bool:
    return bool(dump_pdf(pdf, compile=False).get("hasStructTree"))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path("out/labels/pdfs"))
    a = p.parse_args()
    rows = json.loads(a.manifest.read_text())
    dump_pdf(Path(rows[0]["path"]), compile=True)  # compile Cards once
    keep, tag = plan_staging(rows, has_struct_tree)
    a.out.mkdir(parents=True, exist_ok=True)
    staging = []
    for r in keep:
        shutil.copyfile(r["path"], a.out / f"{r['id']}.pdf")
        staging.append({"id": r["id"], "source": "original", "tagged": True})
    with tempfile.TemporaryDirectory() as tmp:
        inp, outp = Path(tmp) / "in", Path(tmp) / "out"
        inp.mkdir()
        for r in tag:
            shutil.copyfile(r["path"], inp / f"{r['id']}.pdf")
        if tag:
            subprocess.run(["node", str(ODL_RUNNER), str(inp), str(outp)], cwd=MAIN, check=True)
        for r in tag:
            produced = outp / f"{r['id']}.pdf"
            tagged = produced.is_file() and has_struct_tree(produced)
            if tagged:
                shutil.copyfile(produced, a.out / f"{r['id']}.pdf")
            staging.append({"id": r["id"], "source": "opendataloader", "tagged": tagged})
    (a.out.parent / "staging.json").write_text(json.dumps(staging, indent=2) + "\n")
    print(json.dumps({"original": len(keep), "tagged_by_odl": sum(s["tagged"] for s in staging if s["source"] == "opendataloader"), "failed": [s["id"] for s in staging if not s["tagged"]]}))


if __name__ == "__main__":
    main()
