"""CPU second opinion over the combination's decided cards. Registration:
docs/research/document-remediation/heading-cpu-probes-2026-10-09-registration.md

Usage: python -B run_probe.py DATA_OUT EXPERIMENT_DIR RESULT_DIR
  DATA_OUT        ADA-Auditor-data/qwen-role-decisions/out (read only)
  EXPERIMENT_DIR  a checkout's experiments/qwen-role-decisions, for labels.certify.fp_max (read only; run with -B)
  RESULT_DIR      where results are written (created)
"""
from __future__ import annotations

import collections
import glob
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

from probe_lib import CATEGORICAL, features, host_of, vetoed_read

DROP = {"c8-0033", "c8-0034", "c8-0072"}
T = 0.9940428477888315
LABELS = ["labels/cohort8-labels-current.jsonl", "labels/cohort8-arms-2026-10-03-labels-adjudicated.jsonl",
          "labels/cohort8-seed2-2026-10-05-labels-adjudicated.jsonl", "labels/cohort8-li-2026-10-06-labels-adjudicated.jsonl",
          "labels/cohort8-mix-2026-10-08-labels-adjudicated.jsonl"]
RUN = "suggest/cohort8-combined-panel-mix"
SEED = 20261009
VETO = (0.5, 0.8, 0.95)


def oof(X: pd.DataFrame, y: np.ndarray, groups: np.ndarray, train_mask: np.ndarray, shuffle: bool) -> np.ndarray:
    """Out-of-fold P(H) for every row. Only ``train_mask`` rows are trained on; with ``shuffle`` their labels
    are permuted inside each training fold (the registered control)."""
    p = np.full(len(X), np.nan)
    rng = np.random.default_rng(SEED)
    for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
        tr = tr[train_mask[tr]]
        yt = rng.permutation(y[tr]) if shuffle else y[tr]
        m = HistGradientBoostingClassifier(random_state=SEED, categorical_features="from_dtype").fit(X.iloc[tr], yt)
        p[te] = m.predict_proba(X.iloc[te])[:, 1]
    return p


def main(data: Path, experiment: Path, result: Path) -> None:
    sys.path.insert(0, str(experiment))
    from labels.certify import fp_max

    result.mkdir(parents=True, exist_ok=True)
    rows = {}
    for f in LABELS:
        for r in map(json.loads, open(data / f)):
            rows[r["id"]] = r
    sidecars = [s for f in sorted(glob.glob(str(data / RUN / "*/sidecar.json"))) for s in [json.load(open(f))]
                if s["document"] not in DROP]
    side = {c["card_id"]: c for s in sidecars for c in s["cards"]}
    cards_total = len(side)
    host = {m["id"]: host_of(m["url"]) for m in json.load(open(data / "cohort8/refetch-manifest.json"))}

    # Instrument check 1: the baseline, exactly as cert_fit.py reads it.
    decided = [c for c in side.values() if c["score"] is not None and c["score"] >= T]
    truth = {i: r["label"]["heading"] for i, r in rows.items()}
    errors = sorted(c["card_id"] for c in decided if (c["type"] == "H") != truth[c["card_id"]])
    want = sorted(json.load(open(data / "suggest/cert-fit-2026-10-09.json"))["bar"]["error_ids"])
    baseline = {"cards": cards_total, "decided": len(decided), "errors": len(errors), "ids_match": errors == want}

    cards = [c for c in map(json.loads, open(data / RUN / "all-cards.jsonl")) if c["id"] in side]
    by_doc, by_page = collections.defaultdict(list), collections.defaultdict(list)
    for c in cards:
        by_doc[c["document_id"]].append(c)
        by_page[(c["document_id"], c["page"])].append(c)
    feats = []
    for c in cards:
        doc_fonts = [x["font_pt"] for x in by_doc[c["document_id"]] if x.get("font_pt") is not None]
        page = by_page[(c["document_id"], c["page"])]
        feats.append(features(c, doc_fonts, [x["y0"] for x in page], [x["x0"] for x in page]))
    X = pd.DataFrame(feats)
    for k in CATEGORICAL:
        X[k] = X[k].astype("category")
    for k in X.columns:
        if X[k].dtype == bool:
            X[k] = X[k].astype(int)
    ids = [c["id"] for c in cards]
    labelled = np.array([i in rows for i in ids])
    y = np.array([bool(rows[i]["label"]["heading"]) if i in rows else False for i in ids], dtype=int)
    train_mask = np.array([i in rows and rows[i]["type"] != "Unsure" for i in ids])
    groups = np.array([host[c["document_id"]] for c in cards])

    # Instrument check 2: the shuffled control.
    p_ctrl = oof(X, y, groups, train_mask, shuffle=True)
    auc_ctrl = roc_auc_score(y[labelled], p_ctrl[labelled])
    checks = {"baseline": baseline, "control_auc": auc_ctrl,
              "passed": baseline == {"cards": cards_total, "decided": 8893, "errors": 48, "ids_match": True}
              and auc_ctrl <= 0.55 and len(cards) == cards_total,  # amendment 1: one-sided
              "hosts": len(set(groups)), "documents": len(by_doc), "trained_rows": int(train_mask.sum()), "feature_cards": len(cards)}
    print(json.dumps(checks), flush=True)
    if not checks["passed"]:
        json.dump({"checks": checks}, open(result / "results.json", "w"), indent=1)
        sys.exit("instrument checks failed; nothing read")

    p = oof(X, y, groups, train_mask, shuffle=False)
    p_of = dict(zip(ids, p))
    lab = labelled
    summary = {"oof_auc": roc_auc_score(y[lab], p[lab]), "oof_accuracy": float(((p[lab] >= 0.5) == y[lab]).mean())}
    dec_rows = [{"id": c["card_id"], "said_h": c["type"] == "H", "truth": bool(truth[c["card_id"]]),
                 "p_h": float(p_of[c["card_id"]]), "by": c["decided_by"], "doc": c["card_id"].split(":")[0]}
                for c in decided]
    reads = []
    for cv in VETO:
        r = vetoed_read(dec_rows, cv, cards_total)
        r["fp_max"] = fp_max(r["negatives"])
        r["passes"] = r["errors"] <= r["bar_errors"] and r["coverage"] >= 0.857 and r["fp"] <= r["fp_max"]
        reads.append(r)
    out = {"checks": checks, "summary": summary, "reads": reads,
           "success": any(r["passes"] for r in reads),
           "kill": all(r["caught"] < 18 for r in reads)}
    json.dump(out, open(result / "results.json", "w"), indent=1)
    with open(result / "decided-oof.jsonl", "w") as f:
        for r in dec_rows:
            f.write(json.dumps(r) + "\n")
    print(json.dumps({k: v for k, v in out.items() if k != "checks"}, indent=1))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
