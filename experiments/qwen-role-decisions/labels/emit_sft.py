"""Write the Stage 1 SFT directory (train.json) from key labels, cards and key ladders."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from labels.sft import emit

OUT = Path("out/keys")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--keys-dir", type=Path, default=OUT, help="holds labels.jsonl, cards.jsonl, key-headings.json")
    p.add_argument("--split", type=Path, default=OUT / "split" / "split.json")
    p.add_argument("--on", default="train")
    p.add_argument("--out", type=Path, default=Path("out/stage1/sft"))
    a = p.parse_args()
    rows = [json.loads(l) for l in (a.keys_dir / "labels.jsonl").read_text().splitlines() if l.strip()]
    cards = {c["card_id"]: c for c in (json.loads(l) for l in (a.keys_dir / "cards.jsonl").read_text().splitlines() if l.strip())}
    keys = json.loads((a.keys_dir / "key-headings.json").read_text())
    ids = set(json.loads(a.split.read_text())["ids"][a.on])
    sft, held = emit(rows, cards, keys, lambda c: c.get("image"), ids)
    a.out.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(sft, indent=1) + "\n"
    (a.out / "train.json").write_text(payload)
    types = {}
    for r in sft:
        t = json.loads(r["messages"][1]["content"])["type"]
        types[t] = types.get(t, 0) + 1
    manifest = {"n": len(sft), "held_back": held, "types": types, "split": a.on, "sha256": hashlib.sha256(payload.encode()).hexdigest()}
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
