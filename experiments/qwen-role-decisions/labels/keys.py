"""The key: what a tagged original says every block is, in the definition's vocabulary."""
from __future__ import annotations

import re

from run import HEADING, text_norm

VOCAB = ("H", "P", "Artifact", "Caption", "TH", "TOCI", "Lbl", "BlockQuote")
SENTENCE_END = re.compile(r"[.!?;]\s*$")


def key_type(existing_tag: str) -> tuple[str, int | None]:
    tag = existing_tag or ""
    if tag in HEADING:
        return "H", int(tag[1])
    if tag in VOCAB:
        return tag, None
    return "Other", None


def key_blocks(dump: dict) -> list[dict]:
    out = []
    for b in dump.get("blocks") or []:
        t, level = key_type(b.get("existing_tag") or "")
        row = {k: b.get(k) for k in ("locator", "page", "x0", "y0", "x1", "y1", "existing_tag")}
        row.update({"text": b.get("text") or "", "norm": text_norm(b.get("text") or ""), "type": t, "level": level})
        out.append(row)
    return out


def heading_sentence_share(blocks: list[dict]) -> float | None:
    heads = [b for b in blocks if b["type"] == "H" and b["text"].strip()]
    if not heads:
        return None
    return sum(1 for b in heads if SENTENCE_END.search(b["text"])) / len(heads)
