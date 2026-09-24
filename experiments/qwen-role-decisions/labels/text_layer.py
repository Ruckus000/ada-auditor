"""Does a no-letters card's text layer contradict its page? Guard 2 of
docs/superpowers/plans/2026-09-24-rule-fixes-registration.md.

Some PDFs extract text that does not match their glyphs (a broken encoding, a
typewritten scan): the page reads "NORTH" and the text layer reads "552,579".
Nothing on the card reveals it, so for a card whose text has no letters this
OCRs the card's own crop and returns the highest confidence Tesseract gives an
alphabetic word of three or more letters (0.0 when it reads none). The box is
found in the card's marked page image by the mark's magenta, so it needs no
coordinate mapping, but the crop is taken from the clean render beside it
(`key_context.marked_image` writes both): the mark is drawn tight around the
glyphs, and OCR through it fails. `rules.r2_no_letters` reads the fact;
computing it lives here, once, never in the rules.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

WORD = re.compile(r"[A-Za-z]{3,}")
MIN_CROP_HEIGHT = 20  # Tesseract needs a line taller than this; smaller crops are scaled up 3x
PAD = 4  # pixels of page kept around the mark's box
BORDER = 10  # white margin added around the crop; Tesseract misreads text touching the edge


def tesseract() -> str:
    path = shutil.which("tesseract")
    if path is None:
        raise RuntimeError("tesseract is required to build cards (brew install tesseract)")
    return path


def mark_box(marked: Path) -> tuple[int, int, int, int] | None:
    """The pixel box of the magenta mark, padded by ``PAD``; None when there is no mark."""
    a = np.asarray(Image.open(marked).convert("RGB")).astype(int)
    ys, xs = np.nonzero((a[:, :, 0] > 200) & (a[:, :, 1] < 80) & (a[:, :, 2] > 200))
    if len(xs) == 0:
        return None
    return (max(0, int(xs.min()) - PAD), max(0, int(ys.min()) - PAD), int(xs.max()) + PAD, int(ys.max()) + PAD)


def clean_render(card: dict, marked: Path) -> Path:
    """The unmarked page render ``marked_image`` wrote beside the marked one."""
    return marked.parent.parent / f"{card['document_id']}-p{int(card['page']) + 1}.png"


def best_word_conf(tsv: str) -> float:
    """Highest confidence among alphabetic words of three or more letters in Tesseract TSV."""
    best = 0.0
    for line in tsv.splitlines()[1:]:
        f = line.split("\t")
        if len(f) < 12 or f[10] in ("", "-1"):
            continue
        if WORD.fullmatch(f[11].strip()):
            best = max(best, float(f[10]))
    return best


def ocr_word_conf(card: dict, marked: Path | None) -> float | None:
    """The fact for one card, or None when it does not apply (the text has letters)
    or cannot be measured (no marked image, no mark in it)."""
    text = (card.get("text") or "").strip()
    if not text or any(ch.isalpha() for ch in text) or marked is None:
        return None
    box, base = mark_box(marked), clean_render(card, marked)
    if box is None or not base.is_file():
        return None
    crop = Image.open(base).convert("L").crop(box)
    if crop.size[1] < MIN_CROP_HEIGHT:
        crop = crop.resize((crop.size[0] * 3, crop.size[1] * 3))
    crop = ImageOps.expand(crop, border=BORDER, fill=255)
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        crop.save(f.name)
        out = subprocess.run([tesseract(), f.name, "-", "--psm", "7", "tsv"], capture_output=True, text=True, check=True)
    return best_word_conf(out.stdout)
