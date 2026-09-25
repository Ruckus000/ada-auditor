"""Mark.java's outline: big enough to survive the 408-token reduce, and refused
when it would land off the raster.

The cases run the real class, because the geometry that matters (MIN_MARK, the
2 px gap, the off-raster check) lives in Java and a Python copy of it would
drift. They skip where a contributor has no JDK or no vendored PDFBox.
"""
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

import run
from run import PDFBOX, mark_page_png

# c8-0004's own page and raster: a large-format sheet is where a glyph box maps
# to a handful of pixels, which is the case MIN_MARK exists for.
PAGE_W, PAGE_H = 2592, 2016
RASTER = (1600, 1244)


def _java_missing() -> str | None:
    if not PDFBOX.is_file():
        return f"no vendored PDFBox at {PDFBOX}"
    try:
        run.java_tool("javac")
        run.java_tool("java")
    except Exception as e:  # noqa: BLE001 - any resolution failure is a skip
        return str(e)
    return None


def _one_page_pdf(dest: Path) -> Path:
    """A blank MediaBox-only page: Mark reads the boxes and the rotation, nothing else."""
    objects = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {PAGE_W} {PAGE_H}]>>".encode(),
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    start = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    for o in offsets:
        out += f"{o:010d} 00000 n \n".encode()
    out += (f"trailer\n<</Size {len(objects) + 1}/Root 1 0 R>>\nstartxref\n{start}\n".encode()
            + b"%%EOF\n")
    dest.write_bytes(bytes(out))
    return dest


def _white_png(dest: Path) -> Path:
    Image.new("RGB", RASTER, (255, 255, 255)).save(dest)
    return dest


def _magenta_pixels(png: Path) -> int:
    a = np.asarray(Image.open(png).convert("RGB"))
    return int(((a[:, :, 0] > 200) & (a[:, :, 1] < 80) & (a[:, :, 2] > 200)).sum())


def _mark(box, dest_name="marked.png"):
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        pdf = _one_page_pdf(root / "page.pdf")
        src = _white_png(root / "page.png")
        dest = root / dest_name
        mapped = mark_page_png(pdf, 1, box, src, dest)
        return mapped, dest, (_magenta_pixels(dest) if dest.is_file() else None)


def test_a_glyph_sized_box_still_gets_a_visible_outline():
    """c8-0004's page number "1" — 5.2x9.5 units, 3x6 px at the raster. MIN_MARK is
    a floor with margin over the 408-token reduce, not a repair of a measured
    loss: the 344 unmarked cards of cohort 8 were all off-raster, not sub-pixel."""
    if (why := _java_missing()):
        print(f"skip: {why}"); return
    from_java, dest, magenta = _mark((1300.673, 1325.1304, 1305.9076, 1334.5867))
    assert (from_java["w"], from_java["h"]) == (3, 6), from_java
    assert from_java["visible"] is True
    assert from_java["markW"] >= 12 and from_java["markH"] >= 12, from_java
    assert magenta > 0
    # Grown about the box centre, so it still points at the box (to the pixel:
    # the growth is split with integer division).
    assert abs((from_java["markX"] + from_java["markW"] / 2) - (from_java["x"] + from_java["w"] / 2)) <= 1
    assert abs((from_java["markY"] + from_java["markH"] / 2) - (from_java["y"] + from_java["h"] / 2)) <= 1


def test_a_normal_box_keeps_the_box_plus_two_geometry():
    """The released marked images were drawn at box-inflated-by-2; anything that
    moves them by a pixel is a change of model input, so it must be deliberate."""
    if (why := _java_missing()):
        print(f"skip: {why}"); return
    from_java, _dest, magenta = _mark((100.0, 100.0, 300.0, 140.0))
    assert from_java["markX"] == from_java["x"] - 2
    assert from_java["markY"] == from_java["y"] - 2
    assert from_java["markW"] == from_java["w"] + 4
    assert from_java["markH"] == from_java["h"] + 4
    assert magenta > 0


def test_a_box_off_the_page_writes_no_image():
    """The 344-card shape: nothing is drawn, so the caller must not get a page
    that only looks marked."""
    if (why := _java_missing()):
        print(f"skip: {why}"); return
    from_java, dest, magenta = _mark((100.0, float(PAGE_H + 200), 140.0, float(PAGE_H + 220)))
    assert from_java["visible"] is False, from_java
    assert not dest.is_file() and magenta is None


def test_marked_image_drops_the_card_whose_box_is_off_the_page():
    if (why := _java_missing()):
        print(f"skip: {why}"); return
    from labels.key_context import marked_image
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        pdf = _one_page_pdf(root / "doc.pdf")
        pages = root / "pages"
        pages.mkdir()
        _white_png(pages / "doc-p1.png")
        card = {"document_id": "doc", "card_id": "doc:1", "page": 0,
                "x0": 100.0, "y0": PAGE_H + 200.0, "x1": 140.0, "y1": PAGE_H + 220.0}
        assert marked_image(card, pdf, pages) is None
        on_page = {**card, "card_id": "doc:2", "y0": 100.0, "y1": 120.0}
        got = marked_image(on_page, pdf, pages)
        assert got is not None and _magenta_pixels(got) > 0
