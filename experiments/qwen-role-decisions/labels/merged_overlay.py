"""Strategy C (registered 2026-09-22): overlay keys-all-9 so merged blocks train as H.

The convention fix. A train positive (``labels.merged_probe``: a multi-line
block whose first line normalizes to a key heading of the same document, at
least 3 body words after it) is a merged heading+body block. Judges call such
a block H; the keys said non-H, and r10 learned that.

Finding that shapes this module (2026-09-22, dev build 336caf83): of 1,152
train positives only 7 have a keys-all-9 label row at all — the other 1,145
merged blocks never became cards (``blocks_to_cards``/the key matcher kept
only matched blocks; a merged block's norm contains the key heading's norm, so
it falls out of the candidate pool). Relabelling alone would change 6 rows and
teach the model nothing. The overlay therefore does both:

- relabel: every listed id with an existing non-H label row becomes H at the
  matched key level, the old row kept under ``superseded``;
- append (with ``--block-cards``): every listed id without a label row gets
  the whole-block card from merged_probe's ``block-cards.jsonl`` appended to
  cards.jsonl and a new H label row appended to labels.jsonl; ``--split`` is
  copied with the appended ids added to ``ids.train`` so ``emit_sft`` admits
  them. Nothing else changes: no original row is removed or edited beyond the
  relabels, key-headings.json is byte-identical, and validation positives are
  never touched (the input list is train-only).

Every listed id that names a label row must exist with the listed current
type; every appended id must be absent from cards, labels and every split arm;
any mismatch means the inputs came from another build and the overlay refuses
to run. Output rows are deterministic: fixed ``labelled_at``, answer id
derived from the card id. New label source ``key-merged-first-line``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from collections import Counter
from pathlib import Path

from labels.merged_probe import KEYS_CARD_FIELDS

LABEL_SOURCE = "key-merged-first-line"
ACTOR = "key:merged-first-line"
LABELLED_AT = "2026-09-22T00:00:00+00:00"  # fixed: the overlay is deterministic


def overlay_row(row: dict, pos: dict) -> dict:
    """The relabelled row: H at the key level, the old row under ``superseded``."""
    out = dict(row)
    out["type"] = "H"
    out["key_locator"] = pos["key_locator"]
    out["label"] = {"heading": True, "level": pos["key_level"]}
    out["superseded"] = {"type": row["type"], "label": row["label"], "label_source": row.get("label_source")}
    out["label_source"] = LABEL_SOURCE
    out["actor"] = ACTOR
    out["answer_id"] = f"{ACTOR}:{row['id']}"
    out["labelled_at"] = LABELLED_AT
    return out


def appended_row(pos: dict, card: dict) -> dict:
    """A new H label row for a positive that never had one (append mode)."""
    return {"id": pos["id"], "card_id": pos["id"], "document_id": pos["document_id"], "kind": "pdf",
            "type": "H", "match": "merged-first-line", "key_locator": pos["key_locator"],
            "label": {"heading": True, "level": pos["key_level"]},
            "label_source": LABEL_SOURCE, "actor": ACTOR, "answer_id": f"{ACTOR}:{pos['id']}",
            "text_sha256": hashlib.sha256((card.get("text") or "").encode()).hexdigest(),
            "labelled_at": LABELLED_AT}


def overlay(keys_dir: Path, positives_path: Path, out: Path,
            block_cards_path: Path | None = None, split_path: Path | None = None) -> dict:
    if out.exists():
        raise SystemExit(f"{out} exists; choose a new name (provenance)")
    if (block_cards_path is None) != (split_path is None):
        raise SystemExit("append mode needs both --block-cards and --split")
    rows = [json.loads(l) for l in (keys_dir / "labels.jsonl").read_text().splitlines() if l.strip()]
    by_id = {r["id"]: r for r in rows}
    cards = [json.loads(l) for l in (keys_dir / "cards.jsonl").read_text().splitlines() if l.strip()]
    card_ids = {c["card_id"] for c in cards}
    positives = json.loads(positives_path.read_text())
    block_cards = ({json.loads(l)["card_id"]: json.loads(l)
                    for l in block_cards_path.read_text().splitlines() if l.strip()}
                   if block_cards_path is not None else {})
    split = json.loads(split_path.read_text()) if split_path is not None else None
    counts: Counter = Counter()
    relabel: dict[str, dict] = {}
    append: dict[str, dict] = {}
    problems = []
    for pos in positives:
        level = pos.get("key_level")
        if not isinstance(level, int) or not 1 <= level <= 6:
            problems.append(f"{pos['id']}: key_level {level!r} is not 1..6")
            continue
        listed = pos.get("label_type")
        if listed is None:
            if block_cards_path is None:
                counts["no_label_row"] += 1
                continue
            card = block_cards.get(pos["id"])
            if card is None:
                problems.append(f"{pos['id']}: no label row and no block card (same build?)")
                continue
            if set(card) != set(KEYS_CARD_FIELDS):
                problems.append(f"{pos['id']}: block card fields {sorted(set(card) ^ set(KEYS_CARD_FIELDS))}")
                continue
            if pos["id"] in by_id or pos["id"] in card_ids:
                problems.append(f"{pos['id']}: no label row listed, but the id already exists")
                continue
            if any(pos["id"] in split["ids"].get(arm, []) for arm in split["ids"]):
                problems.append(f"{pos['id']}: already in the split")
                continue
            append[pos["id"]] = pos
            counts["appended"] += 1
            continue
        row = by_id.get(pos["id"])
        if row is None:
            problems.append(f"{pos['id']}: in the list but not in {keys_dir / 'labels.jsonl'}")
            continue
        if row["type"] != listed:
            problems.append(f"{pos['id']}: list says type {listed!r}, labels say {row['type']!r}")
            continue
        if row["type"] == "H":
            counts["already_h"] += 1
            continue
        relabel[pos["id"]] = pos
        counts[f"from_{row['type']}"] += 1
        counts[f"source_{row.get('label_source')}"] += 1
    if problems:
        raise SystemExit("overlay refused:\n" + "\n".join(problems[:30]))
    counts["relabelled"] = len(relabel)
    out_rows = [overlay_row(r, relabel[r["id"]]) if r["id"] in relabel else r for r in rows]
    out_rows += [appended_row(pos, block_cards[pid]) for pid, pos in sorted(append.items())]
    out.mkdir(parents=True)
    (out / "labels.jsonl").write_text("".join(json.dumps(r) + "\n" for r in out_rows))
    out_cards = cards + [block_cards[pid] for pid in sorted(append)]
    (out / "cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in out_cards))
    shutil.copyfile(keys_dir / "key-headings.json", out / "key-headings.json")
    if split is not None:
        out_split = {**split, "ids": {arm: list(ids) for arm, ids in split["ids"].items()}}
        out_split["ids"]["train"] = out_split["ids"]["train"] + sorted(append)
        (out / "split.json").write_text(json.dumps(out_split, indent=1) + "\n")
        counts["added_to_split_train"] = len(append)
    report = {"keys_dir": str(keys_dir), "positives": len(positives), **dict(sorted(counts.items()))}
    (out / "overlay-report.json").write_text(json.dumps(report, indent=1) + "\n")
    return report


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--keys-dir", type=Path, required=True)
    p.add_argument("--positives", type=Path, required=True)
    p.add_argument("--block-cards", type=Path, default=None,
                   help="merged_probe block-cards.jsonl: append rows for positives without a label row")
    p.add_argument("--split", type=Path, default=None,
                   help="split.json to copy with the appended ids added to ids.train")
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args(argv)
    print(json.dumps(overlay(a.keys_dir, a.positives, a.out, a.block_cards, a.split), indent=1))


if __name__ == "__main__":
    main()
