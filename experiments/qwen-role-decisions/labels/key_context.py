"""What the SFT and the predictor need beside a label row: the card itself, its image, and the key ladder.

Re-derives from the same dumps `build_keys.py` used (cheap, deterministic):
``out/keys/cards.jsonl`` — every labelled card with text, prev/next, facts,
box and the path of its marked image (rendered from the stripped copy under
``out/keys/pages``); ``out/keys/key-headings.json`` — per document, the key's
headings in reading order ``[{page, y0, level, text}]``.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from run import blocks_to_cards, compile_cards, dump_pdf, mark_page_png, render_page_png, text_norm
from labels.keys import key_blocks
from labels.pdf_cards import repeats_on_pages

OUT = Path("out/keys")
PAGES = OUT / "pages"


def marked_image(card: dict, pdf: Path) -> Path | None:
    if any(card.get(k) is None for k in ("page", "x0", "y0", "x1", "y1")):
        return None
    page1 = int(card["page"]) + 1
    base = PAGES / f"{card['document_id']}-p{page1}.png"
    if not base.is_file():
        render_page_png(pdf, page1, base)
    dest = PAGES / "marked" / (card["card_id"].replace(":", "_") + ".png")
    if not dest.is_file():
        mark_page_png(pdf, page1, (float(card["x0"]), float(card["y0"]), float(card["x1"]), float(card["y1"])), base, dest)
    return dest


def ordered_headings(dump: dict) -> list[dict]:
    hs = [k for k in key_blocks(dump) if k["type"] == "H" and k.get("page") is not None and k.get("y0") is not None]
    hs.sort(key=lambda k: (k["page"], k["y0"]))
    return [{"page": k["page"], "y0": k["y0"], "level": k["level"], "text": k["text"], "locator": k["locator"]} for k in hs]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--labels", type=Path, default=OUT / "labels.jsonl")
    p.add_argument("--manifest", type=Path, default=Path("out/labels/manifest.json"))
    p.add_argument("--word-pdfs", type=Path, default=OUT / "word-pdfs")
    a = p.parse_args()
    compile_cards()
    rows = [json.loads(l) for l in a.labels.read_text().splitlines() if l.strip()]
    wanted = defaultdict(set)
    for r in rows:
        wanted[r["document_id"]].add(r["id"])
    manifest = {m["id"]: m for m in json.loads(a.manifest.read_text())}
    headings, n_cards, n_img = {}, 0, 0
    with (OUT / "cards.jsonl").open("w") as f:
        for doc_id, ids in sorted(wanted.items()):
            tagged = OUT / "tagged" / f"{doc_id}.pdf"
            stripped = OUT / "stripped" / f"{doc_id}.pdf"
            original = Path(manifest[doc_id]["path"]) if manifest[doc_id]["kind"] == "pdf" else a.word_pdfs / f"{doc_id}.pdf"
            cards, _ = blocks_to_cards(dump_pdf(tagged, compile=False).get("blocks") or [])
            reps = repeats_on_pages(cards)
            for c in cards:
                if c["locator"] not in ids:
                    continue
                c["card_id"] = c["locator"]; c["document_id"] = doc_id; c["kind"] = "pdf"
                c["repeats_on_pages"] = reps.get(c["locator"], 1); c["norm"] = text_norm(c["text"])
                img = marked_image(c, stripped)
                c["image"] = None if img is None else str(img.resolve())
                n_img += img is not None; n_cards += 1
                f.write(json.dumps(c) + "\n")
            headings[doc_id] = ordered_headings(dump_pdf(original, compile=False))
    (OUT / "key-headings.json").write_text(json.dumps(headings) + "\n")
    print(json.dumps({"cards": n_cards, "with_image": n_img, "documents": len(headings), "documents_with_headings": sum(1 for h in headings.values() if h)}))


if __name__ == "__main__":
    main()
