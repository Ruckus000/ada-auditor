#!/usr/bin/env python3
"""Page-sheet judging support: sheets of one document page with every card's box
drawn in magenta and numbered, instead of one image per card. A page with more
than --max-boxes cards becomes several sheets of the same page. Sheets are
greyscale JPEGs (quality 80, 1200 px wide) with magenta boxes/tags on top.

Rendering reuses the exact production chain: ``Preview`` (PDFBox, crop box +
rotation, scale min(2, 1600/max)) renders the page; box pixels come from
``Mark --check`` itself (Preview.java:37-47 mapping, the six pinned lines), run
against the final sheet image so the numbers are in sheet pixel space whatever
the size. PIL only draws what Mark computed.

usage:
  page_sheets.py --ids ids.json --suggest out/suggest/wild-r3 [--suggest out/suggest/wild-v2] \
      --sheets-dir D --chunks-dir D [--per-chunk 6] [--max-boxes 12]
  page_sheets.py --check --suggest out/suggest/wild-r3
  page_sheets.py --to-cards OUT.jsonl --chunks-dir D --judge-files f1.jsonl ...

The ids file is a JSON list of card ids ("<stem>:<n>"). Chunk files are JSON
arrays of {"sheet": path, "cards": [{"k", "id", "text"}]} — no predictions, no
scores, no labels.
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parents[2]  # experiments/qwen-role-decisions
PDFBOX = HERE.parent / "document-remediation" / "vendor" / "pdfbox-app-3.0.8.jar"
CLASSES = HERE / "out" / "classes"

sys.path.insert(0, str(HERE))  # run as a script, not only via `-m` from HERE
from run import java_tool  # noqa: E402

SHEET_WIDTH = 1200
JPEG_QUALITY = 80
MAGENTA = (255, 0, 255)


def java_json(cls: str, args: list[str]) -> dict:
    proc = subprocess.run(
        [str(java_tool("java")), "-Djava.awt.headless=true", "-cp", f"{PDFBOX}:{CLASSES}", cls, *args],
        capture_output=True, text=True)
    if cls == "Mark":
        # --check exits 1 when the box lands outside the image; the JSON is still the answer
        if proc.returncode not in (0, 1):
            raise RuntimeError(proc.stderr[-2000:] or f"Mark exit {proc.returncode}")
    elif proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or f"{cls} exit {proc.returncode}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def render_page(pdf: Path, page1: int, dest: Path) -> None:
    import base64
    payload = java_json("Preview", [str(pdf), str(page1)])
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(base64.b64decode(payload["png"]))


def mark_box(pdf: Path, page1: int, box: tuple[float, float, float, float], image: Path) -> dict:
    return java_json("Mark", ["--check", str(pdf), str(page1),
                              f"{box[0]:.4f}", f"{box[1]:.4f}", f"{box[2]:.4f}", f"{box[3]:.4f}", str(image)])


def load_cards(suggests: list[Path], stems: set[str]) -> dict[str, dict]:
    cards = {}
    for stem in sorted(stems):
        for suggest in suggests:
            f = suggest / stem / "cards.jsonl"
            if f.is_file():
                break
        else:
            raise FileNotFoundError(f"{stem}: no cards.jsonl under {suggests}")
        for line in f.read_text().splitlines():
            if line.strip():
                c = json.loads(line)
                cards[c["id"]] = c
    return cards


def tag_font(size: int):
    from PIL import ImageFont
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def draw_sheet(sheet: Path, boxes: list[tuple[int, int, int, int, int]]) -> None:
    """boxes: (k, x, y, w, h) in sheet pixels. Magenta 3px rect at (x-2,y-2,w+4,h+4)
    like Mark, plus a numbered tag outside the box's top-left corner."""
    from PIL import Image, ImageDraw
    img = Image.open(sheet).convert("RGB")
    d = ImageDraw.Draw(img)
    font = tag_font(20)
    for k, x, y, w, h in boxes:
        d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], outline=MAGENTA, width=3)
        label = str(k)
        tw = d.textlength(label, font=font)
        th = 22
        tx, ty = x - 2, y - 2 - th - 2
        if ty < 0:
            ty = y + h + 4  # no room above: below the box
        if tx + tw + 8 > img.width:
            tx = img.width - tw - 8
        d.rectangle([tx, ty, tx + tw + 8, ty + th], fill=MAGENTA)
        d.text((tx + 4, ty + 2), label, fill=(255, 255, 255), font=font)
    img.save(sheet, quality=JPEG_QUALITY)


def build_sheet(sheets_dir: Path, stem: str, page: int, group: list[dict], sheet_name: str) -> dict:
    """One sheet: Preview render -> greyscale -> JPEG q80, then Mark --check boxes
    against the final JPEG, drawn by PIL. Width: 1200 px minimum; the native
    render is kept when it is already wider, because downscaling 1224 -> 1200
    moved mapped boxes by >3 px (Mark rounds each edge independently at the
    target size) and broke the registered pixel check."""
    from PIL import Image
    pdf = HERE / "out" / "cohort3" / "real" / f"{stem}.pdf"
    if not pdf.is_file():
        raise FileNotFoundError(f"{stem}: no pdf at {pdf}")
    sheets_dir.mkdir(parents=True, exist_ok=True)
    sheet = sheets_dir / sheet_name
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
        tmp = Path(t.name)
    try:
        render_page(pdf, page + 1, tmp)
        img = Image.open(tmp).convert("L")
        if img.width < SHEET_WIDTH:
            img = img.resize((SHEET_WIDTH, round(img.height * SHEET_WIDTH / img.width)), Image.LANCZOS)
        img.save(sheet, quality=JPEG_QUALITY)
    finally:
        tmp.unlink()
    boxes = []
    for c in group:
        m = mark_box(pdf, page + 1, (float(c["x0"]), float(c["y0"]), float(c["x1"]), float(c["y1"])), sheet)
        boxes.append((c["_k"], m["x"], m["y"], m["w"], m["h"]))
    draw_sheet(sheet, boxes)
    return {"sheet": str(sheet.resolve()),
            "cards": [{"k": c["_k"], "id": c["id"], "text": c["text"]} for c in group],
            "_boxes": boxes}


def ref_stroke_bbox(image_full: Path, base: Path) -> tuple[int, int, int, int] | None:
    """The drawn stroke is the only difference between the pipeline's marked
    image and a fresh Preview render of the same page (renders are
    deterministic). Colour detection is unusable: real documents contain pure
    magenta (c3-0282's trail map)."""
    from PIL import Image, ImageChops
    a = Image.open(image_full).convert("RGB")
    b = Image.open(base).convert("RGB")
    if a.size != b.size:
        raise ValueError(f"size mismatch {a.size} vs {b.size}")
    return ImageChops.difference(a, b).getbbox()


def cmd_check(suggests: list[Path]) -> None:
    """5 cards on different documents: the box a production sheet draws (Mark's
    own output on the real sheet) vs the stroke bbox diffed out of the existing
    single-card image, scaled to the same width, <= 3 px per coordinate."""
    cards = load_cards(suggests, {p.name for p in suggests[0].iterdir() if p.is_dir()})
    picked, seen = [], set()
    for cid in sorted(cards):
        c = cards[cid]
        stem = c["document_id"]
        if stem not in seen and c.get("image_full") and all(c.get(k) is not None for k in ("page", "x0", "y0", "x1", "y1")):
            picked.append(c)
            seen.add(stem)
        if len(picked) == 5:
            break
    if len(picked) < 5:
        raise SystemExit("fewer than 5 documents with full images")
    tmpdir = HERE / "out" / "labels" / "s2wild-judges-r3" / "sheets-check"
    tmpdir.mkdir(parents=True, exist_ok=True)
    results = []
    for c in picked:
        stem, page = c["document_id"], int(c["page"])
        pdf = HERE / "out" / "cohort3" / "real" / f"{stem}.pdf"
        cc = dict(c)
        cc["_k"] = 1
        entry = build_sheet(tmpdir, stem, page, [cc], f"check-{stem}_p{page}.jpg")
        _, mx, my, mw, mh = entry["_boxes"][0]
        base = tmpdir / f"check-base-{stem}_p{page}.png"
        render_page(pdf, page + 1, base)
        ref_bbox = ref_stroke_bbox(Path(c["image_full"]), base)
        if ref_bbox is None:
            raise SystemExit(f"{c['id']}: marked image identical to fresh render — no box found")
        from PIL import Image
        s = Image.open(entry["sheet"]).width / Image.open(c["image_full"]).width
        ref = tuple(v * s for v in ref_bbox)
        mine = (mx - 2, my - 2, mx + mw + 2, my + mh + 2)
        # Java's stroke is centered on the same rect: outer edge up to 1.5 px out
        delta = max(abs(a - b) for a, b in zip(mine, ref))
        results.append({"id": c["id"], "delta_px": round(delta, 2), "ok": delta <= 3})
    print(json.dumps({"check": results, "pass": all(r["ok"] for r in results)}, indent=1))
    if not all(r["ok"] for r in results):
        raise SystemExit(1)


def cmd_build(ids_path: Path, suggests: list[Path], sheets_dir: Path, chunks_dir: Path,
              per_chunk: int, max_boxes: int) -> None:
    ids = json.loads(ids_path.read_text())
    cards_all = load_cards(suggests, {i.split(":")[0] for i in ids})
    missing = [i for i in ids if i not in cards_all]
    if missing:
        raise SystemExit(f"ids with no card: {missing[:5]} ({len(missing)})")
    groups: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for i in ids:
        c = cards_all[i]
        if any(c.get(k) is None for k in ("page", "x0", "y0", "x1", "y1")):
            raise SystemExit(f"{i}: no geometry")
        groups[(c["document_id"], int(c["page"]))].append(c)
    jobs = []
    for (stem, page) in sorted(groups):
        group = sorted(groups[(stem, page)], key=lambda c: (float(c["y0"]), float(c["x0"])))
        for si in range(0, len(group), max_boxes):
            sub = group[si:si + max_boxes]
            for k, c in enumerate(sub, 1):
                c["_k"] = k
            name = f"{stem}_p{page}_s{si // max_boxes + 1}.jpg"
            jobs.append((stem, page, sub, name))
    with futures.ThreadPoolExecutor(max_workers=8) as ex:
        entries = list(ex.map(lambda j: build_sheet(sheets_dir, j[0], j[1], j[2], j[3]), jobs))
    entries.sort(key=lambda e: e["sheet"])
    for e in entries:
        e.pop("_boxes", None)
    chunks_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for i in range(0, len(entries), per_chunk):
        (chunks_dir / f"chunk-{i // per_chunk:02d}.json").write_text(json.dumps(entries[i:i + per_chunk], indent=1))
        n += 1
    print(json.dumps({"ids": len(ids), "sheets": len(entries), "chunks": n,
                      "cards": sum(len(e["cards"]) for e in entries)}))


def cmd_to_cards(out_path: Path, chunks_dir: Path, judge_files: list[Path]) -> None:
    """Sheet-format judge lines ({sheet,k,id,type,level[,note]}) -> per-card lines
    ({n,id,type,level,note}) in chunk order. Validates that every box in every
    referenced chunk has exactly one line; refuses anything else."""
    wanted = {}
    for chunk in sorted(chunks_dir.glob("chunk-*.json")):
        for entry in json.loads(chunk.read_text()):
            sheet = Path(entry["sheet"]).name
            for c in entry["cards"]:
                wanted[(sheet, c["k"], c["id"])] = True
    seen: dict[tuple[str, int, str], dict] = {}
    for f in judge_files:
        for line in f.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            key = (Path(r["sheet"]).name, int(r["k"]), r["id"])
            if key not in wanted:
                raise SystemExit(f"{f}: line for unknown box {key}")
            if key in seen:
                raise SystemExit(f"{f}: duplicate line for {key}")
            seen[key] = {"id": r["id"], "type": r["type"], "level": r.get("level"), "note": r.get("note", "")}
    missing = [k for k in wanted if k not in seen]
    if missing:
        raise SystemExit(f"{len(missing)} boxes with no line, first: {missing[0]}")
    rows = []
    n = 0
    for chunk in sorted(chunks_dir.glob("chunk-*.json")):
        for entry in json.loads(chunk.read_text()):
            sheet = Path(entry["sheet"]).name
            for c in entry["cards"]:
                r = seen[(sheet, c["k"], c["id"])]
                rows.append({"n": n, **r})
                n += 1
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    print(json.dumps({"cards": len(rows), "out": str(out_path)}))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ids", type=Path)
    p.add_argument("--suggest", type=Path, action="append", default=None)
    p.add_argument("--sheets-dir", type=Path)
    p.add_argument("--chunks-dir", type=Path)
    p.add_argument("--per-chunk", type=int, default=6)
    p.add_argument("--max-boxes", type=int, default=12)
    p.add_argument("--check", action="store_true")
    p.add_argument("--to-cards", type=Path, metavar="OUT")
    p.add_argument("--judge-files", type=Path, nargs="*")
    a = p.parse_args()
    suggests = a.suggest or [HERE / "out" / "suggest" / "wild-r3"]
    if a.check:
        cmd_check(suggests)
    elif a.to_cards:
        if not a.chunks_dir or not a.judge_files:
            p.error("--to-cards needs --chunks-dir and --judge-files")
        cmd_to_cards(a.to_cards, a.chunks_dir, a.judge_files)
    else:
        if not a.ids or not a.sheets_dir or not a.chunks_dir:
            p.error("build mode needs --ids, --sheets-dir, --chunks-dir")
        cmd_build(a.ids, suggests, a.sheets_dir, a.chunks_dir, a.per_chunk, a.max_boxes)


if __name__ == "__main__":
    main()
