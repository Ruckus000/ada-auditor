"""Stage 2 Task 1: advisory heading suggestions for one untagged PDF, as a JSON sidecar.

The card path is the keys pipeline's own, for one document: OpenDataLoader tags
a copy (``build_keys.odl``), ``build_keys.document_cards`` picks the candidates
(K35 dedupe, containers out, selection, cap), ``key_context.context_cards`` adds
the facts and ``marked_image`` the marked page (rendered from the input PDF),
``reduce_marked_408.py`` sizes the images, and ``predict.py --scores --own-stack``
decides — rules in front, then the model, whose approved-headings stack is its
own prior H decisions on the document, in reading order.

Advisory only: writes the sidecar and a per-run work directory
(``out/suggest/<stem>/`` by default), never modifies the PDF and never writes a
label row. ``proposed`` is ``score >= threshold``; rule-decided rows score 1.0.
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
from labels.build_keys import document_cards, odl
from labels.key_context import context_cards, marked_image
from labels.pdf_cards import SEED
from labels.predict import parsed
from labels.stage_pdfs import has_struct_tree

SIDECAR_KEYS = ("document", "threshold", "cards")
CARD_KEYS = ("card_id", "locator", "text", "type", "level", "rule", "score", "decided_by", "proposed")
LOCATOR_KEYS = ("page", "x0", "y0", "x1", "y1")
MODEL_SNAPSHOTS = Path.home() / ".cache/huggingface/hub/models--mlx-community--Qwen3.5-4B-MLX-4bit/snapshots"


def reading_order(card: dict) -> tuple:
    return (card.get("page") if card.get("page") is not None else 10**9, card.get("y0") or 0.0)


def assemble_sidecar(document: str, threshold: float, cards: list[dict], predictions: list[dict]) -> dict:
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
    out = []
    for c in sorted(cards, key=reading_order):
        p = by_id[c["card_id"]]
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
        })
    return {"document": document, "threshold": threshold, "cards": out}


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


def build_cards(pdf: Path, tagged: Path, stem: str, work: Path) -> list[dict]:
    raw = dump_pdf(tagged, compile=False)
    chosen = document_cards(tagged, stem, random.Random(SEED), dump=lambda _p, compile=False: raw)
    if chosen is None:
        raise RuntimeError(f"{stem}: Cards could not read the tagged copy")
    cards = context_cards(raw.get("blocks") or [], stem, {c["card_id"] for c in chosen})
    for c in cards:
        img = marked_image(c, pdf, work / "pages")
        c["image"] = None if img is None else str(img.resolve())
    return sorted(cards, key=reading_order)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--pdf", type=Path, required=True)
    p.add_argument("--adapter", required=True)
    p.add_argument("--threshold", type=float, required=True)
    p.add_argument("--python", required=True, help="the MLX interpreter (predict.py --scores runs under it)")
    p.add_argument("--out", type=Path, required=True, help="sidecar JSON path")
    p.add_argument("--work", type=Path, default=None, help="default out/suggest/<stem>")
    p.add_argument("--model-path", type=Path, default=None, help="local Qwen snapshot for the 408-token sizing; default the HF cache's")
    a = p.parse_args()
    started = time.monotonic()
    stem = a.pdf.stem
    work = a.work or Path("out/suggest") / stem
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
    cards = build_cards(a.pdf, tagged, stem, work)
    (work / "cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in cards))
    n_img = sum(1 for c in cards if c["image"])
    if n_img:
        subprocess.run([a.python, "-B", "reduce_marked_408.py", "--keys-dir", str(work),
                        "--model-path", str(a.model_path or default_model_path()), "--sample", str(min(5, n_img))], check=True)
    subprocess.run([a.python, "-B", "-m", "labels.predict", "--cards", str(work / "cards.jsonl"), "--own-stack", "--scores",
                    "--adapter", a.adapter, "--python", a.python, "--out", str(work / "predictions.jsonl")], check=True)
    cards = [json.loads(l) for l in (work / "cards.jsonl").read_text().splitlines() if l.strip()]
    preds = [json.loads(l) for l in (work / "predictions.jsonl").read_text().splitlines() if l.strip()]
    sidecar = assemble_sidecar(stem, a.threshold, cards, preds)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(sidecar, indent=2) + "\n")
    rows = sidecar["cards"]
    print(json.dumps({"document": stem, "cards": len(rows), "proposed": sum(r["proposed"] for r in rows),
                      "rule": sum(r["decided_by"] == "rule" for r in rows), "model": sum(r["decided_by"] == "model" for r in rows),
                      "seconds": round(time.monotonic() - started, 1), "out": str(a.out)}))


if __name__ == "__main__":
    main()
