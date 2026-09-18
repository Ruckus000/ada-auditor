"""Round 2 judging inputs: source rows + chunks for the changed cards only.
usage: python3 v2_prep.py <changed.json> [wild_v2_dir]
changed.json: {stem: {"new": [ids], "changed": [ids]}} (or {stem: [ids]})."""
import os, sys
from pathlib import Path
R = str(Path(__file__).resolve().parents[2])  # experiments/qwen-role-decisions
SP = str(Path(R) / "out" / "labels" / "s2wild-judges-r3")  # judge work dir (gitignored out/)
import json, os, sys, glob


changed=json.load(open(sys.argv[1])); wild=sys.argv[2] if len(sys.argv)>2 else f"{R}/out/suggest/wild-v2"
ids=[]
def walk(o):
    if isinstance(o,str) and o.startswith("c3-") and ":" in o: ids.append(o)
    elif isinstance(o,list): [walk(x) for x in o]
    elif isinstance(o,dict): [walk(v) for k,v in o.items() if k not in ("v1","v2","totals")]
walk(changed)
ids=list(dict.fromkeys(ids))
cards={}
for f in glob.glob(f"{wild}/*/cards.jsonl"):
    for l in open(f):
        if l.strip(): c=json.loads(l); cards[c["id"]]=c
rows=[]; missing=[]
for i in ids:
    c=cards.get(i)
    if not c or not os.path.exists(c.get("image","")): missing.append(i); continue
    rows.append({"id":i,"text":c["text"],"prev":c.get("prev"),"next":c.get("next"),"font_pt":c.get("font_pt"),"weight":c.get("weight"),
                 "page":c.get("page"),"repeats_on_pages":c.get("repeats_on_pages"),"in_table_box":c.get("in_table_box"),"image":c["image"]})
with open(f"{R}/out/labels/s2wild-v2-source.jsonl","w") as f:
    for r in rows: f.write(json.dumps(r)+"\n")
os.makedirs(f"{SP}/chunks-v2",exist_ok=True)
for k in range(0,len(rows),62):
    json.dump([{"n":n,**r} for n,r in enumerate(rows[k:k+62],start=k)],open(f"{SP}/chunks-v2/chunk-{k//62:02d}.json","w"))
print("rows",len(rows),"chunks",(len(rows)+61)//62,"missing",missing)
