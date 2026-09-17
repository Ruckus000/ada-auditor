"""Write the Stage 1 SFT directory (train.json) from key labels, cards and key ladders."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from labels.sft import cap_planted_headings, emit

OUT = Path("out/keys")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--keys-dir", type=Path, default=OUT, help="holds labels.jsonl, cards.jsonl, key-headings.json")
    p.add_argument("--split", type=Path, default=OUT / "split" / "split.json")
    p.add_argument("--on", default="train")
    p.add_argument("--out", type=Path, default=Path("out/stage1/sft"))
    p.add_argument("--exclude-doc-prefix", action="append", default=[],
                   help="drop label rows whose document_id starts with this, before emit (repeatable)")
    p.add_argument("--max-planted-heading-share", type=float, default=None,
                   help="after emit, drop planted H rows (sha256(id) order) until they are at most this share of H rows")
    p.add_argument("--oversample-regular-h", type=int, default=1,
                   help="emit every H row whose card weight is regular this many times in total (1 = no change); SFT only, never labels")
    return p.parse_args(argv)


def oversample_regular_h(sft: list[dict], sources: list[dict], cards: dict, factor: int) -> tuple[list[dict], list[dict], dict]:
    """Round 10: repeat regular-weight heading rows in place; the copies carry `#dup{k}` ids in the sources list only."""
    out_sft, out_src, added, regular, bold = [], [], [], 0, 0
    for row, src in zip(sft, sources):
        out_sft.append(row); out_src.append(src)
        if src["type"] != "H":
            continue
        if cards[src["id"]].get("weight") != "regular":
            bold += 1
            continue
        regular += 1
        for k in range(1, factor):
            out_sft.append(row); out_src.append({**src, "id": f"{src['id']}#dup{k}"})
            added.append(f"{src['id']}#dup{k}")
    return out_sft, out_src, {"factor": factor, "regular_h": regular, "bold_h": bold, "added": len(added), "ids": added}


def main(argv: list[str] | None = None) -> None:
    a = parse_args(argv)
    rows = [json.loads(l) for l in (a.keys_dir / "labels.jsonl").read_text().splitlines() if l.strip()]
    cards = {c["card_id"]: c for c in (json.loads(l) for l in (a.keys_dir / "cards.jsonl").read_text().splitlines() if l.strip())}
    keys = json.loads((a.keys_dir / "key-headings.json").read_text())
    ids = set(json.loads(a.split.read_text())["ids"][a.on])
    extra = {}
    if a.exclude_doc_prefix:
        prefixes = tuple(a.exclude_doc_prefix)
        before = len(rows)
        rows = [r for r in rows if not r["document_id"].startswith(prefixes)]
        extra["excluded_doc_prefix"] = {"prefixes": list(prefixes), "rows": before - len(rows)}
    sources: list[dict] = []
    sft, held = emit(rows, cards, keys, lambda c: c.get("image"), ids, sources)
    if a.max_planted_heading_share is not None:
        sft, sources, extra["planted_cap"] = cap_planted_headings(sft, sources, a.max_planted_heading_share)
    if a.oversample_regular_h > 1:
        sft, sources, extra["oversample_regular_h"] = oversample_regular_h(sft, sources, cards, a.oversample_regular_h)
    a.out.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(sft, indent=1) + "\n"
    (a.out / "train.json").write_text(payload)
    types = {}
    for r in sft:
        t = json.loads(r["messages"][1]["content"])["type"]
        types[t] = types.get(t, 0) + 1
    manifest = {"n": len(sft), "held_back": held, "types": types, "split": a.on, "sha256": hashlib.sha256(payload.encode()).hexdigest(), **extra}
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
