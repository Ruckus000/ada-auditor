"""Stage 2 run-in split: the validation measurement and the registered width freeze.

Corpus: the validation-split documents of the keys corpus (``out/keys-all-4``),
graded against struct-tree truth (``<keys-dir>/key-headings.json``; label
sources stripped-tree / word-outline / planted — no judged labels are read).
Every document that has a wild sidecar under ``--wild-root`` is excluded: the
30 wild gate documents are never tuned against. The test split is never read:
only ``ids.validation`` of the split manifest is opened.

Both arms mirror the wild sidecar configuration: the enumerated split runs in
the off arm and the on arm; the on arm adds ``split_run_in_heads`` at each
width in ``WIDTHS``. Per width (plan 2026-09-22, freeze rule registered there):

- heading recall: of the key headings that are NOT their own candidate card in
  the off arm (their norm is not in the off pool — merged run-ins currently
  lost), the fraction that are a head card in the on pool. Pool-based on
  purpose: a head K35-deduped away is not a card, so it is not a recovery.
- false-split rate: split heads the on arm adds (new ``<locator>h`` cards)
  whose normalized text matches no key heading of the document, as a share of
  all dumped blocks (pre-split, containers included).

Freeze rule (registered in the plan, not invented here): adopt the highest
recall among widths whose false-split rate is <= FALSE_SPLIT_MAX of blocks;
ties take the smaller width.

``training_keys_sha256`` fingerprints ``candidate_pool`` over the measured
documents with NO split at all — the training-key builder's path, which never
splits; the unit tests pin that ``first_line_x1`` does not change it, and this
hash proves it on the real corpus.

Scripts only: no model calls, no labels written, no PDF modified. Refuses to
overwrite an existing --out unless --overwrite is passed.

    python3 -B -m labels.measure_run_in_split \
        --keys-dir out/keys-all-4 \
        --source out/keys:out/labels/manifest.json --source out/keys-c3:out/keys-c3/manifest.json \
        --source out/keys-c4:out/keys-c4/manifest.json --source out/keys-c6:out/keys-c6/manifest.json \
        --split labels/split-keys-all-4-2026-09-14.json \
        --out out/labels/run-in-split-validation-2026-09-22.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from run import compile_cards, dump_pdf, text_norm
from labels.build_keys import UNREADABLE, candidate_pool
from labels.key_context import parse_source, resolve_sources
from labels.split_heads import split_enumerated_heads, split_run_in_heads

WIDTHS = (0.5, 0.6, 0.7)
FALSE_SPLIT_MAX = 0.005
FREEZE_RULE = ("adopt the highest recall among thresholds whose false-split rate is "
               "<= 0.5% of blocks; ties take the smaller threshold")
DISCLOSURE = ("graded against struct-tree key headings (label sources stripped-tree / word-outline / planted); "
              "no judged labels read; wild gate documents excluded; test split never read")


def validation_docs(split: dict) -> list[str]:
    """Document ids of the validation split. The test split is never touched."""
    return sorted({i.split(":")[0] for i in split["ids"]["validation"]})


def wild_docs(wild_root: Path) -> set[str]:
    """Every document that has a wild sidecar: ``<root>/<run>/<doc>/sidecar.json``."""
    if not wild_root.is_dir():
        return set()
    return {p.parent.name for p in wild_root.glob("*/*/sidecar.json")}


def norm(text: str) -> str:
    return text_norm(text or "")


def key_counter(headings: list[dict]) -> Counter:
    """Normalized key-heading texts (multiset: a repeated heading text keeps its count)."""
    return Counter(n for n in (norm(h.get("text")) for h in headings) if n)


def head_locators(blocks: list[dict]) -> set[str]:
    return {b["locator"] for b in blocks if b.get("split") == "head"}


def measure_document(off_blocks: list[dict], on_blocks: list[dict], keys: Counter) -> dict:
    """One document at one width. ``off_blocks`` carries the enumerated split (the wild
    sidecar configuration); ``on_blocks`` adds the run-in split.

    lost: key-heading norms with no own card in the off pool. recovered: the share of
    lost that is a head card in the on pool (a head deduped away by K35 is not a card,
    so not a recovery). false_splits: the head cards the on arm ADDS (new locators)
    whose norm matches no key heading, counted pre-pool — a false split is the split
    event, whether or not the head survives dedupe."""
    off_pool = candidate_pool({"blocks": off_blocks}, "d")
    off_own = {norm(c["text"]) for c in off_pool}
    lost = Counter({n: c for n, c in keys.items() if n not in off_own})
    on_pool = candidate_pool({"blocks": on_blocks}, "d")
    on_heads = Counter(norm(c["text"]) for c in on_pool if c["locator"].endswith("h"))
    recovered = sum(min(lost[n], on_heads[n]) for n in lost)
    new_heads = [b for b in on_blocks
                 if b.get("split") == "head" and b["locator"] not in head_locators(off_blocks)]
    false_splits = sum((Counter(norm(b.get("text")) for b in new_heads) - keys).values())
    return {"lost": sum(lost.values()), "recovered": recovered,
            "splits": len(new_heads), "false_splits": false_splits}


def freeze(per_width: dict[float, dict]) -> dict:
    """The registered rule over the aggregated per-width metrics."""
    ok = {w: m for w, m in per_width.items()
          if m["false_split_rate"] is not None and m["false_split_rate"] <= FALSE_SPLIT_MAX}
    if not ok:
        return {"width": None, "reason": f"no width holds the false-split cap ({FALSE_SPLIT_MAX} of blocks)"}
    best = max((m["recall"] for m in ok.values() if m["recall"] is not None), default=None)
    if best is None:  # nothing lost on this corpus: recall is vacuous; take the smallest capped width
        return {"width": min(ok), "reason": "no lost headings on the measured corpus; smallest capped width"}
    chosen = min(w for w, m in ok.items() if m["recall"] == best)
    return {"width": chosen, "reason": f"highest recall {best} among capped widths; ties take the smaller"}


def tagged_copies(keys_dir: Path, sources: list[str], docs: list[str]) -> dict[str, Path]:
    """Each document's tagged copy. ``keys-all-4`` is a merged corpus with no ``tagged/`` of
    its own: its copies live in the per-cohort builds, so pass those as ``--source
    <build_dir>:<manifest>`` (the ``key_context`` form that built it; a document in no
    source or in two raises). With no source, ``<keys-dir>`` is the one build."""
    if not sources:
        if not (keys_dir / "tagged").is_dir():
            raise SystemExit(f"{keys_dir / 'tagged'} does not exist: pass the builds that hold the "
                             "tagged copies as --source <build_dir>:<manifest> (repeatable)")
        return {d: keys_dir / "tagged" / f"{d}.pdf" for d in docs}
    resolved = resolve_sources(set(docs), [parse_source(s) for s in sources])
    return {d: build / "tagged" / f"{d}.pdf" for d, ((build, _, _), _) in resolved.items()}


def measure(tagged_of: dict[str, Path], docs: list[str], headings: dict) -> tuple[dict, dict, str]:
    """The per-width table and per-document rows over ``docs``; the training-key fingerprint.
    A document without a tagged copy or one Cards cannot read is excluded and named."""
    compile_cards()
    totals = {w: Counter() for w in WIDTHS}
    per_doc, excluded = [], {}
    pool_fingerprint = {}
    for doc in docs:
        tagged = tagged_of[doc]
        if not tagged.is_file():
            excluded[doc] = "no-tagged-copy"
            continue
        try:
            blocks = (dump_pdf(tagged, compile=False).get("blocks") or [])
        except UNREADABLE:
            excluded[doc] = "tagged-copy-unreadable"
            continue
        keys = key_counter(headings[doc])
        pool_fingerprint[doc] = [(c["locator"], norm(c["text"])) for c in candidate_pool({"blocks": blocks}, doc)]
        off, _ = split_enumerated_heads(blocks)
        row = {"document": doc, "blocks": len(blocks), "key_headings": sum(keys.values()), "per_width": {}}
        for w in WIDTHS:
            on, _ = split_run_in_heads(off, w)
            m = measure_document(off, on, keys)
            row["per_width"][str(w)] = m
            totals[w].update({**m, "blocks": len(blocks)})
        per_doc.append(row)
    table = {}
    for w in WIDTHS:
        t = totals[w]
        table[w] = {"blocks": t["blocks"], "lost_headings": t["lost"], "recovered": t["recovered"],
                    "recall": None if t["lost"] == 0 else t["recovered"] / t["lost"],
                    "splits": t["splits"], "false_splits": t["false_splits"],
                    "false_split_rate": None if t["blocks"] == 0 else t["false_splits"] / t["blocks"]}
    fp = hashlib.sha256(json.dumps(pool_fingerprint, sort_keys=True).encode()).hexdigest()
    return {"per_width": table, "freeze": freeze(table)}, {"measured": per_doc, "excluded": excluded}, fp


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--keys-dir", type=Path, default=Path("out/keys-all-4"))
    p.add_argument("--source", action="append", default=[], metavar="BUILD:MANIFEST",
                   help="a build holding tagged copies, <build_dir>:<manifest> (repeatable); default <keys-dir> alone")
    p.add_argument("--split", type=Path, default=Path("labels/split-keys-all-4-2026-09-14.json"))
    p.add_argument("--wild-root", type=Path, default=Path("out/suggest"),
                   help="wild sidecars live at <wild-root>/<run>/<doc>/sidecar.json; those docs are excluded")
    p.add_argument("--out", type=Path, default=Path("out/labels/run-in-split-validation.json"))
    p.add_argument("--overwrite", action="store_true")
    a = p.parse_args(argv)
    if a.out.exists() and not a.overwrite:
        raise SystemExit(f"{a.out} exists; choose a new name (provenance) or pass --overwrite")
    headings_path = a.keys_dir / "key-headings.json"
    if not headings_path.is_file():
        raise SystemExit(f"{headings_path} missing: build the keys corpus context first (labels/key_context.py)")
    headings = json.loads(headings_path.read_text())
    docs = validation_docs(json.loads(a.split.read_text()))
    wild = wild_docs(a.wild_root)
    excluded_wild = sorted(set(docs) & wild)
    docs = [d for d in docs if d not in wild]
    missing_keys = [d for d in docs if d not in headings]
    if missing_keys:
        raise SystemExit(f"validation documents without key headings in {headings_path}: {missing_keys}")
    result, detail, fp = measure(tagged_copies(a.keys_dir, a.source, docs), docs, headings)
    out = {"disclosure": DISCLOSURE, "freeze_rule": FREEZE_RULE, "widths": list(WIDTHS),
           "false_split_max": FALSE_SPLIT_MAX,
           "baseline": "both arms apply --split-enumerated-heads (the wild sidecar configuration); "
                       "the on arm adds --split-run-in-heads WIDTH",
           "keys_dir": str(a.keys_dir), "sources": a.source, "split": str(a.split),
           "documents": {"validation": len(docs) + len(excluded_wild), "excluded_wild": excluded_wild,
                         "excluded": detail["excluded"], "measured": len(detail["measured"])},
           "training_keys_sha256": fp, **result, "per_document": detail["measured"]}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, indent=2) + "\n")
    print(DISCLOSURE)
    print(json.dumps({"documents": out["documents"]["measured"], "frozen_width": result["freeze"]["width"],
                      "per_width": {str(w): m for w, m in result["per_width"].items()}, "out": str(a.out)}, indent=2))


if __name__ == "__main__":
    main()
