# labels/manifest.py
"""Document manifest for the labelling pass: id, kind, bytes hash, host.

Host is the split unit and the stand-in for both client and template
(recorded as a proxy in the results doc). Provenance comes from the two
tracked manifests in the corpus directory; a file without a line is an
error, never an "unknown" host, because unknown cannot be split safely.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

PROVENANCE_FILES = ("real-names.txt", "new-names.txt")


def host_of(url: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", url.strip()).split("/")[0].split(":")[0].lower()


def read_provenance(corpus: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    # The manifests are tracked beside the gitignored `real/` directory, so
    # look in the corpus directory and then its parent.
    for name in PROVENANCE_FILES:
        path = next((d / name for d in (corpus, corpus.parent) if (d / name).is_file()), None)
        if path is None:
            continue
        for line in path.read_text().splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.split(None, 1)
            if len(parts) == 2:
                out[parts[0].strip()] = parts[1].strip()
    return out


def build_manifest(corpus: Path) -> list[dict]:
    provenance = read_provenance(corpus)
    rows: list[dict] = []
    missing: list[str] = []
    for path in sorted(corpus.iterdir()):
        if path.suffix.lower() not in (".pdf", ".docx"):
            continue
        url = provenance.get(path.name)
        if url is None:
            missing.append(path.name)
            continue
        rows.append(
            {
                "id": path.stem,
                "path": str(path.resolve()),
                "kind": path.suffix.lower()[1:],
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "host": host_of(url),
                "url": url,
            }
        )
    if missing:
        raise ValueError(f"no provenance for {missing}")
    return rows


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--corpus", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    rows = build_manifest(a.corpus)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(rows, indent=2) + "\n")
    hosts = {r["host"] for r in rows}
    print(json.dumps({"documents": len(rows), "hosts": len(hosts), "pdf": sum(r["kind"] == "pdf" for r in rows), "docx": sum(r["kind"] == "docx" for r in rows)}))


if __name__ == "__main__":
    main()
