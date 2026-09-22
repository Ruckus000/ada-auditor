r"""Assemble the predict-ready cards file for the run-in fold view.

The end-to-end run-in fold (labels/judge/refold.sh with the wild-v5-r5 swap)
reads each wild document's sidecar from the first directory that has one, in
priority order ``wild-v5-r5``, ``wild-v4-runin``, then the document's original
round (``wild-v2`` or ``wild-r3``). ``predict.py`` takes a single ``--cards``
file, so this module concatenates the chosen directories' work ``cards.jsonl``
in fold order (round v2 documents then round r3, each alphabetical) and refuses
to write anything unless the assembled ids, in order, are exactly the fold's
card ids. Used by strategy C's single wild look: the r13 re-prediction scores
exactly the fold's cards, so the gate recompute stays apples-to-apples.

    python3 -B -m labels.fold_view_cards --fold-cards out/labels/wild-23-cards-runin.jsonl \
        --suggest-root out/suggest --out out/overnight/08-assemble-wild-fold-cards/cards.jsonl \
        --report out/overnight/08-assemble-wild-fold-cards/report.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

PRIORITY = ("wild-v5-r5", "wild-v4-runin")
ROUND_DIR = {"v2": "wild-v2", "r3": "wild-r3"}
ROUNDS = ("v2", "r3")


def chosen_dirs(suggest_root: Path) -> list[tuple[str, str, Path]]:
    """(round, document, chosen directory) per fold document, in fold order."""
    out: list[tuple[str, str, Path]] = []
    for round_ in ROUNDS:
        base = suggest_root / ROUND_DIR[round_]
        docs = sorted(p.name for p in base.glob("c3-*") if p.is_dir())
        for doc in docs:
            for candidate in (*PRIORITY, ROUND_DIR[round_]):
                d = suggest_root / candidate / doc
                if (d / "sidecar.json").is_file() and (d / "cards.jsonl").is_file():
                    out.append((round_, doc, d))
                    break
            else:
                raise SystemExit(f"{doc}: no sidecar.json + cards.jsonl in any of {(*PRIORITY, ROUND_DIR[round_])}")
    return out


def assemble(fold_cards_path: Path, suggest_root: Path, out_path: Path, report_path: Path | None = None) -> dict:
    if out_path.exists():
        raise SystemExit(f"refusing to overwrite {out_path}")
    chosen = chosen_dirs(suggest_root)
    rows: list[dict] = []
    for _, _, d in chosen:
        rows += [json.loads(l) for l in (d / "cards.jsonl").read_text().splitlines() if l.strip()]
    fold_ids = [json.loads(l)["id"] for l in fold_cards_path.read_text().splitlines() if l.strip()]
    got = [r["card_id"] for r in rows]
    if got != fold_ids:
        for i, (a, b) in enumerate(zip(got, fold_ids)):
            if a != b:
                detail = f"first mismatch at row {i}: assembled {a!r} vs fold {b!r}"
                break
        else:
            detail = f"length mismatch: assembled {len(got)} vs fold {len(fold_ids)}"
        raise SystemExit(f"assembled cards are not the fold's cards: {detail}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    report = {
        "documents": len(chosen),
        "rows": len(rows),
        "chosen": {doc: d.parent.name for _, doc, d in chosen},
        "sha256": hashlib.sha256(out_path.read_bytes()).hexdigest(),
        "fold_cards": str(fold_cards_path),
    }
    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=1) + "\n")
    return report


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--fold-cards", type=Path, required=True)
    p.add_argument("--suggest-root", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--report", type=Path, default=None)
    a = p.parse_args()
    print(json.dumps(assemble(a.fold_cards, a.suggest_root, a.out, a.report), indent=1))


if __name__ == "__main__":
    main()
