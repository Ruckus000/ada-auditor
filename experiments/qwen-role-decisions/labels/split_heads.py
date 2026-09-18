"""Split an auto-tagged list item whose first physical line is an enumerated heading.

OpenDataLoader reads "A. Plans" + its paragraph as one LI (Lbl "A.", body the rest).
Stage 2 wild round 1: 17 of 22 covered misses were this shape. The head becomes its
own card; the numeral-only Lbl sibling is left alone (training convention: Lbl).

Opt-in on ``labels/suggest.py`` (``--split-enumerated-heads``) only: the training-key
builder (``build_keys.candidate_pool``) never calls this. Reads Cards.java's
``first_line`` / ``line_count``; a dump without them splits nothing.
"""
import re

ENUM_HEAD = re.compile(r"^(?:[IVX]+|[A-Z]|\d+)\.\s+\S")
SPLIT_TAGS = {"LI", "H", "H1", "H2", "H3", "H4", "H5", "H6"}
MAX_HEAD_WORDS = 6
LINE_EM = 1.3


def is_enumerated_head(block: dict) -> bool:
    first = (block.get("first_line") or "").strip()
    if block.get("existing_tag") not in SPLIT_TAGS or (block.get("line_count") or 0) < 2:
        return False
    if not ENUM_HEAD.match(first) or len(first.split()) > MAX_HEAD_WORDS:
        return False
    return not re.search(r"[.;:]$", first) and block.get("font_pt") is not None


def split_enumerated_heads(blocks: list[dict]) -> tuple[list[dict], int]:
    """New block list and the number of blocks split. Head ``<locator>h`` (the first line,
    ``y1`` cut at ``y0 + 1.3 em``), then the body under the original locator; other keys copied."""
    out, n = [], 0
    for b in blocks:
        if not is_enumerated_head(b):
            out.append(b)
            continue
        first = b["first_line"].strip()
        text = b.get("text") or ""
        if not text.startswith(first):
            out.append(b)
            continue
        cut = float(b["y0"]) + LINE_EM * float(b["font_pt"])
        head = {**b, "locator": f'{b["locator"]}h', "text": first, "y1": cut, "split": "head"}
        body = {**b, "text": text[len(first):].lstrip(), "y0": cut, "split": "body"}
        out.extend([head, body])
        n += 1
    return out, n
