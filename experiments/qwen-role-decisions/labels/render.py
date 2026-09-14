# labels/render.py
"""Marked page images for PDF cards, via the spike's Preview + Mark bridge."""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import run
from run import mark_page_png, render_page_png

PAGES = Path("out/labels/pages")


def image_path(card: dict) -> Path:
    return PAGES / "marked" / (card["card_id"].replace(":", "_") + ".png")


def _render_page_png_atomic(pdf: Path, page_1based: int, dest: Path) -> Path:
    # Render to a temporary sibling, then rename onto the real path — a
    # killed run must never leave a half-written file under the real name.
    tmp = dest.with_suffix(".tmp.png")
    render_page_png(pdf, page_1based, tmp)
    os.replace(tmp, dest)
    return dest


def _mark_page_png_atomic(pdf: Path, page_1based: int, box, src: Path, dest: Path) -> dict:
    tmp = dest.with_suffix(".tmp.png")
    result = mark_page_png(pdf, page_1based, box, src, tmp)
    os.replace(tmp, dest)
    return result


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("--cards", type=Path, default=Path("out/labels/cards-pdf.jsonl"))
    a.add_argument("--pdfs", type=Path, default=Path("out/labels/pdfs"))
    args = a.parse_args()
    cards = [json.loads(l) for l in args.cards.read_text().splitlines() if l.strip()]
    # Both helpers javac-compile their class on every call; the classes don't
    # change during this run, so compile once up front and no-op the rest.
    run.compile_preview()
    run.compile_mark()
    run.compile_preview = run.compile_mark = lambda: None
    rendered = skipped = failed = 0
    timed: list[float] = []
    failed_card_ids: list[str] = []
    for c in cards:
        if any(c.get(k) is None for k in ("page", "x0", "y0", "x1", "y1")):
            skipped += 1
            continue
        t0 = time.monotonic()
        page1 = int(c["page"]) + 1
        pdf = args.pdfs / f"{c['document_id']}.pdf"
        base = PAGES / f"{c['document_id']}-p{page1}.png"
        dest = image_path(c)
        try:
            if not base.is_file():
                _render_page_png_atomic(pdf, page1, base)
            if not dest.is_file():
                _mark_page_png_atomic(
                    pdf,
                    page1,
                    (float(c["x0"]), float(c["y0"]), float(c["x1"]), float(c["y1"])),
                    base,
                    dest,
                )
        except Exception:
            failed += 1
            if len(failed_card_ids) < 20:
                failed_card_ids.append(c["card_id"])
            continue
        rendered += 1
        if len(timed) < 20:
            timed.append(time.monotonic() - t0)
    if timed:
        print(json.dumps({"seconds_per_card_first_20": timed}))
    print(json.dumps({"rendered": rendered, "no_box": skipped, "failed": failed, "failed_card_ids": failed_card_ids}))


if __name__ == "__main__":
    main()
