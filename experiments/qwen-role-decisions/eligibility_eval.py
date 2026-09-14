#!/usr/bin/env python3
"""Leakage-safe split and sealed evaluation for heading-eligibility suggestions.

The instrument the 99% claim would have to pass. It trains nothing, calls no
model, and changes no PDF. It exists before any further training because no
existing helper can say what the claim needs: ``verifier_gate`` counts TP/FP
on development rows but carries no provenance, no leakage check, no interval,
no level or abstention reporting, and no notion of a spent test set.

Labels and predictions live in separate files on purpose. A label row must
come from a human answer from the correction workflow — ``label_source:
"human-answer"`` with the answer row's id and actor — or from a key source
(``stripped-tree``, ``word-outline``, ``planted``), and any model field on it
is refused, so a model output (e.g. ``model-draft``) cannot become a label by
being copied into the wrong file.

    python3 -B eligibility_eval.py --self-check
    python3 -B eligibility_eval.py split --labels L.jsonl --salt S --out DIR
    python3 -B eligibility_eval.py evaluate --split DIR/split.json \
        --labels L.jsonl --predictions P.jsonl [--on validation|test]

Evaluating ``test`` writes ``test.spent`` beside the manifest; a second test
evaluation of the same manifest is refused. A new test set needs new labels
and a new split, never a re-draw over the old ones.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import Counter
from pathlib import Path

from run import parse_heading_flag

# Registered before any label exists (see the 2026-09-12 learning-loop record).
# Changing them after a test evaluation is a new registration, not a tweak.
TARGET_ACCURACY = 0.99
TARGET_FPR = 0.01
CONFIDENCE = 0.95
MIN_TEST_DOCUMENTS = 30
MIN_TEST_CLIENTS = 5
MIN_TEST_TEMPLATES = 10
SPLIT = (("train", 0.6), ("validation", 0.2), ("test", 0.2))
GROUP_KEYS = ("document_sha256", "template_id", "client_id", "answer_id")
MODEL_FIELDS = ("prediction", "model", "model_role", "heading_flag", "raw", "confidence")
LABEL_SOURCES = ("human-answer", "stripped-tree", "word-outline", "planted")
PREDICTION_TYPES = ("H", "P", "Artifact", "Caption", "TH", "TOCI", "Lbl", "BlockQuote", "Other", "Unsure")
UNKNOWN_TEMPLATE = "unknown"
# Every development and spent-holdout document the Qwen spikes have read, by
# stem. Real labels are keyed by bytes, so a match here means a synthetic
# research document was relabelled into the pool — refused, never re-scored.
SPENT_STEM_PREFIXES = ("h", "k")
DEV_STEM_DIGITS = 2


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def is_spent_stem(stem: str) -> bool:
    head = stem.split("-", 1)[0]
    if len(head) == 3 and head[0] in SPENT_STEM_PREFIXES and head[1:].isdigit():
        return True
    return len(head) == DEV_STEM_DIGITS and head.isdigit() and "-" in stem


def refusals(rows: list[dict]) -> list[str]:
    """Every reason these rows cannot be labels. Empty means usable."""
    out: list[str] = []
    seen: set[str] = set()
    for i, row in enumerate(rows):
        where = f"row {i} ({row.get('id')!r})"
        rid = row.get("id")
        if not isinstance(rid, str) or not rid:
            out.append(f"{where}: missing id")
        elif rid in seen:
            out.append(f"{where}: duplicate id")
        else:
            seen.add(rid)
        if row.get("label_source") not in LABEL_SOURCES:
            out.append(f"{where}: label_source must be one of {LABEL_SOURCES}")
        for key in ("answer_id", "actor", "client_id", "template_id"):
            if not isinstance(row.get(key), str) or not row[key]:
                out.append(f"{where}: missing {key}")
        sha = row.get("document_sha256")
        if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
            out.append(f"{where}: document_sha256 must be 64 lowercase hex")
        stem = row.get("document_stem")
        if isinstance(stem, str) and is_spent_stem(stem):
            out.append(f"{where}: document {stem!r} is development or spent-holdout material")
        present = [k for k in MODEL_FIELDS if k in row]
        if present:
            out.append(f"{where}: model fields on a label row {present}")
        label = row.get("label")
        if not isinstance(label, dict) or label.get("heading") not in (True, False):
            out.append(f"{where}: label.heading must be true or false")
            continue
        level = label.get("level")
        if label["heading"] and level is not None and level not in range(1, 7):
            out.append(f"{where}: label.level must be 1-6 or null")
        if not label["heading"] and level is not None:
            out.append(f"{where}: a non-heading carries no level")
    return out


def components(rows: list[dict]) -> dict[str, str]:
    """Union rows sharing any document, template, client or correction event."""
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for row in rows:
        keys = [f"{k}:{row[k]}" for k in GROUP_KEYS]
        for key in keys[1:]:
            a, b = find(keys[0]), find(key)
            if a != b:
                parent[max(a, b)] = min(a, b)
    return {row["id"]: find(f"{GROUP_KEYS[0]}:{row[GROUP_KEYS[0]]}") for row in rows}


def assign(component: str, salt: str) -> str:
    unit = int(hashlib.sha256(f"{salt}\0{component}".encode()).hexdigest()[:15], 16) / 16**15
    edge = 0.0
    for name, share in SPLIT:
        edge += share
        if unit < edge:
            return name
    return SPLIT[-1][0]


def overlaps(rows: list[dict], membership: dict[str, str]) -> list[str]:
    """Checked independently of how the split was drawn."""
    by_key: dict[str, set[str]] = {}
    for row in rows:
        for key in GROUP_KEYS:
            by_key.setdefault(f"{key}:{row[key]}", set()).add(membership[row["id"]])
    return sorted(k for k, splits in by_key.items() if len(splits) > 1)


def split(rows: list[dict], salt: str) -> dict:
    bad = refusals(rows)
    if bad:
        raise ValueError("labels refused:\n" + "\n".join(bad))
    comp = components(rows)
    membership = {rid: assign(c, salt) for rid, c in comp.items()}
    leaks = overlaps(rows, membership)
    if leaks:
        raise AssertionError(f"split leaked across groups: {leaks[:5]}")
    return {
        "salt": salt,
        "group_keys": list(GROUP_KEYS),
        "components": len(set(comp.values())),
        "ids": {name: sorted(r for r, s in membership.items() if s == name) for name, _ in SPLIT},
    }


def binom_cdf(k: int, n: int, p: float) -> float:
    if p <= 0:
        return 1.0
    if p >= 1:
        return 0.0 if k < n else 1.0
    return sum(
        math.exp(math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * math.log(p) + (n - i) * math.log1p(-p))
        for i in range(k + 1)
    )


def upper_bound(k: int, n: int, confidence: float = CONFIDENCE) -> float | None:
    """One-sided exact (Clopper-Pearson) upper bound on a rate of k in n."""
    if n == 0:
        return None
    if k >= n:
        return 1.0
    lo, hi = k / n, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if binom_cdf(k, n, mid) > 1 - confidence:
            lo = mid
        else:
            hi = mid
    return hi


def prediction_dict(raw: str) -> dict | None:
    try:
        data = json.loads(raw[raw.index("{") : raw.rindex("}") + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def read_prediction(raw: str) -> tuple[str, int | None]:
    """``heading`` | ``not-heading`` | ``abstain`` | ``parse-failure``, and a level.

    Two output shapes: the binary ``{"heading": bool}`` and the typed
    ``{"type": <vocab>, "level": n, "rule": r}`` the staged-autonomy roadmap
    trains toward. ``Unsure`` and ``{"abstain": true}`` are abstentions.
    """
    data = prediction_dict(raw)
    if data is None:
        return "parse-failure", None
    level = data.get("level") if data.get("level") in range(1, 7) else None
    if "type" in data and data.get("type") not in PREDICTION_TYPES:
        return "parse-failure", None
    if data.get("type") == "Unsure" or (data.get("abstain") is True and "heading" not in data and "type" not in data):
        return "abstain", None
    if isinstance(data.get("type"), str):
        return ("heading" if data["type"] == "H" else "not-heading"), level
    flag = parse_heading_flag(raw)
    if flag is None:
        return "parse-failure", None
    return ("heading" if flag else "not-heading"), level


def evaluate(rows: list[dict], predictions: dict[str, str]) -> dict:
    confusion = Counter()
    type_confusion = Counter()
    level_n = level_exact = 0
    missing = []
    for row in rows:
        truth = row["label"]["heading"]
        raw = predictions.get(row["id"])
        if raw is None:
            missing.append(row["id"])
            outcome, level = "parse-failure", None
        else:
            outcome, level = read_prediction(raw)
            pd = prediction_dict(raw)
            if (
                row.get("type")
                and pd
                and isinstance(pd.get("type"), str)
                and pd["type"] in PREDICTION_TYPES
                and "Other" not in (row["type"], pd["type"])
            ):
                type_confusion[f"{row['type']}->{pd['type']}"] += 1
        if outcome in ("abstain", "parse-failure"):
            confusion[outcome] += 1
        elif outcome == "heading":
            confusion["tp" if truth else "fp"] += 1
        else:
            confusion["fn" if truth else "tn"] += 1
        if truth and outcome == "heading" and row["label"].get("level") is not None:
            level_n += 1
            level_exact += level == row["label"]["level"]
    n = len(rows)
    negatives = sum(1 for r in rows if not r["label"]["heading"])
    errors = n - confusion["tp"] - confusion["tn"]
    accuracy = None if n == 0 else (confusion["tp"] + confusion["tn"]) / n
    fpr = None if negatives == 0 else confusion["fp"] / negatives
    error_upper = upper_bound(errors, n)
    fpr_upper = upper_bound(confusion["fp"], negatives)
    documents = {r["document_sha256"] for r in rows}
    clients = {r["client_id"] for r in rows}
    templates = {r["template_id"] for r in rows}
    blockers = []
    if accuracy is None or accuracy < TARGET_ACCURACY:
        blockers.append("accuracy below target")
    if fpr is None or fpr > TARGET_FPR:
        blockers.append("false-positive rate above target")
    if error_upper is None or 1 - error_upper < TARGET_ACCURACY:
        blockers.append(f"{CONFIDENCE:.0%} lower bound on accuracy below target")
    if fpr_upper is None or fpr_upper > TARGET_FPR:
        blockers.append(f"{CONFIDENCE:.0%} upper bound on false-positive rate above target")
    if len(documents) < MIN_TEST_DOCUMENTS:
        blockers.append(f"fewer than {MIN_TEST_DOCUMENTS} documents")
    if len(clients) < MIN_TEST_CLIENTS:
        blockers.append(f"fewer than {MIN_TEST_CLIENTS} clients")
    if len(templates - {UNKNOWN_TEMPLATE}) < MIN_TEST_TEMPLATES:
        blockers.append(f"fewer than {MIN_TEST_TEMPLATES} known templates")
    if UNKNOWN_TEMPLATE in templates:
        blockers.append("template provenance incomplete; template leakage cannot be ruled out")
    return {
        "n": n,
        "positives": n - negatives,
        "negatives": negatives,
        "confusion": {k: confusion[k] for k in ("tp", "fp", "tn", "fn", "abstain", "parse-failure")},
        "missing_predictions": missing,
        "accuracy": accuracy,
        "accuracy_lower_bound": None if error_upper is None else 1 - error_upper,
        "false_positive_rate": fpr,
        "false_positive_rate_upper_bound": fpr_upper,
        "false_negative_rate": None if n == negatives else confusion["fn"] / (n - negatives),
        "heading_level": {"n": level_n, "exact": level_exact},
        "type_confusion": dict(type_confusion),
        "uncertainty": {"abstentions": confusion["abstain"], "confidence": CONFIDENCE, "bound": "one-sided Clopper-Pearson"},
        "diversity": {"documents": len(documents), "clients": len(clients), "templates": len(templates)},
        "blockers": blockers,
        "target_met": not blockers,
    }


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cmd_split(args: argparse.Namespace) -> None:
    result = split(load_jsonl(args.labels), args.salt)
    result["labels_sha256"] = sha256_file(args.labels)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "split.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: len(v) for k, v in result["ids"].items()}))


def cmd_evaluate(args: argparse.Namespace) -> None:
    manifest = json.loads(args.split.read_text())
    if sha256_file(args.labels) != manifest["labels_sha256"]:
        raise SystemExit("labels changed since the split was drawn; draw a new split")
    spent = args.split.with_name("test.spent")
    if args.on == "test" and spent.exists():
        raise SystemExit(f"test set already evaluated ({spent}); it is spent")
    wanted = set(manifest["ids"][args.on])
    rows = [r for r in load_jsonl(args.labels) if r["id"] in wanted]
    predictions = {p["id"]: p["raw"] for p in load_jsonl(args.predictions)}
    result = {"on": args.on, "predictions_sha256": sha256_file(args.predictions), **evaluate(rows, predictions)}
    if args.on == "test":
        spent.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


def self_check() -> None:
    def label(i: int, heading: bool, client: str, template: str, level: int | None = None) -> dict:
        return {
            "id": f"q{i}",
            "label_source": "human-answer",
            "answer_id": f"ans-{i}",
            "actor": "reviewer",
            "client_id": client,
            "template_id": template,
            "document_sha256": hashlib.sha256(f"doc{i // 3}".encode()).hexdigest(),
            "label": {"heading": heading, "level": level},
        }

    assert is_spent_stem("h11-chart-labels-as-headings") and is_spent_stem("18-food-safety")
    assert not is_spent_stem("minutes-2026")
    bad = [{**label(0, True, "c", "t"), "label_source": "model"}, {**label(1, False, "c", "t"), "raw": "{}"}]
    assert len(refusals(bad)) == 2, refusals(bad)
    assert any("spent" in r for r in refusals([{**label(2, True, "c", "t"), "document_stem": "k01-vector"}]))

    # A template shared by two clients must pull both clients into one split.
    rows = [
        {**label(i, i % 2 == 0, f"client{i % 40}", f"tpl{i % 40}"), "document_sha256": hashlib.sha256(f"d{i}".encode()).hexdigest()}
        for i in range(400)
    ]
    rows.append({**label(900, True, "client0", "tpl-shared"), "document_sha256": "a" * 64})
    rows.append({**label(901, False, "client1", "tpl-shared"), "document_sha256": "b" * 64})
    for salt in ("s", "t", "u"):
        result = split(rows, salt)
        membership = {rid: name for name, ids in result["ids"].items() for rid in ids}
        assert result["components"] == 39, result["components"]
        assert all(result["ids"][name] for name, _ in SPLIT)
        assert not overlaps(rows, membership)
        assert membership["q900"] == membership["q901"] == membership["q0"] == membership["q1"]
    assert overlaps(rows[:2], {"q0": "train", "q1": "train"}) == []
    assert overlaps([rows[0], {**rows[1], "client_id": "client0"}], {"q0": "train", "q1": "test"})

    # Exact bound: zero errors in 299 is the smallest n whose 95% bound is <= 1%.
    assert upper_bound(0, 299) <= 0.01 < upper_bound(0, 298)

    preds = {"a": '{"heading":true,"level":2}', "b": '{"heading":true}', "c": '{"abstain":true}', "d": "nope", "e": '{"heading":false}'}
    small = [
        {**label(0, True, "c1", "t1", 2), "id": "a"},
        {**label(1, False, "c1", "t1"), "id": "b"},
        {**label(2, True, "c1", "t1"), "id": "c"},
        {**label(3, False, "c1", "t1"), "id": "d"},
        {**label(4, False, "c1", UNKNOWN_TEMPLATE), "id": "e"},
    ]
    got = evaluate(small, preds)
    assert got["confusion"] == {"tp": 1, "fp": 1, "tn": 1, "fn": 0, "abstain": 1, "parse-failure": 1}, got
    assert got["accuracy"] == 0.4 and got["false_positive_rate"] == 1 / 3
    assert got["heading_level"] == {"n": 1, "exact": 1}
    assert any("template provenance" in b for b in got["blockers"]) and not got["target_met"]

    perfect = [label(i, i % 3 == 0, f"c{i % 6}", f"t{i % 12}") for i in range(1200)]
    ok = evaluate(perfect, {r["id"]: json.dumps({"heading": r["label"]["heading"]}) for r in perfect})
    assert ok["target_met"], ok["blockers"]
    # Accuracy can clear its bound on positives alone; too few negatives must still block.
    few_negatives = [label(i, i >= 100, f"c{i % 6}", f"t{i % 12}") for i in range(1200)]
    thin = evaluate(few_negatives, {r["id"]: json.dumps({"heading": r["label"]["heading"]}) for r in few_negatives})
    assert thin["blockers"] == [f"{CONFIDENCE:.0%} upper bound on false-positive rate above target"], thin["blockers"]

    # key sources are labels; a model source is not
    k = {**label(5, True, "c", "t"), "label_source": "stripped-tree", "actor": "key:stripped-tree"}
    assert refusals([k]) == []
    assert refusals([{**k, "label_source": "model-draft"}])
    # type-shaped predictions
    assert read_prediction('{"type":"Caption","rule":3}') == ("not-heading", None)
    assert read_prediction('{"type":"H","level":2,"rule":1}') == ("heading", 2)
    assert read_prediction('{"type":"Unsure"}') == ("abstain", None)
    assert read_prediction('{"type":"Heading","rule":1}') == ("parse-failure", None)
    assert read_prediction('{"type":"h2","rule":1}') == ("parse-failure", None)
    assert read_prediction('{"type": 3}') == ("parse-failure", None)
    typed = [{**label(0, False, "c", "t"), "id": "t1", "type": "Caption"}, {**label(1, True, "c", "t", 2), "id": "t2", "type": "H"}]
    got = evaluate(typed, {"t1": '{"type":"H","level":1,"rule":1}', "t2": '{"type":"H","level":2,"rule":1}'})
    assert got["confusion"]["fp"] == 1 and got["type_confusion"] == {"Caption->H": 1, "H->H": 1}
    print("eligibility_eval_self_check_ok")


def main() -> None:
    if "--self-check" in sys.argv:
        self_check()
        return
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("split")
    s.add_argument("--labels", type=Path, required=True)
    s.add_argument("--salt", required=True)
    s.add_argument("--out", type=Path, required=True)
    e = sub.add_parser("evaluate")
    e.add_argument("--split", type=Path, required=True)
    e.add_argument("--labels", type=Path, required=True)
    e.add_argument("--predictions", type=Path, required=True)
    e.add_argument("--on", choices=("validation", "test"), default="validation")
    args = parser.parse_args()
    cmd_split(args) if args.command == "split" else cmd_evaluate(args)


if __name__ == "__main__":
    main()
