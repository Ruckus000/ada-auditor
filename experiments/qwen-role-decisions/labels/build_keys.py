# labels/build_keys.py
"""Stage 0: labels from keys. Strip, re-tag, match, score, split — no person."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import subprocess
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Callable

from run import blocks_to_cards, compile_cards, dump_pdf, text_norm
from labels.hygiene import verapdf_failures, verdict
from labels.keys import CONTAINER_TAGS, heading_sentence_share, key_blocks
from labels.match import make_key_row, match_candidate
from labels.pdf_cards import SEED, cap_per_document, select_candidates
from labels.stage_pdfs import MAIN, ODL_RUNNER, has_struct_tree
from labels.strip import strip_pdf

OUT = Path("out/keys")
ODL_BATCH = 50


def originals(rows: list[dict], word_pdfs: Path, staged: Path, staging_optional: bool = False,
              has_tree: Callable[[Path], bool] = has_struct_tree) -> list[dict]:
    """Key sources. Stage 0 reads staging.json; with staging_optional a manifest PDF
    is a stripped-tree key iff its own bytes carry a structure tree (no ODL on originals)."""
    if staging_optional:
        is_original = lambda r: has_tree(Path(r["path"]))  # noqa: E731
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


UNMATCHED_FIELDS = ("card_id", "document_id", "page", "x0", "y0", "x1", "y1", "font_pt", "weight", "in_table_box", "why", "existing_tag")


def non_container_cards(cards: list[dict]) -> list[dict]:
    """K24: container cards duplicate their cells' text; the cells are the candidates."""
    return [c for c in cards if c.get("existing_tag") not in CONTAINER_TAGS]


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


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, default=Path("out/labels/manifest.json"))
    p.add_argument("--word-pdfs", type=Path, default=Path("out/keys/word-pdfs"))
    p.add_argument("--staged", type=Path, default=Path("out/labels"))
    p.add_argument("--salt", required=True)
    p.add_argument("--staging-optional", action="store_true", help="a manifest PDF is a key iff it has a structure tree; no staging.json")
    p.add_argument("--out", type=Path, default=OUT)
    p.add_argument("--split-copy", default=None, help="where to copy split.json (default labels/split-keys-<date>.json; '' skips)")
    p.add_argument("--odl-batch", type=int, default=ODL_BATCH)
    a = p.parse_args()
    out_dir = a.out
    compile_cards()
    rows = json.loads(a.manifest.read_text())
    docs = originals(rows, a.word_pdfs, a.staged, staging_optional=a.staging_optional)
    excluded: dict[str, list[str]] = {}
    usable: list[dict] = []
    keys: dict[str, list[dict]] = {}
    for d in docs:
        dump = dump_pdf(Path(d["original"]), compile=False)
        kb = key_blocks(dump)
        ok, reasons = verdict(verapdf_failures(Path(d["original"])), heading_sentence_share(kb), len(kb))
        if not ok:
            excluded[d["id"]] = reasons
            continue
        keys[d["id"]] = kb
        usable.append(d)
    stripped_dir, tagged_dir, work_dir = out_dir / "stripped", out_dir / "tagged", out_dir / "tagged-batches"
    # Start clean: stale tagger output masks a failed or changed tagging.
    for dir_ in (stripped_dir, tagged_dir, work_dir):
        shutil.rmtree(dir_, ignore_errors=True)
        dir_.mkdir(parents=True)
    for d in usable:
        strip_pdf(Path(d["original"]), stripped_dir / f"{d['id']}.pdf")
    odl_failed = run_odl_batches(stripped_dir, tagged_dir, work_dir, a.odl_batch)
    rng = random.Random(SEED)
    match_counts, types = Counter(), Counter()
    n_rows = n_unmatched = 0
    with_rows: set[str] = set()
    with (out_dir / "labels.jsonl").open("w") as f, (out_dir / "unmatched.jsonl").open("w") as u:
        for d in usable:
            tagged = tagged_dir / f"{d['id']}.pdf"
            if not tagged.is_file():
                excluded[d["id"]] = ["tagger-produced-nothing"]; continue
            cards, _ = blocks_to_cards(dump_pdf(tagged, compile=False).get("blocks") or [])
            chosen = select_candidates(non_container_cards(cards), rng)
            for c in chosen:
                c["document_id"] = d["id"]; c["kind"] = "pdf"; c["card_id"] = c["locator"]
                c["norm"] = text_norm(c["text"])
            by_page = defaultdict(list)
            for k in keys[d["id"]]:
                by_page[k.get("page")].append(k)
            for c in cap_per_document(chosen, rng):
                key, how = match_candidate(c, by_page.get(c.get("page"), []))
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
              "odl_failed_batches": odl_failed}
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    subprocess.run(["python3", "-B", "eligibility_eval.py", "split", "--labels", str(out_dir / "labels.jsonl"), "--salt", a.salt, "--out", str(out_dir / "split")], check=True)
    copy = Path("labels") / f"split-keys-{date.today().isoformat()}.json" if a.split_copy is None else (Path(a.split_copy) if a.split_copy else None)
    if copy is not None:
        copy.write_bytes((out_dir / "split" / "split.json").read_bytes())


if __name__ == "__main__":
    main()
