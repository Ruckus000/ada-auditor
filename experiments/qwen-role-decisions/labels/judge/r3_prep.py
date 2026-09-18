"""Round 3 judging inputs: every card of every wild-r3 document -> s2wild-r3-source.jsonl + chunks-r3/chunk-XX.json (62 each).
usage: python3 r3_prep.py [wild_dir] [--only ids.json] [--no-context] [--chunks-dir DIR] [--source FILE]
--only: judge only these ids; --no-context: omit prev/next from rows (the image is the evidence)."""
import os, sys
from pathlib import Path
R = str(Path(__file__).resolve().parents[2])  # experiments/qwen-role-decisions
SP = str(Path(R) / "out" / "labels" / "s2wild-judges-r3")  # judge work dir (gitignored out/)
import json, os, sys, glob


args=[a for a in sys.argv[1:] if not a.startswith("--") and sys.argv[sys.argv.index(a)-1] not in ("--only","--chunks-dir","--source")]
wild=args[0] if args else f"{R}/out/suggest/wild-r3"
only=set(json.load(open(sys.argv[sys.argv.index("--only")+1]))) if "--only" in sys.argv else None
ctx="--no-context" not in sys.argv
chunks_dir=sys.argv[sys.argv.index("--chunks-dir")+1] if "--chunks-dir" in sys.argv else f"{SP}/chunks-r3"
source=sys.argv[sys.argv.index("--source")+1] if "--source" in sys.argv else f"{R}/out/labels/s2wild-r3-source.jsonl"
rows=[]; missing=[]; docs=0
for f in sorted(glob.glob(f"{wild}/*/cards.jsonl")):
    docs+=1
    for l in open(f):
        if not l.strip(): continue
        c=json.loads(l)
        if only is not None and c["id"] not in only: continue
        if not os.path.exists(c.get("image","")): missing.append(c["id"]); continue
        rows.append({"id":c["id"],"text":c["text"],**({"prev":c.get("prev"),"next":c.get("next")} if ctx else {}),"font_pt":c.get("font_pt"),"weight":c.get("weight"),
                     "page":c.get("page"),"repeats_on_pages":c.get("repeats_on_pages"),"in_table_box":c.get("in_table_box"),"image":c["image"]})
import random; random.Random(20260919).shuffle(rows)   # mix documents across chunks so no judge sees one document's whole ladder in order
with open(source,"w") as f:
    for r in rows: f.write(json.dumps(r)+"\n")
os.makedirs(chunks_dir,exist_ok=True)
for k in range(0,len(rows),62):
    json.dump([{"n":n,**r} for n,r in enumerate(rows[k:k+62],start=k)],open(f"{chunks_dir}/chunk-{k//62:02d}.json","w"))
print("docs",docs,"rows",len(rows),"chunks",(len(rows)+61)//62,"missing",len(missing),missing[:5])
