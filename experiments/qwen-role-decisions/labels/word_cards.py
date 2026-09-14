"""Word paragraph candidates, read with the standard library.

A heading in Word is an OUTLINE LEVEL (direct, from the style, or inherited
through basedOn), and a style's own level 9 is Word's "Body Text" override
that ends the walk — the rule AGENTS.md records for TOC Heading. Text-only
cards: the apply target on this lane is the paragraph itself.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

from labels.pdf_cards import MAX_WORDS, OUTLIER_RATIO, RANDOM_SHARE, SEED, TERMINAL, cap_per_document

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
BODY_LEVEL = 9


def style_levels(styles_xml: bytes | None) -> dict[str, int | None]:
    """styleId -> resolved outline level (None = not a heading)."""
    if not styles_xml:
        return {}
    root = ET.fromstring(styles_xml)
    own: dict[str, int | None] = {}
    based: dict[str, str | None] = {}
    for st in root.findall("w:style", NS):
        sid = st.get(f"{{{NS['w']}}}styleId")
        lvl = st.find("w:pPr/w:outlineLvl", NS)
        own[sid] = int(lvl.get(f"{{{NS['w']}}}val")) if lvl is not None else None
        b = st.find("w:basedOn", NS)
        based[sid] = b.get(f"{{{NS['w']}}}val") if b is not None else None
    resolved: dict[str, int | None] = {}

    def resolve(sid: str, seen: set[str]) -> int | None:
        if sid in resolved:
            return resolved[sid]
        if sid in seen or sid not in own:
            return None
        seen.add(sid)
        lvl = own[sid]
        if lvl is not None:
            out = None if lvl == BODY_LEVEL else lvl
        else:
            parent = based.get(sid)
            out = resolve(parent, seen) if parent else None
        resolved[sid] = out
        return out

    for sid in own:
        resolve(sid, set())
    return resolved


def paragraphs(docx: Path) -> list[dict]:
    with zipfile.ZipFile(docx) as z:
        doc = z.read("word/document.xml")
        styles = z.read("word/styles.xml") if "word/styles.xml" in z.namelist() else None
    levels = style_levels(styles)
    root = ET.fromstring(doc)
    # ElementTree has no parent pointers: collect table-cell paragraphs first.
    in_cell = {id(p) for tc in root.iter(f"{{{NS['w']}}}tc") for p in tc.iter(f"{{{NS['w']}}}p")}
    out: list[dict] = []
    for i, p in enumerate(root.iter(f"{{{NS['w']}}}p")):
        text = "".join(t.text or "" for t in p.iter(f"{{{NS['w']}}}t")).strip()
        if not text:
            continue
        style_el = p.find("w:pPr/w:pStyle", NS)
        style = style_el.get(f"{{{NS['w']}}}val") if style_el is not None else None
        direct = p.find("w:pPr/w:outlineLvl", NS)
        if direct is not None:
            lvl = int(direct.get(f"{{{NS['w']}}}val"))
            level = None if lvl == BODY_LEVEL else lvl
        else:
            level = levels.get(style) if style else None
        runs = p.findall("w:r", NS)
        bold = any(r.find("w:rPr/w:b", NS) is not None for r in runs) and runs != []
        sizes = [int(s.get(f"{{{NS['w']}}}val")) / 2 for r in runs for s in r.findall("w:rPr/w:sz", NS)]
        out.append({"index": i, "text": text, "style": style, "outline_level": level, "bold": bold,
                    "size_pt": max(sizes) if sizes else None, "in_table_box": id(p) in in_cell})
    for j, row in enumerate(out):
        row["prev"] = out[j - 1]["text"] if j else "none"
        row["next"] = out[j + 1]["text"] if j + 1 < len(out) else "none"
    return out


def select_word_candidates(paras: list[dict], rng: random.Random) -> list[dict]:
    sizes = [p["size_pt"] for p in paras if p["size_pt"] is not None]
    median = statistics.median(sizes) if sizes else None
    mostly_bold = sum(p["bold"] for p in paras) * 2 > len(paras)
    out = []
    for p in paras:
        why = []
        if p["outline_level"] is not None:
            why.append("source_h")
        words = p["text"].split()
        # A table-cell paragraph enters only as source_h or random, as pdf_cards.reasons/contained.
        cell = bool(p.get("in_table_box"))
        if not cell and 0 < len(words) <= MAX_WORDS and p["text"][-1:] not in TERMINAL:
            why.append("short")
        if not cell and ((median and p["size_pt"] is not None and p["size_pt"] >= OUTLIER_RATIO * median) or (p["bold"] and not mostly_bold)):
            why.append("outlier")
        if not why and rng.random() < RANDOM_SHARE:
            why = ["random"]
        if not why:
            continue
        row = dict(p)
        row["why"] = why
        row["existing_tag"] = f"H{p['outline_level'] + 1}" if p["outline_level"] is not None else "P"
        row["repeats_on_pages"] = 1
        out.append(row)
    return out


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("--manifest", type=Path, required=True)
    a.add_argument("--out", type=Path, default=Path("out/labels/cards-word.jsonl"))
    args = a.parse_args()
    rng = random.Random(SEED)
    total = kept = 0
    with args.out.open("w") as f:
        for r in json.loads(args.manifest.read_text()):
            if r["kind"] != "docx":
                continue
            paras = paragraphs(Path(r["path"]))
            total += len(paras)
            chosen = select_word_candidates(paras, rng)
            for c in chosen:
                c["card_id"] = f"{r['id']}:p{c['index']}"
                c["document_id"] = r["id"]
                c["kind"] = "docx"
            for c in cap_per_document(chosen, rng):
                f.write(json.dumps(c) + "\n")
                kept += 1
    print(json.dumps({"paragraphs": total, "candidates": kept}))


if __name__ == "__main__":
    main()
