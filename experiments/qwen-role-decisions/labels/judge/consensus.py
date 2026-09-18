"""Cross-reference the blind judges: calibrate each against audit-s2wild, then build consensus labels.

usage: python3 consensus.py [--judges a,b,c] [--min-agree 3] [--min-calib 0.90] [--no-calib] [--source rows.jsonl] [--outdir DIR] [--outfile FILE] [--write]
Reads judge/out/<judge>/chunk-XX.jsonl for judges low, medium, high, fable.
"""
import os, sys
from pathlib import Path
R = str(Path(__file__).resolve().parents[2])  # experiments/qwen-role-decisions
SP = str(Path(R) / "out" / "labels" / "s2wild-judges-r3")  # judge work dir (gitignored out/)
import json, glob, os, sys, collections, uuid, datetime


JUDGES = sys.argv[sys.argv.index("--judges") + 1].split(",") if "--judges" in sys.argv else ["low", "medium", "high", "fable"]
MIN_AGREE = int(sys.argv[sys.argv.index("--min-agree") + 1]) if "--min-agree" in sys.argv else 3
MIN_CALIB = float(sys.argv[sys.argv.index("--min-calib") + 1]) if "--min-calib" in sys.argv else 0.90
WRITE = "--write" in sys.argv
NO_CALIB = "--no-calib" in sys.argv  # when the audit rows refer to older card text
SRC = sys.argv[sys.argv.index("--source") + 1] if "--source" in sys.argv else f"{R}/out/labels/s2wild-all-source.jsonl"
OUTDIR = sys.argv[sys.argv.index("--outdir") + 1] if "--outdir" in sys.argv else f"{SP}/out"
OUTFILE = sys.argv[sys.argv.index("--outfile") + 1] if "--outfile" in sys.argv else f"{R}/out/labels/s2wild-consensus.jsonl"

src = {json.loads(l)["id"]: json.loads(l) for l in open(SRC)}
audit = {json.loads(l)["id"]: json.loads(l) for l in open(f"{R}/out/labels/audit-s2wild-claude.jsonl")}
audit = {i: a for i, a in audit.items() if not a["unsure"]}

votes = collections.defaultdict(dict)  # id -> judge -> row
for j in JUDGES:
    for f in glob.glob(f"{OUTDIR}/{j}/chunk-*.jsonl"):
        for l in open(f):
            if l.strip():
                r = json.loads(l)
                if r.get("id") in src:
                    votes[r["id"]][j] = r

# calibration on the audited 222 (heading bit)
calib = {}
for j in JUDGES:
    n = ok = 0
    for i, a in audit.items():
        v = votes.get(i, {}).get(j)
        if v and v["type"] != "Unsure":
            n += 1; ok += (v["type"] == "H") == a["label"]["heading"]
    calib[j] = (ok / n if n else None, n)
print("calibration vs audit-s2wild (heading bit):", {j: (round(c[0], 3) if c[0] is not None else None, c[1]) for j, c in calib.items()})
active = JUDGES[:] if NO_CALIB else [j for j in JUDGES if calib[j][0] is None or calib[j][0] >= MIN_CALIB]
dropped = [j for j in JUDGES if j not in active]
print("active judges:", active, "dropped:", dropped)

rows = []; nocons = []; stats = collections.Counter(); pair = collections.Counter(); pair_n = collections.Counter()
for i in src:
    vs = {j: votes[i][j] for j in active if j in votes[i] and votes[i][j]["type"] != "Unsure"}
    stats["judged_any"] += bool(votes[i])
    if len(vs) < MIN_AGREE:
        stats["insufficient_votes"] += 1
        nocons.append({"id": i, "type": None, "label": None, "votes": {"judges": len(vs), "agree": 0, "by": {j: v["type"] for j, v in vs.items()}}, "note": "insufficient votes"}); continue
    hbits = collections.Counter((v["type"] == "H") for v in vs.values())
    hbit, n_agree = hbits.most_common(1)[0]
    if n_agree < MIN_AGREE:
        stats["no_consensus_heading"] += 1
        nocons.append({"id": i, "type": None, "label": None, "votes": {"judges": len(vs), "agree": n_agree, "by": {j: v["type"] for j, v in vs.items()}}, "note": "no consensus on heading bit"}); continue
    agreeing = [v for v in vs.values() if (v["type"] == "H") == hbit]
    typ = collections.Counter(v["type"] for v in agreeing).most_common(1)[0][0]
    level = None
    if hbit:
        lv = collections.Counter(v.get("level") for v in agreeing if v.get("level"))
        level = lv.most_common(1)[0][0] if lv else None
    stats["consensus"] += 1; stats[f"agree_{n_agree}_of_{len(vs)}"] += 1
    rows.append({"id": i, "answer_id": str(uuid.uuid4()), "actor": "consensus-4judge", "label_source": "claude-consensus",
                 "type": typ, "unsure": False, "label": {"heading": bool(hbit), "level": level},
                 "votes": {"judges": len(vs), "agree": n_agree, "by": {j: v["type"] for j, v in vs.items()}},
                 "note": "", "labelled_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
    for a in active:
        for b in active:
            if a < b and a in vs and b in vs:
                pair_n[(a, b)] += 1; pair[(a, b)] += (vs[a]["type"] == "H") == (vs[b]["type"] == "H")
print("stats:", dict(stats))
print("pairwise heading-bit agreement:", {f"{a}-{b}": round(pair[(a, b)] / pair_n[(a, b)], 3) for (a, b) in pair_n})
print("consensus H share:", round(sum(r["label"]["heading"] for r in rows) / max(1, len(rows)), 3), "types:", dict(collections.Counter(r["type"] for r in rows)))
# consensus vs my audit on the overlap
ov = [r for r in rows if r["id"] in audit]
if ov:
    print("consensus vs audit-s2wild overlap:", len(ov), "heading-bit agreement", round(sum(r["label"]["heading"] == audit[r["id"]]["label"]["heading"] for r in ov) / len(ov), 3))
if WRITE:
    with open(OUTFILE, "w") as f:
        for r in rows + nocons: f.write(json.dumps(r) + "\n")
    print("wrote", len(rows), "consensus rows +", len(nocons), "label:null rows to", OUTFILE)
