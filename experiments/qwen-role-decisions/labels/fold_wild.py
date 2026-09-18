"""Stage 2 Task 8: fold the four-judge Claude consensus on the wild population into label,
prediction and card files the evaluator takes unchanged.

The wild population is every card of the untagged cohort-3 documents in
``out/suggest/wild/*/sidecar.json``. Four blind Claude judges label them; a card
is labelled when at least ``CONSENSUS_MIN`` (3) agree on the heading bit, type
and level by majority among the agreeing judges. Every number graded against
these rows is disclosed as "graded against Claude-consensus labels"
(``eligibility_eval.py``'s docstring, ``labels/eval_wild.py``).

Consensus input, one row per sidecar card::

    {"id", "type", "label": {"heading", "level"}, "votes": {"judges", "agree"},
     ["actor": "consensus-4judge"], ["answer_id"], ["labelled_at"]}

Other keys (``label_source``, ``unsure: false``, ``note``, ``votes.by``) are
accepted and not carried into the labels.

A no-consensus card is a row whose ``label`` is null (or absent); it is left
out of the labels and counted. Every sidecar card must have a row, and every
row must name a sidecar card: a partial or foreign file is refused, never
silently folded.

Writes:

- ``--out-labels`` (``out/labels/wild-labels.jsonl``): one ``claude-consensus``
  row per consensus card. ``client_id`` = ``template_id`` =
  ``labels.manifest.host_of(url)``, the url from the cohort-3 names file
  (``labels/cohort3-names.txt``, ``<id>.pdf<TAB><url>``); ``document_sha256`` is
  the PDF's bytes (``out/cohort3/real/<id>.pdf``). The rows are checked with
  ``eligibility_eval.refusals`` before anything is written.
- ``--out-predictions`` (``out/stage1/pred-wild-r10.jsonl``): every sidecar card in
  the ``pred-validation-*`` shape ``{id, raw, decided_by, score, score_method}``;
  ``raw`` is rebuilt as ``predict.py`` writes it (compact ``{"type","level","rule"}``,
  absent keys omitted; a card with no type becomes an unparseable ``""``). ``p_H``
  is not in the sidecar and is not derived: a table-vetoed card's type is not
  the model's argmax, so ``score`` does not determine it.
- ``--out-cards`` (``out/labels/wild-cards.jsonl``): the card facts from
  ``s2wild-all-source.jsonl`` for every sidecar card, in sidecar order.

    python3 -B -m labels.fold_wild --consensus out/labels/s2wild-consensus.jsonl \\
        --sidecars out/suggest/wild --names labels/cohort3-names.txt --pdfs out/cohort3/real \\
        --source out/labels/s2wild-all-source.jsonl --out-labels out/labels/wild-labels.jsonl \\
        --out-predictions out/stage1/pred-wild-r10.jsonl --out-cards out/labels/wild-cards.jsonl
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from eligibility_eval import MODEL_FIELDS, PREDICTION_TYPES, load_jsonl, refusals
from labels.manifest import host_of

LABEL_SOURCE = "claude-consensus"
ACTOR = "consensus-4judge"
CONSENSUS_MIN = 3
MAX_JUDGES = 4
LABEL_TYPES = tuple(t for t in PREDICTION_TYPES if t != "Unsure")


def read_names(path: Path) -> dict[str, str]:
    """``<id>.<ext><whitespace><url>`` lines -> {id: url}; ``#`` lines are comments."""
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, url = line.split(None, 1)
        out[name.rsplit(".", 1)[0]] = url.strip()
    return out


def load_inputs(*, consensus: Path, sidecars: Path, names: Path, pdfs: Path, source: Path) -> dict:
    loaded = [json.loads(p.read_text()) for p in sorted(sidecars.glob("*/sidecar.json"))]
    docs = [s["document"] for s in loaded]
    return {
        "consensus": load_jsonl(consensus),
        "sidecars": loaded,
        "urls": read_names(names),
        "pdf_sha256": {d: hashlib.sha256((pdfs / f"{d}.pdf").read_bytes()).hexdigest() for d in docs if (pdfs / f"{d}.pdf").is_file()},
        "source": load_jsonl(source),
    }


def prediction_row(card: dict) -> dict:
    fields = {k: card[k] for k in ("type", "level", "rule") if card.get(k) is not None}
    raw = json.dumps(fields, separators=(",", ":")) if card.get("type") is not None else ""
    method = "rule" if card["decided_by"] == "rule" else ("logprob" if card.get("score") is not None else "logprob_missing")
    return {"id": card["card_id"], "raw": raw, "decided_by": card["decided_by"], "score": card.get("score"), "score_method": method}


def consensus_problems(row: dict) -> list[str]:
    where = f"consensus row {row.get('id')!r}"
    out = []
    if row.get("actor", ACTOR) != ACTOR:
        out.append(f"{where}: actor {row['actor']!r} is not {ACTOR!r}")
    if row.get("label_source", LABEL_SOURCE) != LABEL_SOURCE:
        out.append(f"{where}: label_source {row['label_source']!r} is not {LABEL_SOURCE!r}")
    if row.get("unsure", False) is not False:
        out.append(f"{where}: unsure must be false on a consensus row")
    present = [k for k in MODEL_FIELDS if k in row]
    if present:
        out.append(f"{where}: model fields {present}")
    votes = row.get("votes")
    if not isinstance(votes, dict) or not all(isinstance(votes.get(k), int) for k in ("judges", "agree")):
        return out + [f"{where}: votes must be {{judges, agree}} integers"]
    if not 0 <= votes["agree"] <= votes["judges"] <= MAX_JUDGES:
        out.append(f"{where}: agree exceeds judges, or judges exceeds {MAX_JUDGES}: {votes}")
    if row.get("label") is None:
        return out
    if votes["agree"] < CONSENSUS_MIN:
        out.append(f"{where}: a labelled row needs agree >= {CONSENSUS_MIN}, got {votes}")
    heading = row["label"].get("heading") if isinstance(row["label"], dict) else None
    if row.get("type") not in LABEL_TYPES or heading not in (True, False) or (row["type"] == "H") != heading:
        out.append(f"{where}: type {row.get('type')!r} must be one of {LABEL_TYPES} and H exactly when label.heading is true")
    return out


def fold(*, consensus: list[dict], sidecars: list[dict], urls: dict[str, str], pdf_sha256: dict[str, str],
         source: list[dict]) -> tuple[list[dict], list[dict], list[dict], dict]:
    cards = [(s["document"], c) for s in sidecars for c in s["cards"]]
    doc_of = {c["card_id"]: d for d, c in cards}
    problems: list[str] = []
    seen: dict[str, dict] = {}
    for row in consensus:
        if row.get("id") in seen:
            problems.append(f"duplicate consensus row {row.get('id')!r}")
        elif row.get("id") not in doc_of:
            problems.append(f"consensus row {row.get('id')!r} is not a sidecar card")
        else:
            seen[row["id"]] = row
        problems += consensus_problems(row)
    problems += [f"{cid}: no consensus row" for cid in doc_of if cid not in seen]
    documents = sorted({d for d, _ in cards})
    problems += [f"{d}: no url in the names file" for d in documents if d not in urls]
    problems += [f"{d}: no pdf to hash" for d in documents if d not in pdf_sha256]
    facts = {r["id"]: r for r in source}
    problems += [f"{cid}: not in the source cards" for cid in doc_of if cid not in facts]
    if problems:
        raise ValueError("fold refused:\n" + "\n".join(problems[:30]))

    labels = []
    for doc, card in cards:
        row = seen[card["card_id"]]
        if row.get("label") is None:
            continue
        host = host_of(urls[doc])
        labels.append({
            "id": card["card_id"], "document_id": doc, "document_stem": doc, "label_source": LABEL_SOURCE,
            "answer_id": row.get("answer_id") or f"{ACTOR}:{card['card_id']}", "actor": ACTOR,
            "client_id": host, "template_id": host, "document_sha256": pdf_sha256[doc],
            "type": row["type"], "label": {"heading": row["label"]["heading"], "level": row["label"].get("level")},
            "votes": {"judges": row["votes"]["judges"], "agree": row["votes"]["agree"]},
            **({"labelled_at": row["labelled_at"]} if row.get("labelled_at") else {}),
        })
    bad = refusals(labels)
    if bad:
        raise ValueError("fold refused, label contract:\n" + "\n".join(bad[:30]))
    predictions = [prediction_row(c) for _, c in cards]
    card_rows = [facts[c["card_id"]] for _, c in cards]
    counts = {
        "cards": len(cards), "documents": len(documents), "consensus_kept": len(labels),
        "no_consensus_excluded": len(cards) - len(labels),
        "by_type": dict(sorted(Counter(r["type"] for r in labels).items())),
        "by_heading": {"heading": sum(r["label"]["heading"] for r in labels), "not_heading": sum(not r["label"]["heading"] for r in labels)},
    }
    return labels, predictions, card_rows, counts


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("consensus", "sidecars", "names", "pdfs", "source", "out-labels", "out-predictions", "out-cards"):
        p.add_argument(f"--{name}", type=Path, required=True)
    a = p.parse_args(argv)
    inputs = load_inputs(consensus=a.consensus, sidecars=a.sidecars, names=a.names, pdfs=a.pdfs, source=a.source)
    try:
        labels, predictions, cards, counts = fold(**inputs)
    except ValueError as err:
        raise SystemExit(str(err))
    write_jsonl(a.out_labels, labels)
    write_jsonl(a.out_predictions, predictions)
    write_jsonl(a.out_cards, cards)
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
