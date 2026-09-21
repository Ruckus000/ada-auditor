"""Split auto-tagged blocks whose first physical line is really a heading.

Enumerated split (round 2): OpenDataLoader reads "A. Plans" + its paragraph as one
LI (Lbl "A.", body the rest). The head becomes its own card; the numeral-only Lbl
sibling is left alone (training convention: Lbl).

Run-in split (round 4): a P/LI/H* block whose first physical line is a short,
unclosed heading run into its body ("Plant Selection Native species thrive …")
splits the same way, gated by where the first line ends (``first_line_x1``).

Both are opt-in on ``labels/suggest.py`` (``--split-enumerated-heads`` /
``--split-run-in-heads``) only: the training-key builder (``build_keys.candidate_pool``)
never calls this. Reads Cards.java's ``first_line`` / ``line_count`` /
``first_line_x1``; a dump without them splits nothing.
"""
import re

ENUM_HEAD = re.compile(r"^(?:[IVX]+|[A-Z]|\d+)\.\s+\S")
SPLIT_TAGS = {"LI", "H", "H1", "H2", "H3", "H4", "H5", "H6"}
RUN_IN_TAGS = SPLIT_TAGS | {"P"}
MAX_HEAD_WORDS = 6
LINE_EM = 1.3


def head_words(line: str) -> int:
    """Tokens that carry a letter or digit; a punctuation-only token ("–", "&") is not a word."""
    return sum(1 for t in line.split() if re.search(r"\w", t))


def is_enumerated_head(block: dict) -> bool:
    first = (block.get("first_line") or "").strip()
    if block.get("existing_tag") not in SPLIT_TAGS or (block.get("line_count") or 0) < 2:
        return False
    if not ENUM_HEAD.match(first) or head_words(first) > MAX_HEAD_WORDS:
        return False
    return not re.search(r"[.;:]$", first) and block.get("font_pt") is not None


def split_enumerated_heads(blocks: list[dict]) -> tuple[list[dict], int]:
    """New block list and the number of blocks split. Head ``<locator>h`` (the first line,
    ``y1`` cut at ``y0 + 1.3 em``), then the body under the original locator; other keys copied.
    A block whose text does not start with its first line is left whole and not counted."""
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


def is_run_in_head(block: dict, width_frac: float) -> bool:
    """A run-in heading block: tag P/LI/H*, at least two physical lines, a first line of
    at most ``MAX_HEAD_WORDS`` words with no closing ``.;:``, ending before
    ``width_frac`` of the block width (``first_line_x1`` — a dump without it never splits).
    Table cells are out: a short first line there is a header cell, not a run-in heading."""
    if block.get("existing_tag") not in RUN_IN_TAGS or (block.get("line_count") or 0) < 2:
        return False
    if block.get("in_table_box") or block.get("font_pt") is None:
        return False
    first = (block.get("first_line") or "").strip()
    if not first or head_words(first) > MAX_HEAD_WORDS or re.search(r"[.;:]$", first):
        return False
    fx1 = block.get("first_line_x1")
    if fx1 is None:
        return False
    return float(fx1) - float(block["x0"]) < width_frac * (float(block["x1"]) - float(block["x0"]))


def split_run_in_heads(blocks: list[dict], width_frac: float) -> tuple[list[dict], int]:
    """New block list and the number of blocks split, with the same head/body mechanics
    as ``split_enumerated_heads`` (head ``<locator>h``, ``y1`` cut at ``y0 + 1.3 em``).
    A block already split, whose text does not start with its first line, or whose body
    would be empty is left whole and not counted."""
    if not 0.0 < width_frac < 1.0:
        raise ValueError(f"width_frac must be in (0, 1), got {width_frac}")
    out, n = [], 0
    for b in blocks:
        if b.get("split") or not is_run_in_head(b, width_frac):
            out.append(b)
            continue
        first = b["first_line"].strip()
        text = b.get("text") or ""
        if not text.startswith(first) or not text[len(first):].strip():
            out.append(b)
            continue
        cut = float(b["y0"]) + LINE_EM * float(b["font_pt"])
        head = {**b, "locator": f'{b["locator"]}h', "text": first, "y1": cut, "split": "head"}
        body = {**b, "text": text[len(first):].lstrip(), "y0": cut, "split": "body"}
        out.extend([head, body])
        n += 1
    return out, n
