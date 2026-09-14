# labels/build_keys.py
"""Stage 0: labels from keys. Strip, re-tag, match, score, split — no person.

Nothing is copied into labels/ unless --split-copy names the path (K28): a
Stage 0-style run passes --split-copy labels/split-keys-<date>.json explicitly.
--word-pdfs defaults to <--out>/word-pdfs.

The build refuses to start over an existing <--out>/labels.jsonl unless
--overwrite is passed (K30). One bad file does not stop it (K31): an original
Cards cannot read is excluded as "unreadable", and a failed ODL batch is
recorded under odl_failed_batches while its documents are excluded as
"tagger-batch-failed" and the other batches carry on. An original Strip cannot
write is excluded as "strip-failed" (K33). Only the Cards call is guarded, so a
Python bug in selection or matching still crashes, and a manifest path that
does not exist is a hard error naming the id (K33).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable

from run import blocks_to_cards, compile_cards, dump_pdf, text_norm
from labels.hygiene import verapdf_failures, verdict
from labels.keys import CONTAINER_TAGS, heading_sentence_share, key_blocks
from labels.match import make_key_row, match_candidate, resolve_exact_duplicates
from labels.pdf_cards import SEED, cap_per_document, drop_duplicate_cards, select_candidates
from labels.stage_pdfs import MAIN, ODL_RUNNER, has_struct_tree
from labels.strip import strip_pdf

OUT = Path("out/keys")
ODL_BATCH = 50
# What Cards.java raises on a PDF it cannot read (non-zero exit), or its unparsable output.
UNREADABLE = (RuntimeError, ValueError)


def originals(rows: list[dict], word_pdfs: Path, staged: Path, staging_optional: bool = False,
              has_tree: Callable[[Path], bool] = has_struct_tree, excluded: dict | None = None) -> list[dict]:
    """Key sources. Stage 0 reads staging.json; with staging_optional a manifest PDF
    is a stripped-tree key iff its own bytes carry a structure tree (no ODL on originals).
    A PDF the tree check cannot read goes into `excluded` as "unreadable" (K31)."""
    excluded = {} if excluded is None else excluded
    if staging_optional:
        def is_original(r: dict) -> bool:
            must_exist(r["id"], Path(r["path"]))
            try:
                return has_tree(Path(r["path"]))
            except UNREADABLE:
                excluded[r["id"]] = ["unreadable"]
                return False
    else:
        staging = {s["id"]: s for s in json.loads((staged / "staging.json").read_text())}
        is_original = lambda r: staging.get(r["id"], {}).get("source") == "original"  # noqa: E731
    out = []
    for r in rows:
        if r["kind"] == "pdf" and is_original(r):
            out.append({**r, "source": "stripped-tree", "original": r["path"]})
        elif r["kind"] == "docx" and (word_pdfs / f"{r['id']}.pdf").is_file():
            out.append({**r, "source": "word-outline", "original": str(word_pdfs / f"{r['id']}.pdf")})
    return out


LABEL_SOURCES = ("auto", "planted")


def with_label_source(docs: list[dict], label_source: str) -> list[dict]:
    """--label-source: 'auto' keeps each document's own source (stripped-tree for
    PDFs, word-outline for docx); 'planted' overrides every document's source to
    'planted', which the evaluator already accepts, so make_key_row's actor
    becomes key:planted for every row from this run."""
    if label_source == "planted":
        return [{**d, "source": "planted"} for d in docs]
    return docs


UNMATCHED_FIELDS = ("card_id", "document_id", "page", "x0", "y0", "x1", "y1", "font_pt", "weight", "in_table_box", "why", "existing_tag")


def non_container_cards(cards: list[dict]) -> list[dict]:
    """K24: container cards duplicate their cells' text; the cells are the candidates."""
    return [c for c in cards if c.get("existing_tag") not in CONTAINER_TAGS]


def must_exist(doc_id: str, path: Path) -> None:
    """K33: a missing path is a wrong manifest, not a bad file — fail loud."""
    if not path.exists():
        raise FileNotFoundError(f"manifest row {doc_id}: {path} does not exist")


def read_dump(path: Path, dump: Callable) -> dict | None:
    """Only the Cards call is guarded (K33): Python below it must still crash."""
    try:
        return dump(path, compile=False)
    except UNREADABLE:
        return None


def key_document(d: dict, dump: Callable = dump_pdf, failures: Callable = verapdf_failures) -> tuple[list[dict] | None, list[str]]:
    """The original's key blocks if it passes hygiene, else None and the reasons."""
    must_exist(d["id"], Path(d["original"]))
    raw = read_dump(Path(d["original"]), dump)
    if raw is None:
        return None, ["unreadable"]
    kb = key_blocks(raw)
    ok, reasons = verdict(failures(Path(d["original"])), heading_sentence_share(kb), len(kb))
    return (kb if ok else None), reasons


def document_cards(tagged: Path, doc_id: str, rng: random.Random, dump: Callable = dump_pdf,
                   duplicates: Counter | None = None) -> list[dict] | None:
    """One tagged copy's candidate cards: duplicate copies out (K35), containers out (K24), select, annotate, cap.
    None when Cards cannot read the tagged copy; the rng is not drawn in that case."""
    raw = read_dump(tagged, dump)
    if raw is None:
        return None
    cards, _ = blocks_to_cards(raw.get("blocks") or [])
    cards, n_dup = drop_duplicate_cards(cards)
    if duplicates is not None and n_dup:
        duplicates[doc_id] += n_dup
    chosen = select_candidates(non_container_cards(cards), rng)
    for c in chosen:
        c["document_id"] = doc_id; c["kind"] = "pdf"; c["card_id"] = c["locator"]
        c["norm"] = text_norm(c["text"])
    return cap_per_document(chosen, rng)


def strip_usable(usable: list[dict], stripped_dir: Path, excluded: dict, strip: Callable = strip_pdf) -> list[dict]:
    """Strip each usable original; one that Strip cannot write is excluded as "strip-failed" (K33)."""
    kept = []
    for d in usable:
        try:
            strip(Path(d["original"]), stripped_dir / f"{d['id']}.pdf")
        except UNREADABLE:
            excluded[d["id"]] = ["strip-failed"]
            continue
        kept.append(d)
    return kept


def tagger_miss_reason(doc_id: str, failed_batches: list[dict]) -> list[str]:
    if any(doc_id in b["ids"] for b in failed_batches):
        return ["tagger-batch-failed"]
    return ["tagger-produced-nothing"]


def refuse_existing_labels(out_dir: Path, overwrite: bool) -> None:
    """K30: an existing labels.jsonl may be the only reproduction of a committed split."""
    if (out_dir / "labels.jsonl").exists() and not overwrite:
        raise SystemExit(f"{out_dir / 'labels.jsonl'} exists; pass --overwrite to rebuild over it, or choose another --out")


def unmatched_row(card: dict) -> dict:
    """An unmatched card is not a label (K14): geometry and a text hash, no text."""
    row = {k: card.get(k) for k in UNMATCHED_FIELDS}
    row["text_sha256"] = hashlib.sha256((card.get("text") or "").encode()).hexdigest()
    return row


def batches(items: list, size: int) -> list[list]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def odl(inp: Path, outp: Path) -> None:
    subprocess.run(["node", str(ODL_RUNNER), str(inp.resolve()), str(outp.resolve())], cwd=MAIN, check=True)


def run_odl_batches(stripped_dir: Path, tagged_dir: Path, work_dir: Path, size: int,
                    runner: Callable[[Path, Path], None] = odl) -> list[dict]:
    """Move the stripped copies into batch sub-directories of at most `size`, tag each
    batch into its own dir, gather outputs into tagged_dir. A failed batch is returned,
    its outputs are not gathered, and the other batches still run."""
    failed = []
    for i, chunk in enumerate(batches(sorted(stripped_dir.glob("*.pdf")), size)):
        name = f"batch-{i:03d}"
        inp, outp = stripped_dir / name, work_dir / name
        inp.mkdir(parents=True)
        for f in chunk:
            f.rename(inp / f.name)
        try:
            runner(inp, outp)
        except subprocess.CalledProcessError:
            failed.append({"batch": name, "ids": [f.stem for f in chunk]})
            continue
        for produced in sorted(outp.glob("*.pdf")) if outp.is_dir() else []:
            shutil.copyfile(produced, tagged_dir / produced.name)
    return failed


def row_coverage(usable: list[dict], with_rows: set[str]) -> dict:
    """Documents and hosts that wrote at least one label row."""
    return {"documents_with_rows": len(with_rows), "hosts": len({d["host"] for d in usable if d["id"] in with_rows})}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, default=Path("out/labels/manifest.json"))
    p.add_argument("--word-pdfs", type=Path, default=None, help="default <--out>/word-pdfs")
    p.add_argument("--staged", type=Path, default=Path("out/labels"))
    p.add_argument("--salt", required=True)
    p.add_argument("--staging-optional", action="store_true", help="a manifest PDF is a key iff it has a structure tree; no staging.json")
    p.add_argument("--out", type=Path, default=OUT)
    p.add_argument("--split-copy", type=Path, default=None,
                   help="copy split.json here; default: no copy (K28). A Stage 0-style run passes labels/split-keys-<date>.json explicitly")
    p.add_argument("--odl-batch", type=int, default=ODL_BATCH)
    p.add_argument("--overwrite", action="store_true", help="rebuild over an existing <--out>/labels.jsonl (K30)")
    p.add_argument("--label-source", choices=LABEL_SOURCES, default="auto",
                   help="'planted' sets every row's label_source/actor to key:planted; default 'auto' keeps stripped-tree/word-outline")
    a = p.parse_args(argv)
    if a.word_pdfs is None:
        a.word_pdfs = a.out / "word-pdfs"
    return a


def main() -> None:
    a = parse_args()
    out_dir = a.out
    refuse_existing_labels(out_dir, a.overwrite)
    compile_cards()
    rows = json.loads(a.manifest.read_text())
    excluded: dict[str, list[str]] = {}
    docs = originals(rows, a.word_pdfs, a.staged, staging_optional=a.staging_optional, excluded=excluded)
    docs = with_label_source(docs, a.label_source)
    usable: list[dict] = []
    keys: dict[str, list[dict]] = {}
    for d in docs:
        kb, reasons = key_document(d)
        if kb is None:
            excluded[d["id"]] = reasons
            continue
        keys[d["id"]] = kb
        usable.append(d)
    stripped_dir, tagged_dir, work_dir = out_dir / "stripped", out_dir / "tagged", out_dir / "tagged-batches"
    # Start clean: stale tagger output masks a failed or changed tagging.
    for dir_ in (stripped_dir, tagged_dir, work_dir):
        shutil.rmtree(dir_, ignore_errors=True)
        dir_.mkdir(parents=True)
    stripped = strip_usable(usable, stripped_dir, excluded)
    odl_failed = run_odl_batches(stripped_dir, tagged_dir, work_dir, a.odl_batch)
    rng = random.Random(SEED)
    match_counts, types, duplicates = Counter(), Counter(), Counter()
    n_rows = n_unmatched = 0
    with_rows: set[str] = set()
    with (out_dir / "labels.jsonl").open("w") as f, (out_dir / "unmatched.jsonl").open("w") as u:
        for d in stripped:
            tagged = tagged_dir / f"{d['id']}.pdf"
            if not tagged.is_file():
                excluded[d["id"]] = tagger_miss_reason(d["id"], odl_failed); continue
            cards = document_cards(tagged, d["id"], rng, duplicates=duplicates)
            if cards is None:
                excluded[d["id"]] = ["tagger-output-unreadable"]; continue
            by_page = defaultdict(list)
            for k in keys[d["id"]]:
                by_page[k.get("page")].append(k)
            doc_matches = [(c, *match_candidate(c, by_page.get(c.get("page"), []))) for c in cards]
            doc_matches = resolve_exact_duplicates(doc_matches)
            for c, key, how in doc_matches:
                match_counts[how] += 1
                if how == "none":
                    u.write(json.dumps(unmatched_row(c)) + "\n"); n_unmatched += 1
                    continue
                row = make_key_row(c, d, key, how, d["source"])
                types[row["type"]] += 1; n_rows += 1; with_rows.add(d["id"])
                f.write(json.dumps(row) + "\n")
    report = {"documents": len(docs), "usable": len(usable) - sum(1 for d in usable if d["id"] in excluded), "excluded": excluded,
              "cards": n_rows, "unmatched": n_unmatched,
              "match_rate": n_rows / (n_rows + n_unmatched) if n_rows + n_unmatched else None, "match": dict(match_counts), "types": dict(types), **row_coverage(usable, with_rows),
              "duplicate_cards_dropped": {"total": sum(duplicates.values()), "by_document": dict(sorted(duplicates.items()))},
              "odl_failed_batches": odl_failed}
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    subprocess.run(["python3", "-B", "eligibility_eval.py", "split", "--labels", str(out_dir / "labels.jsonl"), "--salt", a.salt, "--out", str(out_dir / "split")], check=True)
    if a.split_copy is not None:
        a.split_copy.write_bytes((out_dir / "split" / "split.json").read_bytes())


if __name__ == "__main__":
    main()
