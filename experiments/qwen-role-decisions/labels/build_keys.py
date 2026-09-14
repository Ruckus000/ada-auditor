# labels/build_keys.py
"""Stage 0: labels from keys. Strip, re-tag, match, score, split — no person."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import subprocess
import tempfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from run import blocks_to_cards, compile_cards, dump_pdf, text_norm
from labels.hygiene import verapdf_failures, verdict
from labels.keys import heading_sentence_share, key_blocks
from labels.match import make_key_row, match_candidate
from labels.pdf_cards import SEED, cap_per_document, select_candidates
from labels.stage_pdfs import MAIN, ODL_RUNNER
from labels.strip import strip_pdf

OUT = Path("out/keys")


def originals(rows: list[dict], word_pdfs: Path, staged: Path) -> list[dict]:
    staging = {s["id"]: s for s in json.loads((staged / "staging.json").read_text())}
    out = []
    for r in rows:
        if r["kind"] == "pdf" and staging.get(r["id"], {}).get("source") == "original":
            out.append({**r, "source": "stripped-tree", "original": r["path"]})
        elif r["kind"] == "docx" and (word_pdfs / f"{r['id']}.pdf").is_file():
            out.append({**r, "source": "word-outline", "original": str(word_pdfs / f"{r['id']}.pdf")})
    return out


UNMATCHED_FIELDS = ("card_id", "document_id", "page", "x0", "y0", "x1", "y1", "font_pt", "weight", "in_table_box", "why", "existing_tag")


def unmatched_row(card: dict) -> dict:
    """An unmatched card is not a label (K14): geometry and a text hash, no text."""
    row = {k: card.get(k) for k in UNMATCHED_FIELDS}
    row["text_sha256"] = hashlib.sha256((card.get("text") or "").encode()).hexdigest()
    return row


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, default=Path("out/labels/manifest.json"))
    p.add_argument("--word-pdfs", type=Path, default=Path("out/keys/word-pdfs"))
    p.add_argument("--staged", type=Path, default=Path("out/labels"))
    p.add_argument("--salt", required=True)
    a = p.parse_args()
    compile_cards()
    rows = json.loads(a.manifest.read_text())
    docs = originals(rows, a.word_pdfs, a.staged)
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
    stripped_dir = OUT / "stripped"
    for d in usable:
        strip_pdf(Path(d["original"]), stripped_dir / f"{d['id']}.pdf")
    tagged_dir = OUT / "tagged"
    tagged_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["node", str(ODL_RUNNER), str(stripped_dir.resolve()), str(tagged_dir.resolve())], cwd=MAIN, check=True)
    rng = random.Random(SEED)
    match_counts, types = Counter(), Counter()
    n_rows = n_unmatched = 0
    with (OUT / "labels.jsonl").open("w") as f, (OUT / "unmatched.jsonl").open("w") as u:
        for d in usable:
            tagged = tagged_dir / f"{d['id']}.pdf"
            if not tagged.is_file():
                excluded[d["id"]] = ["tagger-produced-nothing"]; continue
            cards, _ = blocks_to_cards(dump_pdf(tagged, compile=False).get("blocks") or [])
            chosen = select_candidates(cards, rng)
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
                types[row["type"]] += 1; n_rows += 1
                f.write(json.dumps(row) + "\n")
    report = {"documents": len(docs), "usable": len(usable) - sum(1 for d in usable if d["id"] in excluded), "excluded": excluded,
              "cards": n_rows, "unmatched": n_unmatched,
              "match_rate": n_rows / (n_rows + n_unmatched) if n_rows + n_unmatched else None, "match": dict(match_counts), "types": dict(types), "hosts": len({d["host"] for d in usable if d["id"] not in excluded})}
    (OUT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    subprocess.run(["python3", "-B", "eligibility_eval.py", "split", "--labels", str(OUT / "labels.jsonl"), "--salt", a.salt, "--out", str(OUT / "split")], check=True)
    (Path("labels") / f"split-keys-{date.today().isoformat()}.json").write_bytes((OUT / "split" / "split.json").read_bytes())


if __name__ == "__main__":
    main()
