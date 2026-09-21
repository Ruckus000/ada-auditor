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
(``stripped-tree``, ``word-outline``, ``planted``), or from a Claude-audited
judgement (``claude-audit``) — a reviewing Claude session's ruling on a card
under R9 (round 6, 2026-09-15), always disclosed on every number reported
from it with the line "graded against Claude-audited labels" — and any model
field on it is refused, so a model output (e.g. ``model-draft``) cannot
become a label by being copied into the wrong file. A ``human-answer`` row on
the same id outranks a ``claude-audit`` row: a later human correction wins,
never the other way around. This module does not enforce that ordering
itself (it takes one row per id, whichever the caller assembled); the caller
building an overlay of ``claude-audit`` rows over a labels file must check
each id's existing ``label_source`` first and skip any that are already
``human-answer``.

``claude-consensus`` (Stage 2 T8, 2026-09-18) is the four-judge Claude
consensus on the wild population: four blind Claude judges (opus low, medium
and high, plus fable medium), each calibrated against the 222 ``audit-s2wild``
rows and dropped below 0.90 heading-bit agreement; a card is labelled when at
least 3 of 4 agree on the heading bit, type and level by majority among the
agreeing judges, and no-consensus cards are excluded and counted. Rows carry
``actor: "consensus-4judge"`` and an optional ``votes: {judges, agree}`` field
that this module ignores. Every number graded against it is disclosed with the
line **"graded against Claude-consensus labels"**. It ranks below
``human-answer`` exactly as ``claude-audit`` does: a human answer on the same
id wins, and the caller assembling an overlay must skip ids that already carry
a ``human-answer`` row.

    python3 -B eligibility_eval.py --self-check
    python3 -B eligibility_eval.py split --labels L.jsonl --salt S --out DIR \
        [--keep PRIOR/split.json --keep-labels PRIOR/labels.jsonl [--assign-new validation]]
    python3 -B eligibility_eval.py evaluate --split DIR/split.json \
        --labels L.jsonl --predictions P.jsonl [--on validation|test]

Evaluating ``test`` writes ``test.spent`` beside the manifest; a second test
evaluation of the same manifest is refused. A new test set needs new labels
and a new split, never a re-draw over the old ones.

``--keep`` extends a prior split rather than re-drawing it (S3, K29). The
prior labels must hash to the prior split's ``labels_sha256`` and its
``group_keys`` must match. Every prior row's document, client and template is
pinned to that row's split — documents, not ids, because a rebuild can change
every id of a document. A new row whose component touches a pin joins that
split; a component touching pins from two splits is refused as a leak; only
unpinned components are assigned by the new salt. The overlap check runs over
all rows. The output records ``salt``, ``kept_from`` (the prior split file's
sha256), ``kept_labels`` (the prior labels' sha256) and ``kept_salt``.

``--assign-new validation`` (with ``--keep``) holds a new population out whole:
after the pinning and grouping checks, every id the prior split does not place
goes to the named split instead of being drawn by salt, and the output records
``assigned_new``. It refuses, naming the key and its split, when any new id's
document, client or template already sits in a different split. ``test`` is not
an accepted target.
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
GROUP_KEYS = ("document_sha256", "template_id", "client_id")
MODEL_FIELDS = ("prediction", "model", "model_role", "heading_flag", "raw", "confidence")
LABEL_SOURCES = ("human-answer", "stripped-tree", "word-outline", "planted", "claude-audit", "claude-consensus", "opus-kimi-consensus")
# --assign-new targets. Never test: a held-out set is only ever grown into validation (or train).
ASSIGNABLE = ("train", "validation")
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
    """Union rows sharing any document, template or client.

    ``answer_id`` is not a group key: every row carries its own, so it links
    nothing and would only make the split's names depend on random ids.
    """
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


def pins(keep: dict, prior_rows: list[dict] | None) -> dict[str, str]:
    """K29: every prior row's document, client and template, pinned to that row's split.

    Ids are not pinned: a rebuild can change every id of a prior document, and an
    id-only keep would then re-draw it by salt — the leak S3 exists to stop."""
    if prior_rows is None:
        raise ValueError("--keep needs the prior labels (--keep-labels) to pin documents")
    if list(keep.get("group_keys") or []) != list(GROUP_KEYS):
        raise ValueError(f"prior split group_keys {keep.get('group_keys')} differ from {list(GROUP_KEYS)}")
    prior = {rid: name for name, ids in keep["ids"].items() for rid in ids}
    missing = sorted(r["id"] for r in prior_rows if r["id"] not in prior)
    if missing:
        raise ValueError(f"prior labels hold rows the prior split does not place: {missing[:5]}")
    pinned: dict[str, set[str]] = {}
    for row in prior_rows:
        for k in GROUP_KEYS:
            pinned.setdefault(f"{k}:{row[k]}", set()).add(prior[row["id"]])
    torn = sorted(k for k, splits in pinned.items() if len(splits) > 1)
    if torn:
        raise ValueError(f"prior split already leaks across group keys: {torn[:5]}")
    return {k: next(iter(splits)) for k, splits in pinned.items()}


def pinned_membership(rows: list[dict], comp: dict[str, str], pinned: dict[str, str], salt: str) -> dict[str, str]:
    """S3/K29: a component touching a pinned key takes that split; a component touching
    pins from two splits is refused; only unpinned components are drawn by the new salt."""
    touched: dict[str, dict[str, str]] = {}
    for row in rows:
        for k in GROUP_KEYS:
            key = f"{k}:{row[k]}"
            if key in pinned:
                touched.setdefault(comp[row["id"]], {})[key] = pinned[key]
    mixed = {c: keys for c, keys in touched.items() if len(set(keys.values())) > 1}
    if mixed:
        detail = [f"component {c} touches pins from {sorted(set(keys.values()))}: {dict(sorted(keys.items()))}" for c, keys in sorted(mixed.items())]
        raise ValueError("--keep would leak across splits:\n" + "\n".join(detail))
    return {rid: next(iter(touched[c].values())) if c in touched else assign(c, salt) for rid, c in comp.items()}


def assigned_new(rows: list[dict], membership: dict[str, str], keep: dict, pinned: dict[str, str], target: str) -> dict[str, str]:
    """Stage 2 T8: every id the prior split does not place goes to ``target``, whatever the salt
    drew; prior ids keep the split their pins gave them. Runs after the pinning and grouping
    checks. A new id whose document, client or template is pinned to another split is refused."""
    prior_ids = {rid for ids in keep["ids"].values() for rid in ids}
    clashes = sorted(
        f"{row['id']}: {k}:{row[k]} already sits in {pinned[f'{k}:{row[k]}']}"
        for row in rows
        if row["id"] not in prior_ids
        for k in GROUP_KEYS
        if pinned.get(f"{k}:{row[k]}", target) != target
    )
    if clashes:
        raise ValueError(f"--assign-new {target} refused: a new id's document, client or template is already in another split:\n" + "\n".join(clashes[:20]))
    return {rid: split_ if rid in prior_ids else target for rid, split_ in membership.items()}


def split(rows: list[dict], salt: str, keep: dict | None = None, prior_rows: list[dict] | None = None,
          assign_new: str | None = None) -> dict:
    bad = refusals(rows)
    if bad:
        raise ValueError("labels refused:\n" + "\n".join(bad))
    if assign_new is not None and (not keep or assign_new not in ASSIGNABLE):
        raise ValueError(f"--assign-new needs --keep and one of {ASSIGNABLE}; the test split is never grown by assignment")
    comp = components(rows)
    if keep:
        pinned = pins(keep, prior_rows)
        membership = pinned_membership(rows, comp, pinned, salt)
        if assign_new is not None:
            membership = assigned_new(rows, membership, keep, pinned, assign_new)
    else:
        membership = {rid: assign(c, salt) for rid, c in comp.items()}
    leaks = overlaps(rows, membership)
    if leaks:
        raise AssertionError(f"split leaked across groups: {leaks[:5]}")
    result = {
        "salt": salt,
        "group_keys": list(GROUP_KEYS),
        "components": len(set(comp.values())),
        "ids": {name: sorted(r for r, s in membership.items() if s == name) for name, _ in SPLIT},
    }
    if keep:
        result["kept_salt"] = keep.get("salt")
    if assign_new is not None:
        result["assigned_new"] = assign_new
    return result


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


def evaluate(rows: list[dict], predictions: dict[str, str], decided_by: dict[str, str] | None = None) -> dict:
    """``decided_by`` is an optional row id -> ``"rule"``/``"model"`` map. When given,
    the result gains ``type_confusion_by_decider``: the same entries as ``type_confusion``
    (Other excluded, in-vocabulary predicted types only), split by decider. It does not
    change ``type_confusion`` or any binary metric.
    """
    confusion = Counter()
    type_confusion = Counter()
    type_confusion_by_decider = {"rule": Counter(), "model": Counter()} if decided_by is not None else None
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
                if decided_by is not None:
                    decider = decided_by.get(row["id"])
                    if decider in ("rule", "model"):
                        type_confusion_by_decider[decider][f"{row['type']}->{pd['type']}"] += 1
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
    result = {
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
    if decided_by is not None:
        result["type_confusion_by_decider"] = {k: dict(v) for k, v in type_confusion_by_decider.items()}
    return result


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cmd_split(args: argparse.Namespace) -> None:
    keep = prior_rows = None
    if args.keep:
        if not args.keep_labels:
            raise SystemExit("--keep needs --keep-labels <prior labels.jsonl> (K29)")
        keep = json.loads(args.keep.read_text())
        if sha256_file(args.keep_labels) != keep.get("labels_sha256"):
            raise SystemExit(f"{args.keep_labels} is not the labels {args.keep} was drawn from (labels_sha256 differs)")
        prior_rows = load_jsonl(args.keep_labels)
    assign_new = getattr(args, "assign_new", None)
    if assign_new and not args.keep:
        raise SystemExit("--assign-new needs --keep and --keep-labels")
    result = split(load_jsonl(args.labels), args.salt, keep=keep, prior_rows=prior_rows, assign_new=assign_new)
    result["labels_sha256"] = sha256_file(args.labels)
    if args.keep:
        result["kept_from"] = sha256_file(args.keep)
        result["kept_labels"] = sha256_file(args.keep_labels)
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
    pred_rows = load_jsonl(args.predictions)
    predictions = {p["id"]: p["raw"] for p in pred_rows}
    decided_by = None
    if any("decided_by" in p for p in pred_rows):
        decided_by = {p["id"]: p["decided_by"] for p in pred_rows if "decided_by" in p}
    result = {
        "on": args.on,
        "predictions_sha256": sha256_file(args.predictions),
        **evaluate(rows, predictions, decided_by=decided_by),
    }
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
        # Answer ids name no group: fresh ones with the same salt draw the same split.
        fresh = [{**row, "answer_id": f"fresh-{row['id']}"} for row in rows]
        assert split(fresh, salt)["ids"] == result["ids"]
    assert overlaps(rows[:2], {"q0": "train", "q1": "train"}) == []
    assert overlaps([rows[0], {**rows[1], "client_id": "client0"}], {"q0": "train", "q1": "test"})

    # --keep (S3/K29): prior documents, clients and templates are pinned, not ids.
    def keyed(i: int, host: str, doc: str) -> dict:
        return {**label(i, True, host, host), "id": f"k{i}", "document_sha256": hashlib.sha256(doc.encode()).hexdigest()}

    def placed(result: dict) -> dict[str, str]:
        return {rid: name for name, ids in result["ids"].items() for rid in ids}

    prior_rows = [keyed(1, "a.gov", "d1"), keyed(2, "b.gov", "d2"), keyed(3, "c.gov", "d3")]
    prior = {"salt": "old", "group_keys": list(GROUP_KEYS), "ids": {"train": ["k1"], "validation": ["k2", "k3"], "test": []}}
    kept_rows = [keyed(1, "a.gov", "d1"), keyed(2, "b.gov", "d2"), keyed(3, "c.gov", "d3"), keyed(4, "b.gov", "d4"), keyed(5, "new.gov", "d5")]
    for salt in ("s", "t", "u"):
        got = split(kept_rows, salt, keep=prior, prior_rows=prior_rows)
        where = placed(got)
        assert where["k1"] == "train" and where["k2"] == where["k3"] == "validation", where  # kept rows stay
        assert where["k4"] == "validation", where  # new document on b.gov, pinned by k2's host
        assert where["k5"] == assign(components(kept_rows)["k5"], salt), where  # unpinned host: by salt
        assert got["salt"] == salt and got["kept_salt"] == "old"
    assert "kept_salt" not in split(kept_rows, "s")
    # The review's failure: a prior document rebuilt with none of its ids. It keeps its split;
    # id-only keeping would have re-drawn it by salt.
    rebuilt = [keyed(30, "c.gov", "d3"), keyed(31, "c.gov", "d3")]
    moved = [salt for salt in (f"r{i}" for i in range(50)) if placed(split(rebuilt, salt)).get("k30") != "validation"]
    assert moved, "no salt re-draws d3 away from validation; the case proves nothing"
    for salt in moved[:3]:
        assert placed(split(rebuilt, salt))["k30"] != "validation"  # what id-only logic did: no surviving id
        assert set(split(rebuilt, salt, keep=prior, prior_rows=prior_rows)["ids"]["validation"]) == {"k30", "k31"}
    # k6 shares a document with train's k1 and a host with validation's k2: a leak, refused.
    for bad_input, needle in (
        ((kept_rows + [keyed(6, "b.gov", "d1")], prior, prior_rows), "client_id:b.gov"),
        ((kept_rows, {**prior, "group_keys": ["document_sha256"]}, prior_rows), "group_keys"),
        ((kept_rows, prior, None), "prior labels"),
        ((kept_rows, prior, prior_rows + [keyed(9, "z.gov", "d9")]), "k9"),
    ):
        rows_, keep_, prior_ = bad_input
        try:
            split(rows_, "s", keep=keep_, prior_rows=prior_)
        except ValueError as err:
            assert needle in str(err), (needle, err)
        else:
            raise AssertionError(f"--keep must refuse ({needle})")
    # Overlaps run over every row, kept ones included: a leaky membership between a kept
    # row (k2, validation) and a new one (k4) must be caught even though k4 alone is clean.
    real = globals()["pinned_membership"]
    globals()["pinned_membership"] = lambda rows_, comp, pins_, salt_: {**real(rows_, comp, pins_, salt_), "k4": "test"}
    try:
        split(kept_rows, "s", keep=prior, prior_rows=prior_rows)
    except AssertionError as err:
        assert "client_id:b.gov" in str(err), err
    else:
        raise AssertionError("overlaps must run over all rows")
    finally:
        globals()["pinned_membership"] = real
    # --assign-new (Stage 2 T8): every id the prior split does not place goes to the named
    # split -- the wild set is held out whole, never drawn by salt; kept ids do not move; a new
    # id whose document, client or template already sits in another split is refused.
    wild = [keyed(40, "w1.gov", "w1"), keyed(41, "w1.gov", "w1"), keyed(42, "w2.gov", "w2"), keyed(43, "b.gov", "w3")]
    for salt in ("s", "t", "u"):
        got = placed(split(kept_rows[:3] + wild, salt, keep=prior, prior_rows=prior_rows, assign_new="validation"))
        assert got["k1"] == "train" and got["k2"] == got["k3"] == "validation", got
        assert all(got[f"k{i}"] == "validation" for i in (40, 41, 42, 43)), got
    assert split(kept_rows[:3] + wild, "s", keep=prior, prior_rows=prior_rows, assign_new="validation")["assigned_new"] == "validation"
    for bad_rows, needle in (([keyed(44, "a.gov", "w4")], "client_id:a.gov"), ([keyed(45, "z.gov", "d1")], "document_sha256:")):
        try:
            split(kept_rows[:3] + wild + bad_rows, "s", keep=prior, prior_rows=prior_rows, assign_new="validation")
        except ValueError as err:
            assert needle in str(err) and "train" in str(err) and "--assign-new" in str(err), err
        else:
            raise AssertionError(f"--assign-new must refuse a new id pinned to train ({needle})")
    for kw in ({"assign_new": "test", "keep": prior, "prior_rows": prior_rows}, {"assign_new": "validation"}):
        try:
            split(kept_rows[:3] + wild, "s", **kw)
        except ValueError:
            pass
        else:
            raise AssertionError(f"--assign-new must refuse {kw.get('assign_new')} without --keep or into test")
    # The command: kept_from hashes the prior split file, kept_labels the prior labels;
    # stale prior labels and --keep alone are refused.
    import tempfile
    from types import SimpleNamespace

    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "prior.jsonl").write_text("".join(json.dumps(r) + "\n" for r in prior_rows))
        (t / "prior-split.json").write_text(json.dumps({**prior, "labels_sha256": sha256_file(t / "prior.jsonl")}))
        (t / "new.jsonl").write_text("".join(json.dumps(r) + "\n" for r in kept_rows))
        args = SimpleNamespace(labels=t / "new.jsonl", salt="s", out=t / "out", keep=t / "prior-split.json", keep_labels=t / "prior.jsonl")
        cmd_split(args)
        written = json.loads((t / "out" / "split.json").read_text())
        assert written["kept_from"] == sha256_file(t / "prior-split.json") != sha256_file(t / "prior.jsonl")
        assert written["kept_labels"] == sha256_file(t / "prior.jsonl") and written["kept_salt"] == "old"
        (t / "wild.jsonl").write_text("".join(json.dumps(r) + "\n" for r in kept_rows[:3] + wild))
        cmd_split(SimpleNamespace(**{**vars(args), "labels": t / "wild.jsonl", "out": t / "wild-out", "assign_new": "validation"}))
        written = json.loads((t / "wild-out" / "split.json").read_text())
        assert written["assigned_new"] == "validation" and written["ids"]["train"] == ["k1"] and written["ids"]["test"] == [], written
        (t / "stale.jsonl").write_text((t / "prior.jsonl").read_text() + "\n")
        for bad in ({"keep_labels": t / "stale.jsonl"}, {"keep_labels": None}):
            try:
                cmd_split(SimpleNamespace(**{**vars(args), **bad}))
            except SystemExit:
                pass
            else:
                raise AssertionError(f"cmd_split must refuse {bad}")

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
    # claude-audit is a label source too (R9): a reviewing Claude session's ruling
    a = {**label(6, True, "c", "t"), "label_source": "claude-audit", "actor": "claude-coordinator"}
    assert refusals([a]) == []
    assert refusals([{**a, "label_source": "claude-draft"}])
    # claude-consensus is a label source (Stage 2 T8): the four-judge consensus row, with an
    # optional votes field the evaluator ignores.
    cons = {**label(7, True, "c", "t", 2), "label_source": "claude-consensus", "actor": "consensus-4judge", "type": "H",
            "votes": {"judges": 4, "agree": 3}}
    assert refusals([cons]) == [], refusals([cons])
    assert evaluate([cons], {cons["id"]: '{"type":"H","level":2,"rule":1}'})["confusion"]["tp"] == 1
    assert LABEL_SOURCES.index("claude-consensus") > LABEL_SOURCES.index("human-answer")
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

    # decided_by (S18): a rule-decided P->Lbl and a model-decided H->P separate into
    # per-decider tables while type_confusion still holds both.
    by_decider_rows = [
        {**label(0, False, "c", "t"), "id": "d1", "type": "P"},
        {**label(1, True, "c", "t"), "id": "d2", "type": "H"},
    ]
    by_decider_preds = {"d1": '{"type":"Lbl","rule":1}', "d2": '{"type":"P","rule":1}'}
    no_decider = evaluate(by_decider_rows, by_decider_preds)
    assert "type_confusion_by_decider" not in no_decider
    got = evaluate(by_decider_rows, by_decider_preds, decided_by={"d1": "rule", "d2": "model"})
    assert got["type_confusion"] == {"P->Lbl": 1, "H->P": 1}, got["type_confusion"]
    assert got["type_confusion_by_decider"] == {"rule": {"P->Lbl": 1}, "model": {"H->P": 1}}, got["type_confusion_by_decider"]
    assert got["confusion"] == no_decider["confusion"] and got["accuracy"] == no_decider["accuracy"]
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
    s.add_argument("--keep", type=Path, help="prior split.json whose documents, clients and templates stay put (S3/K29)")
    s.add_argument("--keep-labels", type=Path, help="the prior labels.jsonl that split was drawn from; required with --keep")
    s.add_argument("--assign-new", choices=ASSIGNABLE, help="with --keep: every id the prior split does not place goes to this split, not by salt; refused if its document, client or template sits in another split")
    e = sub.add_parser("evaluate")
    e.add_argument("--split", type=Path, required=True)
    e.add_argument("--labels", type=Path, required=True)
    e.add_argument("--predictions", type=Path, required=True)
    e.add_argument("--on", choices=("validation", "test"), default="validation")
    args = parser.parse_args()
    cmd_split(args) if args.command == "split" else cmd_evaluate(args)


if __name__ == "__main__":
    main()
