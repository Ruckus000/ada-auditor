#!/usr/bin/env python3
"""Materialize a Qwen-native reduced-image SFT without changing its labels.

The stock MLX-VLM trainer does not forward ``image_resize_shape`` for Qwen's
native preprocessing path. This script is therefore an explicit *new input
baseline*: it uses the installed Qwen processor's own sizing math, resizes
only copies of the marked pages, and preserves every SFT message and label.
It never loads model weights and never starts training.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
PROBE_PATH = HERE / "part28_processor_probe.py"


def load_probe_module():
    spec = importlib.util.spec_from_file_location("part28_processor_probe", PROBE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load processor probe {PROBE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def image_name(index: int, image_path: Path) -> str:
    digest = hashlib.sha256(str(image_path).encode()).hexdigest()[:12]
    return f"{index:03d}-{digest}.png"


def resize_row(processor, image_path: Path, destination: Path, max_pixels: int) -> dict:
    image = Image.open(image_path).convert("RGB")
    processed = processor.image_processor(images=[image], max_pixels=max_pixels)
    grid = [int(value) for value in processed["image_grid_thw"][0].tolist()]
    patch_size = int(processor.image_processor.patch_size)
    size_hw = [grid[1] * patch_size, grid[2] * patch_size]
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size_hw[1], size_hw[0]), Image.Resampling.BICUBIC).save(destination)
    check = processor.image_processor(images=[Image.open(destination).convert("RGB")])
    check_grid = [int(value) for value in check["image_grid_thw"][0].tolist()]
    if check_grid != grid:
        raise RuntimeError(f"resized image grid {check_grid} != planned grid {grid}")
    tokens = grid[0] * grid[1] * grid[2] // int(processor.image_processor.merge_size) ** 2
    return {
        "source": str(image_path),
        "image": str(destination.resolve()),
        "source_size_wh": [image.width, image.height],
        "resized_size_wh": [size_hw[1], size_hw[0]],
        "grid_thw": grid,
        "image_tokens": tokens,
    }


def run(args: argparse.Namespace) -> dict:
    source = Path(args.source).resolve()
    if not source.is_file():
        raise SystemExit(f"source SFT does not exist: {source}")
    if args.max_pixels <= 0:
        raise SystemExit("--max-pixels must be positive")
    rows = json.loads(source.read_text())
    if not isinstance(rows, list) or not rows:
        raise SystemExit("source SFT must be a non-empty JSON list")
    images = [Path(row.get("image", "")).resolve() for row in rows]
    if any(not image.is_file() for image in images):
        raise SystemExit("source SFT contains missing image files")
    probe = load_probe_module()
    _, processor = probe.native_processor(Path(args.model_path).resolve())
    out_dir = Path(args.out_dir).resolve()
    image_dir = out_dir / "images"
    resized = [
        resize_row(processor, image, image_dir / image_name(index, image), args.max_pixels)
        for index, image in enumerate(images)
    ]
    output_rows = []
    for row, image in zip(rows, resized, strict=True):
        output = dict(row)
        output["image"] = image["image"]
        output_rows.append(output)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "train.json").write_text(json.dumps(output_rows, indent=2) + "\n")
    manifest = {
        "contract": "qwen3_5_native_processor_physical_input",
        "source_sft_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "rows": len(output_rows),
        "max_pixels": args.max_pixels,
        "image_tokens": sorted({row["image_tokens"] for row in resized}),
        "images": resized,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--max-pixels", type=int, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    print(json.dumps(run(parse_args()), indent=2))
