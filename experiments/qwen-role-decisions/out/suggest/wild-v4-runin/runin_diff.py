"""Old (wild-v2 / wild-r3) vs new (wild-v4-runin) sidecars for the run-in split re-measurement.

Run from experiments/qwen-role-decisions. Writes changed.json in the v2_prep.py shape
({stem: {"new": [...], "changed": [...]}}) plus a summary with the judge bill.
"""
import json, pathlib, sys

NEW = pathlib.Path("out/suggest/wild-v4-runin")
THRESHOLD = 0.9933


def cards_of(work: pathlib.Path) -> dict:
    return {c["id"]: c for c in map(json.loads, filter(str.strip, (work / "cards.jsonl").read_text().splitlines()))}


def sidecar_of(work: pathlib.Path) -> dict:
    return {c["card_id"]: c for c in json.loads((work / "sidecar.json").read_text())["cards"]}


def old_work(stem: str) -> pathlib.Path:
    for run in ("wild-r3", "wild-v2"):  # the run each document's labels were folded from
        p = pathlib.Path("out/suggest") / run / stem
        if (p / "sidecar.json").exists():
            return p
    raise FileNotFoundError(stem)


out, summary, totals = {}, {}, dict.fromkeys(
    ("docs", "cards_old", "cards_new", "new_heads", "changed_bodies", "removed", "context_changed",
     "context_changed_decision_flip", "must_judge", "must_judge_covered"), 0)
for sc in sorted(NEW.glob("*/sidecar.json")):
    stem = sc.parent.name
    ow, nw = old_work(stem), sc.parent
    oc, nc = cards_of(ow), cards_of(nw)
    os_, ns = sidecar_of(ow), sidecar_of(nw)
    new_ids = sorted(set(nc) - set(oc))
    removed = sorted(set(oc) - set(nc))
    common = sorted(set(oc) & set(nc))
    changed = [i for i in common if oc[i]["text"] != nc[i]["text"]]
    ctx = [i for i in common if i not in changed and (oc[i].get("prev"), oc[i].get("next")) != (nc[i].get("prev"), nc[i].get("next"))]
    def decision(s, i):
        c = s.get(i) or {}
        return (c.get("type"), (c.get("score") or 0) >= THRESHOLD)
    flips = [i for i in ctx if decision(os_, i) != decision(ns, i)]
    must = new_ids + changed
    covered = [i for i in must if (ns.get(i, {}).get("score") or 0) >= THRESHOLD]
    out[stem] = {"new": new_ids, "changed": changed}
    summary[stem] = {"old_run": ow.parent.name, "new_heads": len(new_ids), "changed_bodies": len(changed),
                     "removed": removed, "context_changed": len(ctx), "context_changed_decision_flip": flips,
                     "must_judge": len(must), "must_judge_covered": len(covered)}
    for k, v in (("docs", 1), ("cards_old", len(oc)), ("cards_new", len(nc)), ("new_heads", len(new_ids)),
                 ("changed_bodies", len(changed)), ("removed", len(removed)), ("context_changed", len(ctx)),
                 ("context_changed_decision_flip", len(flips)), ("must_judge", len(must)), ("must_judge_covered", len(covered))):
        totals[k] += v
(NEW / "changed.json").write_text(json.dumps(out, indent=1) + "\n")
(NEW / "diff-summary.json").write_text(json.dumps({"totals": totals, "per_document": summary}, indent=1) + "\n")
print(json.dumps(totals, indent=1))
for s, v in summary.items():
    print(s, {k: v[k] for k in ("old_run", "new_heads", "changed_bodies", "context_changed", "must_judge_covered")},
          "removed" if v["removed"] else "", v["removed"] or "", "flips" if v["context_changed_decision_flip"] else "", v["context_changed_decision_flip"] or "")
