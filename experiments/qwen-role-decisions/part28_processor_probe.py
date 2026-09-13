#!/usr/bin/env python3
"""Measure Qwen3.5's native image sizing without loading weights or training.

This is deliberately a processor-only contract probe. It records the actual
grid and language-model image-token count for the marked pages that the
upstream trainer would otherwise consume. It never calls ``mlx_vlm.load`` or
``mlx_vlm.lora``.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
from pathlib import Path


def image_tokens(grid_thw: list[int], merge_size: int) -> int:
    if len(grid_thw) != 3 or any(not isinstance(value, int) or value <= 0 for value in grid_thw):
        raise ValueError(f"invalid image grid: {grid_thw!r}")
    if merge_size <= 0:
        raise ValueError(f"invalid merge size: {merge_size}")
    patches = grid_thw[0] * grid_thw[1] * grid_thw[2]
    if patches % (merge_size**2):
        raise ValueError(f"grid {grid_thw!r} is incompatible with merge size {merge_size}")
    return patches // (merge_size**2)


def native_processor(model_path: Path):
    """Load only the processor, after registering MLX-VLM's Qwen patch."""
    from mlx_vlm.utils import get_model_and_args, load_config, load_processor

    config = load_config(model_path, local_files_only=True)
    # Importing the model package registers Qwen3VLProcessor with AutoProcessor.
    # It reads config only; loading model weights happens exclusively in load().
    get_model_and_args(config, model_path)
    processor = load_processor(model_path, add_detokenizer=False, local_files_only=True)
    if not hasattr(processor, "image_processor"):
        raise RuntimeError("processor has no image_processor")
    return config, processor


def measure(processor, image_path: Path, max_pixels: int | None) -> dict:
    from PIL import Image
    from mlx_vlm.utils import estimate_num_image_tokens

    image = Image.open(image_path).convert("RGB")
    controls = {} if max_pixels is None else {"max_pixels": max_pixels}
    processed = processor.image_processor(images=[image], **controls)
    grid = [int(value) for value in processed["image_grid_thw"][0].tolist()]
    merge_size = int(processor.image_processor.merge_size)
    tokens = image_tokens(grid, merge_size)
    estimated = estimate_num_image_tokens(processor, image.height, image.width, **controls)
    if tokens != estimated:
        raise RuntimeError(f"processed token count {tokens} != estimate {estimated}")
    patches = int(processed["pixel_values"].shape[0])
    if patches != grid[0] * grid[1] * grid[2]:
        raise RuntimeError(f"pixel patch count {patches} != image grid {grid}")
    patch_size = int(processor.image_processor.patch_size)
    return {
        "image": str(image_path),
        "source_size_wh": [image.width, image.height],
        "controls": controls,
        "processed_size_hw": [grid[1] * patch_size, grid[2] * patch_size],
        "grid_thw": grid,
        "pixel_values_shape": [int(value) for value in processed["pixel_values"].shape],
        "image_tokens": tokens,
        "estimated_image_tokens": estimated,
    }


def run(args: argparse.Namespace) -> dict:
    model_path = Path(args.model_path).resolve()
    if not model_path.is_dir():
        raise SystemExit(f"model path does not exist: {model_path}")
    images = [Path(value).resolve() for value in args.image]
    missing = [str(image) for image in images if not image.is_file()]
    if missing:
        raise SystemExit(f"image paths do not exist: {missing}")
    config, processor = native_processor(model_path)
    default = [measure(processor, image, None) for image in images]
    budgeted = [measure(processor, image, args.max_pixels) for image in images]
    default_tokens = [row["image_tokens"] for row in default]
    budgeted_tokens = [row["image_tokens"] for row in budgeted]
    if args.expect_default_tokens is not None and default_tokens != args.expect_default_tokens:
        raise SystemExit(
            f"default token contract changed: got {default_tokens}, "
            f"want {args.expect_default_tokens}"
        )
    if args.expect_budget_tokens is not None and budgeted_tokens != args.expect_budget_tokens:
        raise SystemExit(
            f"budget token contract changed: got {budgeted_tokens}, "
            f"want {args.expect_budget_tokens}"
        )
    return {
        "contract": "qwen3_5_native_processor_input",
        "mlx_vlm_version": importlib.metadata.version("mlx-vlm"),
        "model_path": str(model_path),
        "model_type": config.get("model_type"),
        "processor": type(processor).__name__,
        "image_processor": type(processor.image_processor).__name__,
        "patch_size": int(processor.image_processor.patch_size),
        "merge_size": int(processor.image_processor.merge_size),
        "default": default,
        "max_pixels": args.max_pixels,
        "budgeted": budgeted,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--image", action="append", required=True)
    parser.add_argument("--max-pixels", type=int, required=True)
    parser.add_argument("--expect-default-tokens", type=int, action="append")
    parser.add_argument("--expect-budget-tokens", type=int, action="append")
    return parser.parse_args()


if __name__ == "__main__":
    print(json.dumps(run(parse_args()), indent=2))
