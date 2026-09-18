"""Stage 2 Task 1: advisory heading suggestions for one untagged PDF, as a JSON sidecar.

The card path is the keys pipeline's own, for one document: OpenDataLoader tags
a copy (``build_keys.odl``), ``build_keys.document_cards`` picks the candidates
(K35 dedupe, containers out, selection, cap — or, with ``--all-blocks``, every
block in that pool, uncapped, up to ``ALL_BLOCKS_LIMIT``), ``key_context.context_cards`` adds
the facts and ``marked_image`` the marked page (rendered from the input PDF),
``reduce_marked_408.py`` sizes the images, and ``predict.py --scores --own-stack``
decides — rules in front, then the model, whose approved-headings stack is its
own prior H decisions on the document, in reading order.
With ``--split-enumerated-heads``, an LI/H block whose first physical line is a short
enumerated heading ("A. Plans") becomes a head card and a body card first
(``labels.split_heads``); the training-key builder never does this.

Advisory only: writes the sidecar and a per-run work directory
(``out/suggest/<stem>/`` by default), never modifies the PDF and never writes a
label row. ``proposed`` is ``score >= threshold``; rule-decided rows score 1.0.
``depends_on`` lists the cards whose H decisions were in a card's stack when it
was predicted (``predict.OwnStack``, replayed): an answer that changes one of
them makes that suggestion stale. Pages are 0-based (``page_base``).
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import time
from pathlib import Path

from run import compile_cards, dump_pdf
from labels.build_keys import candidate_pool, document_cards, odl
from labels.key_context import context_cards, marked_image
from labels.pdf_cards import SEED
from labels.predict import OwnStack, parsed
from labels.split_heads import split_enumerated_heads
from labels.stage_pdfs import has_struct_tree

SIDECAR_KEYS = ("document", "threshold", "page_base", "coverage", "cards")
CARD_KEYS = ("card_id", "locator", "text", "type", "level", "rule", "score", "decided_by", "proposed", "depends_on", "in_table_box", "asked")
COVERAGE_KEYS = ("blocks_total", "cards_considered", "selector", "not_heading_confident", "table_vetoed", "table_not_heading_confident", "split_heads")
SELECTORS = {False: "likely-headings+5%", True: "all-blocks"}
# A wall-time budget, not a quality bound: --all-blocks costs about 2.1 s per
# model-decided card (c3-0128: 166 model cards in 397.7 s), so 600 blocks is
# roughly 20 minutes. Above it, --all-blocks falls back to the default selector.
ALL_BLOCKS_LIMIT = 600
LOCATOR_KEYS = ("page", "x0", "y0", "x1", "y1")
MODEL_SNAPSHOTS = Path.home() / ".cache/huggingface/hub/models--mlx-community--Qwen3.5-4B-MLX-4bit/snapshots"


def reading_order(card: dict) -> tuple:
    return (card.get("page") if card.get("page") is not None else 10**9, card.get("y0") or 0.0)


def in_table_non_h(row: dict) -> bool:
    """Inside a table box and not predicted H: not a document heading, whatever the score.
    The model's H overrides the veto (that card is still asked)."""
    return bool(row["in_table_box"]) and row["type"] != "H"


def table_vetoed(row: dict) -> bool:
    """An ask the veto removed: in table, non-H, and below threshold (it would have been asked otherwise)."""
    return in_table_non_h(row) and not row["proposed"]


def not_heading_confident(row: dict) -> bool:
    """Considered, not a heading, and not asked: a proposed non-H, or a table-vetoed card."""
    return row["type"] != "H" and (row["proposed"] or table_vetoed(row))


def asked(row: dict) -> bool:
    """The ask rule, the source of truth for the sidecar's ``asked`` flag: type H at any score
    (never vetoed), or below threshold and not vetoed."""
    return (row["type"] == "H" or not row["proposed"]) and not table_vetoed(row)


def assemble_sidecar(document: str, threshold: float, cards: list[dict], predictions: list[dict],
                     blocks_total: int, selector: str, split_heads: int = 0) -> dict:
    """The sidecar from candidate cards and their prediction rows (pure; no I/O).

    Every card appears, in reading order, including abstentions. Type, level and
    rule are exactly as the rule or the model emitted them; a row with no score
    is never proposed.
    """
    by_id = {p["id"]: p for p in predictions}
    card_ids = {c["card_id"] for c in cards}
    if card_ids != set(by_id):
        raise ValueError(f"cards without a prediction: {sorted(card_ids - set(by_id))}; "
                         f"predictions without a card: {sorted(set(by_id) - card_ids)}")
    out, stack = [], OwnStack()
    for c in sorted(cards, key=reading_order):
        p = by_id[c["card_id"]]
        depends_on = [h["locator"] for h in stack.before({**c, "document_id": document})]
        stack.record(p["raw"], {**c, "document_id": document})
        data = parsed(p["raw"]) or {}
        score = p.get("score")
        out.append({
            "card_id": c["card_id"],
            "locator": {k: c.get(k) for k in LOCATOR_KEYS},
            "text": c.get("text"),
            "type": data.get("type"),
            "level": data.get("level"),
            "rule": data.get("rule"),
            "score": score,
            "decided_by": p["decided_by"],
            "proposed": score is not None and score >= threshold,
            "depends_on": depends_on,
            "in_table_box": bool(c.get("in_table_box")),
        })
        out[-1]["asked"] = asked(out[-1])
    return {"document": document, "threshold": threshold, "page_base": 0,
            "coverage": coverage_of(out, blocks_total, selector, split_heads), "cards": out}


def coverage_of(rows: list[dict], blocks_total: int, selector: str, split_heads: int = 0) -> dict:
    """Counts over the rows.

    ``not_heading_confident`` keeps its definition: every card recorded as considered,
    not a heading, and not asked -- confident (proposed) non-H cards plus table-vetoed
    ones. It is the complement of ``asked``. Two table sub-counts: ``table_vetoed``,
    the asks the veto removed (in table, non-H, below threshold); and
    ``table_not_heading_confident``, in-table non-H cards that were already proposed.
    ``split_heads`` is how many blocks ``--split-enumerated-heads`` split (0 when off).
    """
    return {"blocks_total": blocks_total, "cards_considered": len(rows), "selector": selector,
            "not_heading_confident": sum(map(not_heading_confident, rows)), "table_vetoed": sum(map(table_vetoed, rows)),
            "table_not_heading_confident": sum(1 for r in rows if in_table_non_h(r) and r["proposed"]),
            "split_heads": split_heads}


def default_model_path() -> Path:
    snaps = sorted(MODEL_SNAPSHOTS.glob("*"))
    if len(snaps) != 1:
        raise FileNotFoundError(f"expected one snapshot under {MODEL_SNAPSHOTS}, found {len(snaps)}; pass --model-path")
    return snaps[0]


def tag(pdf: Path, work: Path, stem: str) -> Path:
    """OpenDataLoader over a one-file directory, the way build_keys tags a batch."""
    inp, outp = work / "odl-in", work / "odl-out"
    inp.mkdir(parents=True)
    shutil.copyfile(pdf, inp / f"{stem}.pdf")
    odl(inp, outp)
    tagged = outp / f"{stem}.pdf"
    if not tagged.is_file() or not has_struct_tree(tagged):
        raise RuntimeError(f"{stem}: OpenDataLoader produced no tagged copy")
    return tagged


def choose_cards(raw: dict, stem: str, all_blocks: bool, split_heads: bool = False) -> tuple[list[dict], int, str, int]:
    """The cards to suggest for, with their facts, in reading order; the pool size
    (``blocks_total``); the selector actually used; and how many blocks were split.
    ``all_blocks`` over a pool larger than ``ALL_BLOCKS_LIMIT`` falls back to the
    default selector, and says so. ``split_heads`` splits enumerated heading lines out
    of auto-tagged list items first (``labels.split_heads``), so the pool counts both halves."""
    blocks, n_split = split_enumerated_heads(raw.get("blocks") or []) if split_heads else (raw.get("blocks") or [], 0)
    raw = {**raw, "blocks": blocks}
    blocks_total = len(candidate_pool(raw, stem))
    every = all_blocks and blocks_total <= ALL_BLOCKS_LIMIT
    selector = SELECTORS[every]
    if all_blocks and not every:
        selector += f" (all-blocks capped: {blocks_total} > {ALL_BLOCKS_LIMIT})"
    chosen = document_cards(Path(stem), stem, random.Random(SEED), dump=lambda _p, compile=False: raw, select=not every)
    cards = context_cards(raw.get("blocks") or [], stem, {c["card_id"] for c in chosen})
    return sorted(cards, key=reading_order), blocks_total, selector, n_split


def build_cards(pdf: Path, tagged: Path, stem: str, work: Path, all_blocks: bool,
                split_heads: bool = False) -> tuple[list[dict], int, str, int]:
    cards, blocks_total, selector, n_split = choose_cards(dump_pdf(tagged, compile=False), stem, all_blocks, split_heads)
    for c in cards:
        img = marked_image(c, pdf, work / "pages")
        c["image"] = None if img is None else str(img.resolve())
    return cards, blocks_total, selector, n_split


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--pdf", type=Path, required=True)
    p.add_argument("--adapter", required=True)
    p.add_argument("--threshold", type=float, required=True)
    p.add_argument("--python", required=True, help="the MLX interpreter (predict.py --scores runs under it)")
    p.add_argument("--out", type=Path, required=True, help="sidecar JSON path")
    p.add_argument("--work", type=Path, default=None, help="default: the sidecar's directory")
    p.add_argument("--all-blocks", action="store_true",
                   help=f"every text block of the pool, no selection and no cap, up to {ALL_BLOCKS_LIMIT} blocks (a wall-time budget)")
    p.add_argument("--split-enumerated-heads", action="store_true",
                   help="split an LI/H block whose first physical line is a short enumerated heading into head + body cards")
    p.add_argument("--model-path", type=Path, default=None, help="local Qwen snapshot for the 408-token sizing; default the HF cache's")
    a = p.parse_args()
    started = time.monotonic()
    stem = a.pdf.stem
    work = a.work or a.out.parent
    compile_cards()
    if has_struct_tree(a.pdf):
        raise SystemExit(f"{a.pdf} already has a structure tree; suggest is for untagged PDFs")
    # Start clean: stale tagger output or images mask a failed or changed run.
    for sub in ("odl-in", "odl-out", "pages"):
        shutil.rmtree(work / sub, ignore_errors=True)
    for f in ("cards.jsonl", "predictions.jsonl"):
        (work / f).unlink(missing_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    tagged = tag(a.pdf, work, stem)
    cards, blocks_total, selector, n_split = build_cards(a.pdf, tagged, stem, work, a.all_blocks, a.split_enumerated_heads)
    (work / "cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in cards))
    n_img = sum(1 for c in cards if c["image"])
    if n_img:
        subprocess.run([a.python, "-B", "reduce_marked_408.py", "--keys-dir", str(work),
                        "--model-path", str(a.model_path or default_model_path()), "--sample", str(min(5, n_img))], check=True)
    subprocess.run([a.python, "-B", "-m", "labels.predict", "--cards", str(work / "cards.jsonl"), "--own-stack", "--scores",
                    "--adapter", a.adapter, "--python", a.python, "--out", str(work / "predictions.jsonl")], check=True)
    cards = [json.loads(l) for l in (work / "cards.jsonl").read_text().splitlines() if l.strip()]
    preds = [json.loads(l) for l in (work / "predictions.jsonl").read_text().splitlines() if l.strip()]
    sidecar = assemble_sidecar(stem, a.threshold, cards, preds, blocks_total, selector, n_split)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(sidecar, indent=2) + "\n")
    rows = sidecar["cards"]
    print(json.dumps({"document": stem, "cards": len(rows), "proposed": sum(r["proposed"] for r in rows),
                      "rule": sum(r["decided_by"] == "rule" for r in rows), "model": sum(r["decided_by"] == "model" for r in rows), **sidecar["coverage"],
                      "seconds": round(time.monotonic() - started, 1), "out": str(a.out)}))


if __name__ == "__main__":
    main()
