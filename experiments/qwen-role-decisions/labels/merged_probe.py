"""Merged heading+body blocks: the dev set and the first-line probe (strategy A).

Registered 2026-09-22 in
``docs/superpowers/plans/2026-09-22-merged-heading-strategies.md`` (Step 0).

The gate's remaining covered errors are mostly merged heading+body blocks: the
tagger glued a heading line and its body into one block. Judges call such a
block H; the training keys call it non-H, so r10 scores every one non-H with
high confidence. The probe asks r10 about the block's FIRST LINE as its own
card (the head construction ``labels.split_heads`` already uses, ungated):
``p_H >= tau`` means the first line alone looks like a heading to the model.

Dev set (keys struct-tree truth; never wild; the test split is never read):

- positive: a multi-line block (Cards ``line_count`` >= 2) with at least 3 body
  words after the first line, whose first line normalizes (``run.text_norm``)
  to a key heading of the same document — train and validation documents;
- negative: every other multi-line block of a validation document, seeded
  sample (``SAMPLE_SEED``) capped at ``NEGATIVE_CAP``;
- container-tag blocks (``labels.keys.CONTAINER_TAGS``) are excluded, as are
  blocks whose text does not start with their first line (the head card cannot
  be built — the split modules leave such blocks whole too), and every
  document that has a wild sidecar under ``--wild-root``.

The probe card for a block is the head card ``split_heads`` would make, without
the split gates: text = the first line, ``y1`` cut at ``y0 + 1.3 em``; the next
text is the body; every other fact is the block's. Probe ids carry an ``mh``
suffix so they can never collide with a real ``<locator>h`` split head.

Images are the pipeline's own (``key_context.marked_image`` from the stripped
copy), reduced to the 408-token contract (<= 448,000 px, 28 px grid) in PIL —
the same sizing reduce_marked_408.py applies with the Qwen processor.
``--no-images`` writes ``image: null`` instead: a sandbox/verification mode
(selection and the dev-set sha do not depend on images), never a scoring input.

Scripts and one module: no model calls here, no labels written, no PDF
modified. Refuses to overwrite an existing --out unless --overwrite is passed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

from run import collapse_glyph_spaces, compile_cards, dump_pdf, text_norm
from labels.key_context import context_cards, marked_image
from labels.keys import CONTAINER_TAGS
from labels.split_heads import LINE_EM, head_words

NEGATIVE_CAP = 600
SAMPLE_SEED = 20260922
MIN_BODY_WORDS = 3
PROBE_SUFFIX = "mh"
MAX_PIXELS = 448000  # the 408-token contract (reduce_marked_408.MAX_PIXELS)
GRID = 28
DISCLOSURE = ("dev truth is the keys struct tree (key-headings.json; label sources stripped-tree / "
              "word-outline / planted); no judged labels read; wild gate documents excluded; "
              "test split never read")


def norm(text: str) -> str:
    return text_norm(text or "")


def doc_splits(split: dict) -> dict[str, str]:
    """Document id -> "train" | "validation" from the split's card ids.

    The test id list is never opened. A document whose cards land in more than
    one of the two splits is a contract violation, not a case to guess.
    """
    out: dict[str, str] = {}
    for arm in ("train", "validation"):
        for card_id in split["ids"][arm]:
            doc = card_id.split(":")[0]
            if doc in out and out[doc] != arm:
                raise ValueError(f"{doc}: cards in both train and validation")
            out[doc] = arm
    return out


def key_norms(headings: list[dict]) -> set[str]:
    """A document's normalized key-heading texts; empty headings never match."""
    return {n for n in (norm(h.get("text")) for h in headings) if n}


def match_key(first_norm: str, headings: list[dict], block: dict) -> dict | None:
    """The key heading a positive's first line names: same norm; prefer the block's page,
    then the nearest y0, then document order (the list is reading order)."""
    cands = [h for h in headings if norm(h.get("text")) == first_norm]
    if not cands:
        return None
    page = block.get("page")
    y0 = block.get("y0")
    same_page = [h for h in cands if h.get("page") == page]
    pool = same_page or cands
    if y0 is not None:
        pool = sorted(pool, key=lambda h: abs((h.get("y0") if h.get("y0") is not None else 1e9) - y0))
    return pool[0]


def body_of(block: dict) -> str | None:
    """The block text after its first line, or None when the text does not start with it."""
    first = (block.get("first_line") or "").strip()
    text = block.get("text") or ""
    if not first or not text.startswith(first):
        return None
    return text[len(first):].lstrip()


def is_multiline_block(block: dict) -> bool:
    return (block.get("line_count") or 0) >= 2


def classify_block(block: dict, keys: set[str]) -> str | None:
    """"positive" | "negative" | None (not in the dev population)."""
    if block.get("existing_tag") in CONTAINER_TAGS or not is_multiline_block(block):
        return None
    body = body_of(block)
    if body is None or head_words(body) < MIN_BODY_WORDS:
        return None
    first_norm = norm(block.get("first_line"))
    return "positive" if first_norm and first_norm in keys else "negative"


def probe_card(block: dict, facts: dict, doc_id: str) -> dict:
    """The first-line-of-``block`` card: split_heads' head construction, ungated.

    ``facts`` is the block's own context card (``key_context.context_cards`` over the
    document's full block list): prev/next, repeats, margin band, inline label.
    """
    first = (block.get("first_line") or "").strip()
    body = body_of(block)
    assert body is not None, "probe cards are only built for blocks with a body"
    cut = float(block["y0"]) + LINE_EM * float(block["font_pt"]) if block.get("y0") is not None and block.get("font_pt") else block.get("y1")
    card = {k: facts.get(k) for k in ("font_pt", "weight", "prev", "existing_tag", "ancestors", "in_table_box",
                                      "repeats_on_pages", "in_margin_band", "after_inline_label")}
    card.update({
        "locator": f"{block['locator']}{PROBE_SUFFIX}", "id": f"{block['locator']}{PROBE_SUFFIX}",
        "card_id": f"{block['locator']}{PROBE_SUFFIX}", "document_id": doc_id, "kind": "pdf",
        "text": first, "next": collapse_glyph_spaces(body) if body.strip() else "none",
        "page": block.get("page"), "x0": block.get("x0"), "y0": block.get("y0"),
        "x1": block.get("x1"), "y1": cut,
        "norm": norm(first),
        "probe": {"source": block["locator"], "first_line": first, "line_count": block.get("line_count"),
                  "body_words": head_words(body), "first_line_runs": block.get("first_line_runs") or []},
    })
    return card


KEYS_CARD_FIELDS = ("ancestors", "card_id", "document_id", "existing_tag", "font_pt", "id", "image",
                    "image_full", "in_margin_band", "in_table_box", "kind", "locator", "next", "norm",
                    "page", "prev", "repeats_on_pages", "text", "weight", "x0", "x1", "y0", "y1")


def block_card(facts: dict) -> dict:
    """The whole-block card in the keys-all-9 schema, from the block's context card.

    Strategy C's appended training rows: the card the wild pipeline would score for
    this block (whole text, whole box, the following block as ``next``), so the
    retrained model sees the merged block exactly as it appears at inference.
    """
    return {k: facts.get(k) for k in KEYS_CARD_FIELDS}


def reduce_marked(path: Path) -> Path | None:
    """The marked page at the 408-token contract (<= MAX_PIXELS, GRID grid), PIL mirror of
    reduce_marked_408's sizing. Returns the reduced copy's path; None when already within
    the contract. Raises (loud) when PIL is missing and a reduction is needed."""
    from PIL import Image  # lazy: --no-images and selection-only runs never need it

    reduced_dir = path.parent.parent / "marked-408"
    reduced_dir.mkdir(parents=True, exist_ok=True)
    dest = reduced_dir / path.name
    with Image.open(path) as img:
        w, h = img.size
        if w * h <= MAX_PIXELS:
            dest.write_bytes(path.read_bytes())
            return dest
        s = math.sqrt(MAX_PIXELS / (w * h))
        nw, nh = max(GRID, int(w * s) // GRID * GRID), max(GRID, int(h * s) // GRID * GRID)
        img.resize((nw, nh), Image.LANCZOS).save(dest)
    return dest


def select_document(blocks: list[dict], headings: list[dict]) -> tuple[list[dict], list[dict], dict]:
    """One document's dev rows and probe-ready blocks.

    Returns (rows, probe_blocks, counts): rows are the dev-set records (with the
    key match on positives); probe_blocks carries (block, kind, key) triples for
    card building; counts feed the summary."""
    keys = key_norms(headings)
    rows, probe_blocks = [], []
    counts: Counter = Counter()
    for b in blocks:
        kind = classify_block(b, keys)
        if kind is None:
            if b.get("existing_tag") in CONTAINER_TAGS:
                counts["container"] += 1
            elif is_multiline_block(b):
                body = body_of(b)
                counts["skipped_text_shape" if body is None else "few_body_words"] += 1
            continue
        key = match_key(norm(b.get("first_line")), headings, b) if kind == "positive" else None
        rows.append({"id": b["locator"], "kind": kind,
                     "first_line": (b.get("first_line") or "").strip(),
                     "line_count": b.get("line_count"), "body_words": head_words(body_of(b) or ""),
                     "key_locator": None if key is None else key.get("locator"),
                     "key_level": None if key is None else key.get("level"),
                     "existing_tag": b.get("existing_tag"), "in_table_box": bool(b.get("in_table_box")),
                     "first_line_runs": b.get("first_line_runs") or []})
        probe_blocks.append((b, kind, key))
    return rows, probe_blocks, counts


def dev_set_sha(rows: list[dict]) -> str:
    """The fingerprint of the dev rows (id, kind, key match, counts fields — no floats)."""
    canon = [{k: r[k] for k in sorted(r)} for r in rows]
    return hashlib.sha256(json.dumps(canon, sort_keys=True).encode()).hexdigest()


def attach_labels(rows: list[dict], labels_by_id: dict[str, dict]) -> None:
    """Each row's keys-all-9 label type/source when a label row exists (None fields else)."""
    for r in rows:
        lab = labels_by_id.get(r["id"])
        r["label_type"] = None if lab is None else lab.get("type")
        r["label_source"] = None if lab is None else lab.get("label_source")


def build_dev(manifest_path: Path, tagged_root: Path, stripped_root: Path, key_headings_path: Path,
              labels_path: Path, split_path: Path, wild_root: Path, out: Path, images: bool,
              overwrite: bool) -> dict:
    if out.exists() and not overwrite:
        raise SystemExit(f"{out} exists; choose a new name (provenance) or pass --overwrite")
    compile_cards()
    manifest = json.loads(manifest_path.read_text())
    headings_all = json.loads(key_headings_path.read_text())
    labels_by_id = {json.loads(l)["id"]: json.loads(l) for l in labels_path.read_text().splitlines() if l.strip()}
    splits = doc_splits(json.loads(split_path.read_text()))
    wild = {p.parent.name for p in wild_root.glob("*/*/sidecar.json")} if wild_root.is_dir() else set()
    rows: list[dict] = []
    probe_cards: list[dict] = []
    block_cards: list[dict] = []
    counts: Counter = Counter()
    train_positives: list[dict] = []
    pages = out / "pages"
    out.mkdir(parents=True, exist_ok=True)
    for entry in sorted(manifest, key=lambda e: e["id"]):
        doc = entry["id"]
        if doc in wild:
            counts["wild_doc_excluded"] += 1
            continue
        arm = splits.get(doc)
        if arm is None:
            counts["doc_not_in_split"] += 1
            continue
        tagged = tagged_root / f"{doc}.pdf"
        blocks = (dump_pdf(tagged, compile=False).get("blocks") or [])
        doc_rows, probe_blocks, c = select_document(blocks, headings_all.get(doc, []))
        counts.update(c)
        counts["blocks"] += len(blocks)
        cards = {cc["locator"]: cc for cc in context_cards(blocks, doc, {b["locator"] for b, _, _ in probe_blocks})}
        for r, (b, kind, key) in zip(doc_rows, probe_blocks):
            r["document_id"] = doc
            r["split"] = arm
            if kind == "negative" and arm != "validation":
                counts["negative_train_excluded"] += 1  # dev negatives are validation-only (registered)
                continue
            facts = cards.get(b["locator"])
            if facts is None:
                counts["no_context_card"] += 1
                continue
            card = probe_card(b, facts, doc)
            card["dev_kind"] = kind
            built = [card]
            if kind == "positive" and arm == "train":
                built.append(block_card(facts))  # strategy C's appended training row
            if images:
                for c in built:
                    img = marked_image(c, stripped_root / f"{doc}.pdf", pages)
                    if img is not None:
                        c["image_full"] = str(img.resolve())
                        c["image"] = str((reduce_marked(img) or img).resolve())
                    else:
                        c["image"] = c["image_full"] = None
            else:
                for c in built:
                    c["image"] = c["image_full"] = None
            probe_cards.append(card)
            if len(built) == 2:
                block_cards.append(built[1])
            rows.append(r)
            counts[f"{kind}_{arm}"] += 1
            if kind == "positive" and arm == "train":
                lab = labels_by_id.get(b["locator"])
                train_positives.append({"id": b["locator"], "document_id": doc,
                                        "key_locator": r["key_locator"], "key_level": r["key_level"],
                                        "label_type": None if lab is None else lab.get("type"),
                                        "label_source": None if lab is None else lab.get("label_source")})
    attach_labels(rows, labels_by_id)
    # Negatives: seeded cap over the validation rows.
    negatives = sorted(r["id"] for r in rows if r["kind"] == "negative")
    keep_neg = set(negatives if len(negatives) <= NEGATIVE_CAP
                   else random.Random(SAMPLE_SEED).sample(negatives, NEGATIVE_CAP))
    kept = [r for r in rows if r["kind"] == "positive" or r["id"] in keep_neg]
    kept_ids = {r["id"] for r in kept}
    probe_cards = [c for c in probe_cards if c["probe"]["source"] in kept_ids]
    rows_by_id = {r["id"]: r for r in kept}
    ordered = [rows_by_id[i] for i in sorted(rows_by_id)]
    counts["negatives_pool"] = len(negatives)
    counts["negatives_sampled"] = min(len(negatives), NEGATIVE_CAP)
    sha = dev_set_sha(ordered)
    dev = {"disclosure": DISCLOSURE, "seed": SAMPLE_SEED, "negative_cap": NEGATIVE_CAP,
           "min_body_words": MIN_BODY_WORDS, "sha256": sha, "rows": ordered}
    (out / "dev-set.json").write_text(json.dumps(dev, indent=1) + "\n")
    (out / "probe-cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in probe_cards))
    (out / "train-positives.json").write_text(json.dumps(train_positives, indent=1) + "\n")
    block_cards.sort(key=lambda c: c["card_id"])
    (out / "block-cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in block_cards))
    summary = {"documents": len({r["document_id"] for r in rows}), "blocks": counts["blocks"],
               "positives_train": counts["positive_train"], "positives_validation": counts["positive_validation"],
               "negatives_pool": counts["negatives_pool"], "negatives_kept": sum(1 for r in ordered if r["kind"] == "negative"),
               "wild_docs_excluded": counts["wild_doc_excluded"], "containers": counts["container"],
               "skipped_text_shape": counts["skipped_text_shape"], "few_body_words": counts["few_body_words"],
               "no_context_card": counts["no_context_card"], "negative_train_excluded": counts["negative_train_excluded"],
               "train_positives": len(train_positives), "block_cards": len(block_cards),
               "probe_cards": len(probe_cards), "dev_set_sha256": sha, "out": str(out)}
    (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    return summary


SUGGEST_ROUND_PRIORITY = ("wild-v4-runin", "wild-v2", "wild-r3", "wild")


def resolve_suggest_dir(suggest_root: Path, doc: str, fold_ids: set[str]) -> tuple[Path, dict] | tuple[None, None]:
    """The suggest dir whose cards cover the doc's fold ids, in registered priority.

    refold.sh swaps wild-v4-runin in for the fired documents, so that round is
    tried first; a dir wins only when every fold id of the document is one of
    its cards. Returns (dir, cards_by_id) or (None, None).
    """
    for round_ in SUGGEST_ROUND_PRIORITY:
        cards_path = suggest_root / round_ / doc / "cards.jsonl"
        if not cards_path.is_file():
            continue
        cards = {json.loads(l)["card_id"]: json.loads(l) for l in cards_path.read_text().splitlines() if l.strip()}
        if fold_ids <= set(cards):
            return suggest_root / round_ / doc, cards
    return None, None


def verify_fold_blocks(fold_ids: set[str], cards: dict, blocks: dict) -> tuple[list[str], set[str]]:
    """(non-reproducing fold ids, split-block bases) for one document.

    Every plain fold id must name a dump block with identical text. The two
    shapes suggest's split_heads adds are accepted and marked as split: a
    ``<locator>h`` head card (text == the base block's first line) and a split
    body (locator kept, text == the block's body, its head also in the fold).
    Anything else means the re-tag did not reproduce and the build refuses.
    """
    bad, split_bases = [], set()
    for cid in sorted(fold_ids):
        want = collapse_glyph_spaces(cards[cid].get("text") or "")
        if cid.endswith("h") and cid[:-1] in blocks:
            first = (blocks[cid[:-1]].get("first_line") or "").strip()
            (split_bases.add(cid[:-1]) if want == collapse_glyph_spaces(first) else bad.append(cid))
            continue
        if cid not in blocks:
            bad.append(cid)
            continue
        got = collapse_glyph_spaces(blocks[cid].get("text") or "")
        if want == got:
            continue
        body = body_of(blocks[cid])
        if body is not None and want == collapse_glyph_spaces(body) and f"{cid}h" in fold_ids:
            split_bases.add(cid)
            continue
        bad.append(cid)
    return bad, split_bases


def build_wild(fold_cards_path: Path, suggest_root: Path, real_root: Path, out: Path,
               images: bool, overwrite: bool) -> dict:
    """Strategy A's wild probe cards: the first line of every multi-line fold block.

    The fold cards (the pushed run-in fold) are the universe. Each document's
    suggest dir is re-tagged with the pipeline's own tagger and re-dumped; the
    build REFUSES unless every fold id reproduces exactly (same locator, same
    text) — a tagger that does not reproduce stops the strategy, it does not
    get guessed around. Probe population: unsplit fold cards (text identical
    to the dump block's; split heads and split bodies are out — suggest
    already split those) whose block is multi-line with at least 3 body words,
    the dev population's gates. Images are marked from the real untagged PDF,
    exactly as suggest rendered the wild cards.
    """
    from labels.suggest import tag  # lazy: dev builds never need the tagger

    if out.exists() and not overwrite:
        raise SystemExit(f"{out} exists; choose a new name (provenance) or pass --overwrite")
    compile_cards()
    fold: dict[str, list[str]] = {}
    for line in fold_cards_path.read_text().splitlines():
        if not line.strip():
            continue
        cid = json.loads(line)["id"]
        fold.setdefault(cid.split(":")[0], []).append(cid)
    out.mkdir(parents=True, exist_ok=True)
    pages = out / "pages"
    probe_cards: list[dict] = []
    report: dict[str, dict] = {}
    problems = []
    for doc in sorted(fold):
        fold_ids = set(fold[doc])
        sdir, cards = resolve_suggest_dir(suggest_root, doc, fold_ids)
        if sdir is None:
            problems.append(f"{doc}: no suggest dir covers {len(fold_ids)} fold ids")
            continue
        real = real_root / f"{doc}.pdf"
        tagged = tag(real, out / "tagwork" / doc, doc)
        blocks = {b["locator"]: b for b in (dump_pdf(tagged, compile=False).get("blocks") or [])}
        bad, split_bases = verify_fold_blocks(fold_ids, cards, blocks)
        if bad:
            problems.append(f"{doc}: {len(bad)} fold ids did not reproduce, first {bad[:5]}")
            continue
        n_probe = 0
        for cid in sorted(fold_ids):
            if cid in split_bases or cid.endswith("h"):
                continue  # suggest already split this block: out of the probe population
            b = blocks[cid]
            if not is_multiline_block(b):
                continue
            body = body_of(b)
            if body is None or head_words(body) < MIN_BODY_WORDS:
                continue
            card = probe_card(b, cards[cid], doc)
            if images:
                img = marked_image(card, real, pages)
                if img is not None:
                    card["image_full"] = str(img.resolve())
                    card["image"] = str((reduce_marked(img) or img).resolve())
                else:
                    card["image"] = card["image_full"] = None
            else:
                card["image"] = card["image_full"] = None
            probe_cards.append(card)
            n_probe += 1
        report[doc] = {"suggest_dir": str(sdir), "fold_cards": len(fold_ids),
                       "split_blocks": len(split_bases), "probed": n_probe}
    if problems:
        raise SystemExit("wild probe refused:\n" + "\n".join(problems[:30]))
    probe_cards.sort(key=lambda c: (c["document_id"], c["page"] if c["page"] is not None else 10**9, c["y0"] or 0.0))
    (out / "probe-cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in probe_cards))
    summary = {"fold_cards": str(fold_cards_path), "documents": len(report), "probe_cards": len(probe_cards),
               "per_document": report, "out": str(out)}
    (out / "wild-report.json").write_text(json.dumps(summary, indent=1) + "\n")
    return summary


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="mode", required=True)
    d = sub.add_parser("dev", help="build the dev set and its probe cards from the keys corpus")
    d.add_argument("--manifest", type=Path, default=Path("out/keys-tagged/manifest.json"))
    d.add_argument("--tagged-root", type=Path, default=Path("out/keys-tagged"))
    d.add_argument("--stripped-root", type=Path, default=Path("out/keys-stripped"))
    d.add_argument("--key-headings", type=Path, default=Path("out/keys-all-9/key-headings.json"))
    d.add_argument("--labels", type=Path, default=Path("out/keys-all-9/labels.jsonl"))
    d.add_argument("--split", type=Path, default=Path("out/keys-all-4/split/split.json"))
    d.add_argument("--wild-root", type=Path, default=Path("out/suggest"))
    d.add_argument("--out", type=Path, required=True)
    d.add_argument("--no-images", action="store_true", help="image: null (verification mode; never a scoring input)")
    d.add_argument("--overwrite", action="store_true")
    w = sub.add_parser("wild", help="strategy A's wild probe cards from the run-in fold (re-tags and verifies)")
    w.add_argument("--fold-cards", type=Path, required=True)
    w.add_argument("--suggest-root", type=Path, default=Path("out/suggest"))
    w.add_argument("--real-root", type=Path, default=Path("out/cohort3/real"))
    w.add_argument("--out", type=Path, required=True)
    w.add_argument("--no-images", action="store_true")
    w.add_argument("--overwrite", action="store_true")
    a = p.parse_args(argv)
    if a.mode == "dev":
        print(DISCLOSURE)
        print(json.dumps(build_dev(a.manifest, a.tagged_root, a.stripped_root, a.key_headings,
                                   a.labels, a.split, a.wild_root, a.out, not a.no_images, a.overwrite), indent=1))
    elif a.mode == "wild":
        print(json.dumps(build_wild(a.fold_cards, a.suggest_root, a.real_root, a.out,
                                    not a.no_images, a.overwrite), indent=1))


if __name__ == "__main__":
    main()
