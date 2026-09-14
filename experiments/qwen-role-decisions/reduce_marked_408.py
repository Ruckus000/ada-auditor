#!/usr/bin/env python3
"""Round 2 (S10.1): reduce every marked image of a keys dir to the Part 28 408-token contract.

Sizing is Part 28's own: ``part28_resize_sft.resize_row`` (the native Qwen
processor's ``max_pixels`` math, then a default-preprocessing grid check) —
imported, not copied. Writes ``<keys>/pages/marked-408/<same name>`` and rewrites
``<keys>/cards.jsonl`` so ``image`` is the reduced copy and ``image_full`` the
original. Loads only the processor; never model weights. Needs the MLX venv.
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

from part28_processor_probe import measure, native_processor
from part28_resize_sft import resize_row

MAX_PIXELS = 448000  # Part 28: 1,750 -> 408 tokens on the marked pages


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--keys-dir", type=Path, required=True)
    p.add_argument("--model-path", type=Path, required=True)
    p.add_argument("--max-pixels", type=int, default=MAX_PIXELS)
    p.add_argument("--sample", type=int, default=5)
    p.add_argument("--seed", type=int, default=0)
    a = p.parse_args()
    _, processor = native_processor(a.model_path.resolve())
    marked = a.keys_dir / "pages" / "marked"
    reduced_dir = a.keys_dir / "pages" / "marked-408"
    sources = sorted(marked.glob("*.png"))
    tokens = Counter()
    for src in sources:
        row = resize_row(processor, src, reduced_dir / src.name, a.max_pixels)
        tokens[row["image_tokens"]] += 1
    cards_path = a.keys_dir / "cards.jsonl"
    cards = [json.loads(l) for l in cards_path.read_text().splitlines() if l.strip()]
    rewritten = 0
    for c in cards:
        full = c.get("image_full") or c.get("image")
        if full is None:
            continue
        reduced = (reduced_dir / Path(full).name).resolve()
        if not reduced.is_file():
            raise FileNotFoundError(f"{c['card_id']}: no reduced copy {reduced}")
        c["image_full"], c["image"] = full, str(reduced)
        rewritten += 1
    cards_path.write_text("".join(json.dumps(c) + "\n" for c in cards))
    sample = random.Random(a.seed).sample(sorted(reduced_dir.glob("*.png")), a.sample)
    check = [{"image": s.name, "default_image_tokens": measure(processor, s, None)["image_tokens"]} for s in sample]
    print(json.dumps({"source_images": len(sources), "reduced_images": len(list(reduced_dir.glob("*.png"))),
                      "planned_tokens": dict(tokens), "cards": len(cards), "cards_rewritten": rewritten,
                      "max_pixels": a.max_pixels, "sample_default_check": check}))


if __name__ == "__main__":
    main()
