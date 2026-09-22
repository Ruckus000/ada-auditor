"""Page-sheet bias re-judge: the registered verdict, then the reported numbers.

Registration: docs/superpowers/plans/2026-09-22-wild-sheet-bias-rejudge-registration.md
(approved with amendments, 00362bd). Run from experiments/qwen-role-decisions after
every chunk has a complete judge file.

1. Model-blind verdict. g = sheet H -> re-judge non-H, r = sheet non-H -> re-judge H,
   over all 565 rows, from the two label sets alone. CONFIRMED iff g - r >= 4,
   REFUTED iff |g - r| <= 2, INCONCLUSIVE otherwise. No prediction file is opened
   before the verdict is fixed.
2. Reported, never used for the verdict: Unsure count and f9 (of the 9 sheet-round
   covered FN, how many re-judge to non-H).

Writes the re-judge label file (label source opus-quick-card-rejudge) whatever the
verdict; only a CONFIRMED verdict lets it replace the sheet labels.
"""
import datetime, json, sys, uuid
from pathlib import Path

J = Path("out/labels/s2wild-cardrejudge")
IDS = Path("out/labels/s2wild-r3-sheet-round-ids.json")
SHEET = Path("out/labels/s2wild-r3-consensus-final.jsonl")
OUT = Path("out/labels/s2wild-r3-cardrejudge-folds.jsonl")

ids = json.loads(IDS.read_text())
assert len(ids) == 565, len(ids)
chunks = sorted((J / "chunks").glob("chunk-*.json"))
judged = {}
for c in chunks:
    want = [r["id"] for r in json.loads(c.read_text())]
    f = J / "out" / "opus-quick" / (c.stem + ".jsonl")
    rows = [json.loads(l) for l in f.read_text().splitlines() if l.strip()]
    got = [r["id"] for r in rows]
    if sorted(got) != sorted(want) or len(got) != len(want):
        raise SystemExit(f"{f}: incomplete or foreign lines ({len(got)} vs {len(want)}); discard and re-run")
    judged.update({r["id"]: r for r in rows})
assert set(judged) == set(ids), "judged ids differ from the population"

sheet = {r["id"]: r for r in map(json.loads, SHEET.read_text().splitlines()) if r.get("id") in judged}
unsure = [i for i in ids if judged[i]["type"] == "Unsure"]
g = sum(1 for i in ids if i not in unsure and sheet[i]["label"]["heading"] and judged[i]["type"] != "H")
r = sum(1 for i in ids if i not in unsure and not sheet[i]["label"]["heading"] and judged[i]["type"] == "H")
d = g - r
verdict = "CONFIRMED" if d >= 4 else "REFUTED" if abs(d) <= 2 else "INCONCLUSIVE"
print(json.dumps({"population": len(ids), "unsure": len(unsure), "g": g, "r": r, "g_minus_r": d, "verdict": verdict}))

now = datetime.datetime.now(datetime.timezone.utc).isoformat()
with OUT.open("x") as f:  # never overwrite
    for i in ids:
        if i in unsure:
            f.write(json.dumps(sheet[i]) + "\n")  # registered: Unsure keeps the sheet label
            continue
        v = judged[i]; h = v["type"] == "H"
        f.write(json.dumps({"id": i, "answer_id": str(uuid.uuid4()), "actor": "opus-quick-card",
                            "label_source": "opus-quick-card-rejudge", "type": v["type"], "unsure": False,
                            "label": {"heading": h, "level": v.get("level") if h else None},
                            "votes": {"judges": 1, "agree": 1, "by": {"opus-quick": v["type"]}},
                            "note": "", "labelled_at": now}) + "\n")
print("wrote", OUT)

if len(sys.argv) > 1:  # reported only, after the verdict: f9 against the given fold
    labels, preds = sys.argv[1], sys.argv[2]
    L = {x["id"]: x for x in map(json.loads, open(labels))}
    fn = []
    for p in map(json.loads, open(preds)):
        if (p.get("score") or 0) < 0.9933 or p["id"] not in L or p["id"] not in judged:
            continue
        t = json.loads(p["raw"]).get("type") if p["raw"] else None
        if L[p["id"]]["label"]["heading"] and t != "H":
            fn.append(p["id"])
    f9 = sum(1 for i in fn if judged[i]["type"] not in ("H", "Unsure"))
    print(json.dumps({"sheet_round_covered_fn": len(fn), "f9": f9}))
