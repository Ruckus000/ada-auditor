"""r14 step 1 (docs/superpowers/plans/2026-09-25-r14-registration.md): fold a judged
cohort into a keys directory so ``emit_sft`` trains on it and validation can score it.

Every labelled card of the cohort (``--labels``, the look's consensus rows) becomes a
keys label row, and its product suggest card (``--suggest-dir/<doc>/cards.jsonl``,
unchanged) is appended to cards.jsonl. The host of each document
(``labels.manifest.host_of`` of its url in ``--names``) is the row's client and
template; the host goes to train when ``sha256(salt NUL host)`` read as a unit
fraction is below ``--train-share``, else to validation. The test split is never
grown. A document's key-heading ladder is its H-labelled cards in reading order at
their judged levels; headings that fell among unjudged asks are absent (disclosed
in the registration, not repaired).

Nothing in the base keys directory changes: rows, cards and ladders are copied and
the cohort's are appended. Refused, before anything is written: an output directory
that exists, a cohort id already in the base cards, labels or any split arm, a host
already placed by the base split, a label row ``eligibility_eval.refusals`` rejects.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from eligibility_eval import refusals
from labels.manifest import host_of

LABEL_SOURCE = "opus-fable-consensus"
ARMS = ("train", "validation")


def unit(salt: str, host: str) -> float:
    return int(hashlib.sha256(f"{salt}\0{host}".encode()).hexdigest()[:15], 16) / 16**15


def arm_of(host: str, salt: str, train_share: float) -> str:
    return "train" if unit(salt, host) < train_share else "validation"


def read_names(path: Path) -> dict[str, str]:
    """``<id>.pdf<TAB><url>`` lines; comments and blanks skipped."""
    out = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, url = line.split("\t", 1)
        out[name.rsplit(".", 1)[0]] = url.strip()
    return out


def keys_row(label: dict, host: str, sha: str, card: dict) -> dict:
    return {"id": label["id"], "card_id": label["id"], "document_id": label["document_id"],
            "document_stem": label["document_id"], "kind": "pdf", "type": label["type"],
            "label": label["label"], "label_source": LABEL_SOURCE, "actor": label["actor"],
            "answer_id": f"{LABEL_SOURCE}:{label['id']}", "client_id": host, "template_id": host,
            "document_sha256": sha, "labelled_at": label["labelled_at"],
            "text_sha256": hashlib.sha256((card.get("text") or "").encode()).hexdigest()}


def ladder(rows: list[dict], cards: dict[str, dict]) -> list[dict]:
    heads = [(cards[r["id"]], r) for r in rows if r["label"]["heading"]]
    heads.sort(key=lambda cr: (int(cr[0]["page"]), float(cr[0]["y0"]), float(cr[0]["x0"])))
    return [{"page": int(c["page"]), "y0": float(c["y0"]), "level": r["label"]["level"] or 1,
             "text": c.get("text") or "", "locator": r["id"]} for c, r in heads]


def overlay(keys_dir: Path, split_path: Path, labels_path: Path, suggest_dir: Path, names_path: Path,
            pdf_dir: Path, salt: str, train_share: float, out: Path) -> dict:
    if out.exists():
        raise SystemExit(f"{out} exists; choose a new name (provenance)")
    load = lambda p: [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    base_rows, base_cards = load(keys_dir / "labels.jsonl"), load(keys_dir / "cards.jsonl")
    ladders = json.loads((keys_dir / "key-headings.json").read_text())
    split = json.loads(split_path.read_text())
    labels, names = load(labels_path), read_names(names_path)
    taken = {r["id"] for r in base_rows} | {c["card_id"] for c in base_cards} | {i for ids in split["ids"].values() for i in ids}
    arm_of_id = {i: arm for arm, ids in split["ids"].items() for i in ids}
    placed_hosts = {r.get("client_id"): arm_of_id[r["id"]] for r in base_rows if r["id"] in arm_of_id}
    by_doc: dict[str, list[dict]] = {}
    for r in labels:
        by_doc.setdefault(r["document_id"], []).append(r)
    problems, rows, cards, arms, new_ladders, sha_of = [], [], [], {a: [] for a in ARMS}, {}, {}
    counts: Counter = Counter()
    for doc in sorted(by_doc):
        if doc not in names:
            problems.append(f"{doc}: not in {names_path}")
            continue
        host = host_of(names[doc])
        arm = arm_of(host, salt, train_share)
        if host in placed_hosts and placed_hosts[host] != arm:
            problems.append(f"{doc}: host {host} already sits in {placed_hosts[host]}")
            continue
        pdf = pdf_dir / f"{doc}.pdf"
        sha_of[doc] = hashlib.sha256(pdf.read_bytes()).hexdigest()
        doc_cards = {c["card_id"]: c for c in load(suggest_dir / doc / "cards.jsonl")}
        doc_rows = []
        for lab in by_doc[doc]:
            if lab["id"] in taken:
                problems.append(f"{lab['id']}: already in the base keys or split")
                continue
            card = doc_cards.get(lab["id"])
            if card is None:
                problems.append(f"{lab['id']}: no suggest card")
                continue
            doc_rows.append(keys_row(lab, host, sha_of[doc], card))
            cards.append(card)
            arms[arm].append(lab["id"])
        rows += doc_rows
        new_ladders[doc] = ladder(doc_rows, doc_cards)
        counts[f"{arm}_documents"] += 1
        counts[f"{arm}_rows"] += len(doc_rows)
        counts[f"{arm}_h"] += sum(r["label"]["heading"] for r in doc_rows)
        counts[f"{arm}_hosts:{host}"] = 1
    problems += refusals(rows)
    if problems:
        raise SystemExit("cohort overlay refused:\n" + "\n".join(problems[:30]))
    out.mkdir(parents=True)
    (out / "labels.jsonl").write_text("".join(json.dumps(r) + "\n" for r in base_rows + rows))
    (out / "cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in base_cards + cards))
    (out / "key-headings.json").write_text(json.dumps({**ladders, **new_ladders}) + "\n")
    out_split = {**split, "ids": {a: list(ids) for a, ids in split["ids"].items()}}
    for a in ARMS:
        out_split["ids"][a] = out_split["ids"][a] + sorted(arms[a])
    (out / "split.json").write_text(json.dumps(out_split, indent=1) + "\n")
    report = {"keys_dir": str(keys_dir), "labels": str(labels_path), "salt": salt, "train_share": train_share,
              **{k: v for k, v in sorted(counts.items()) if ":" not in k},
              "hosts": {a: sorted(k.split(":", 1)[1] for k in counts if k.startswith(f"{a}_hosts:")) for a in ARMS},
              "documents": {a: sorted({i.split(":")[0] for i in arms[a]}) for a in ARMS}}
    (out / "overlay-report.json").write_text(json.dumps(report, indent=1) + "\n")
    return report


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("keys-dir", "split", "labels", "suggest-dir", "names", "pdf-dir", "out"):
        p.add_argument(f"--{name}", type=Path, required=True)
    p.add_argument("--salt", required=True)
    p.add_argument("--train-share", type=float, required=True)
    a = p.parse_args(argv)
    r = overlay(a.keys_dir, a.split, a.labels, a.suggest_dir, a.names, a.pdf_dir, a.salt, a.train_share, a.out)
    print(json.dumps({k: v for k, v in r.items() if k not in ("hosts", "documents")}, indent=1))


if __name__ == "__main__":
    main()
