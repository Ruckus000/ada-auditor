#!/usr/bin/env python3
"""Deterministic repairs to a flat ODF source, before it is exported to PDF.

Python because flat ODF is one XML file and the standard library parses it with
no dependency. The rest of this directory is Node and Java; adding a Node XML
parser would cost a package for the sake of matching, which is the wrong trade.

WHAT IS NOT HERE, AND WHY IT MATTERS MOST.

An earlier version marked every image whose authored alt was empty as
decorative. It looked deterministic and honest and it was the most harmful thing
in the experiment: on one document it removed all four meaningful images while
eight images were still drawn on the page. An author who left alt empty because
the image IS decorative and one who simply never filled it in are byte-identical
here. Nothing in the source separates them.

So the image is left exactly as authored. It exports as a Figure with no Alt,
which fails 7.3-1 visibly, which is the honest outcome. A gap a reviewer can see
beats a deletion nobody can.

The repairs that remain must all be true of the source already — this file may
only copy something the document states, never decide something it does not.

Usage: repair-source.py <in-dir> <out-dir>
"""
import re
import shutil
import sys
from pathlib import Path
from xml.sax.saxutils import escape

TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"


def first_heading(xml: str) -> str | None:
    """The text of the document's first heading, tags stripped.

    Only a heading the source already marks as one. If the document states no
    heading there is nothing to copy, and inventing a title from the first line
    of body text is precisely the assertion this whole approach exists to avoid.
    """
    m = re.search(r"<text:h\b[^>]*>(.*?)</text:h>", xml, re.S)
    if not m:
        return None
    text = re.sub(r"<[^>]+>", "", m.group(1))
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def repair(xml: str) -> tuple[str, list[str]]:
    applied = []

    # WCAG 2.4.2 needs a title. Six of nine real municipal documents have none,
    # and it is the whole of what blocks four of them. Copying the document's own
    # first heading is transcription; anything cleverer is invention.
    has_title = re.search(r"<dc:title>\s*\S", xml) is not None
    if not has_title:
        h = first_heading(xml)
        if h:
            title = f"<dc:title>{escape(h)}</dc:title>"
            if re.search(r"<dc:title\s*/>|<dc:title>\s*</dc:title>", xml):
                xml = re.sub(r"<dc:title\s*/>|<dc:title>\s*</dc:title>", title, xml, count=1)
            elif "<office:meta>" in xml:
                xml = xml.replace("<office:meta>", "<office:meta>" + title, 1)
            else:
                applied.append("title: no office:meta to write into")
                return xml, applied
            applied.append(f"title copied from first heading ({len(h)} chars)")
        else:
            # The document states no heading, so there is no title to copy. This
            # is the same wall that blocks four of the nine real documents, and
            # declining is the correct behaviour rather than a failure.
            applied.append("title: BLOCKED — source states no heading to copy")

    return xml, applied


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: repair-source.py <in-dir> <out-dir>", file=sys.stderr)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)

    files = sorted(src.glob("*.fodt"))
    if not files:
        print(f"no .fodt files in {src}", file=sys.stderr)
        return 2

    for f in files:
        xml = f.read_text(encoding="utf8")
        out, applied = repair(xml)
        (dst / f.name).write_text(out, encoding="utf8")
        print(f"{f.stem:30} {'; '.join(applied) if applied else 'nothing to repair'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
