"""What the SFT and the predictor need beside a label row: the card itself, its image, and the key ladder.

Re-derives from the same dumps `build_keys.py` used (cheap, deterministic):
``<out>/cards.jsonl`` — every labelled card with text, prev/next, facts,
box and the path of its marked image (rendered from the stripped copy under
``<out>/pages``); ``<out>/key-headings.json`` — per document, the key's
headings in reading order ``[{page, y0, level, text}]``.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from run import blocks_to_cards, compile_cards, dump_pdf, mark_page_png, render_page_png, text_norm
from labels.inline_label import after_inline_label
from labels.keys import key_blocks
from labels.margin_band import in_margin_band, page_extents
from labels.pdf_cards import repeats_on_pages

OUT = Path("out/keys")
DEFAULT_SOURCE = "out/keys:out/labels/manifest.json"

Source = tuple[Path, Path, Path]  # (build dir, manifest, word-pdfs dir)


def parse_source(spec: str) -> Source:
    """``<build_dir>:<manifest>[:<word_pdfs>]``; word_pdfs defaults to ``<build_dir>/word-pdfs``.

    The optional third part exists because a rebuild can reuse another build's
    Word conversions (out/keys-b4r2 was built with --word-pdfs out/keys/word-pdfs).
    """
    parts = spec.split(":")
    if len(parts) not in (2, 3):
        raise ValueError(f"--source must be <build_dir>:<manifest>[:<word_pdfs>], got {spec!r}")
    build = Path(parts[0])
    return build, Path(parts[1]), Path(parts[2]) if len(parts) == 3 else build / "word-pdfs"


def resolve_sources(doc_ids: set[str], sources: list[Source]) -> dict[str, tuple[Source, dict]]:
    """Each document id to the one source whose manifest lists it; none or two raises."""
    found: dict[str, list[tuple[Source, dict]]] = {d: [] for d in doc_ids}
    for src in sources:
        for m in json.loads(src[1].read_text()):
            if m["id"] in found:
                found[m["id"]].append((src, m))
    missing = sorted(d for d, hits in found.items() if not hits)
    if missing:
        raise ValueError(f"documents in no source: {missing}")
    dup = sorted(d for d, hits in found.items() if len(hits) > 1)
    if dup:
        raise ValueError(f"documents in more than one source: {dup}")
    return {d: hits[0] for d, hits in found.items()}


def original_of(build: Path, entry: dict, word_pdfs: Path | None = None) -> Path:
    if entry["kind"] == "pdf":
        return Path(entry["path"])
    return (word_pdfs if word_pdfs is not None else build / "word-pdfs") / f"{entry['id']}.pdf"


def stripped_of(build: Path, doc_id: str) -> Path:
    """The stripped copy: ``stripped/<id>.pdf``, or ``stripped/batch-NNN/<id>.pdf`` where
    build_keys' ODL batching moved it. Exactly one must exist."""
    hits = [p for p in [build / "stripped" / f"{doc_id}.pdf", *sorted((build / "stripped").glob(f"batch-*/{doc_id}.pdf"))] if p.is_file()]
    if not hits:
        raise FileNotFoundError(f"{doc_id}: no stripped copy under {build / 'stripped'}")
    if len(hits) > 1:
        raise ValueError(f"{doc_id}: {len(hits)} stripped copies under {build / 'stripped'}")
    return hits[0]


def marked_image(card: dict, pdf: Path, pages: Path = OUT / "pages") -> Path | None:
    if any(card.get(k) is None for k in ("page", "x0", "y0", "x1", "y1")):
        return None
    page1 = int(card["page"]) + 1
    base = pages / f"{card['document_id']}-p{page1}.png"
    if not base.is_file():
        render_page_png(pdf, page1, base)
    dest = pages / "marked" / (card["card_id"].replace(":", "_") + ".png")
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
    p.add_argument("--out", type=Path, default=OUT)
    p.add_argument("--source", action="append", default=None,
                   help=f"<build_dir>:<manifest>[:<word_pdfs>], repeatable (default {DEFAULT_SOURCE})")
    a = p.parse_args()
    sources = [parse_source(s) for s in (a.source or [DEFAULT_SOURCE])]
    rows = [json.loads(l) for l in a.labels.read_text().splitlines() if l.strip()]
    wanted = defaultdict(set)
    for r in rows:
        wanted[r["document_id"]].add(r["id"])
    resolved = resolve_sources(set(wanted), sources)
    compile_cards()
    pages = a.out / "pages"
    a.out.mkdir(parents=True, exist_ok=True)
    headings, n_cards, n_img = {}, 0, 0
    with (a.out / "cards.jsonl").open("w") as f:
        for doc_id, ids in sorted(wanted.items()):
            (build, _, word_pdfs), entry = resolved[doc_id]
            tagged = build / "tagged" / f"{doc_id}.pdf"
            stripped = stripped_of(build, doc_id)
            original = original_of(build, entry, word_pdfs)
            for path in (tagged, stripped, original):
                if not path.is_file():
                    raise FileNotFoundError(f"{doc_id}: {path}")
            blocks = dump_pdf(tagged, compile=False).get("blocks") or []
            cards, _ = blocks_to_cards(blocks)
            reps = repeats_on_pages(cards)
            extents = page_extents(blocks)
            # Over every card of the document, not only the labelled ones: the
            # bullet that marks a list item is usually not itself labelled.
            inline = after_inline_label(cards)
            for c in cards:
                if c["locator"] not in ids:
                    continue
                c["card_id"] = c["locator"]; c["document_id"] = doc_id; c["kind"] = "pdf"
                c["repeats_on_pages"] = reps.get(c["locator"], 1); c["norm"] = text_norm(c["text"])
                c["in_margin_band"] = in_margin_band(c, extents)
                c["after_inline_label"] = inline[c["locator"]]
                img = marked_image(c, stripped, pages)
                c["image"] = None if img is None else str(img.resolve())
                n_img += img is not None; n_cards += 1
                f.write(json.dumps(c) + "\n")
            headings[doc_id] = ordered_headings(dump_pdf(original, compile=False))
    (a.out / "key-headings.json").write_text(json.dumps(headings) + "\n")
    print(json.dumps({"cards": n_cards, "with_image": n_img, "documents": len(headings), "documents_with_headings": sum(1 for h in headings.values() if h)}))

if __name__ == "__main__":
    main()
