"""Patch round-1 consensus by id: keep every unchanged row byte-identical, replace/add rows for changed ids.
usage: python3 v2_patch.py <changed.json>  -> out/labels/s2wild-consensus-v2.jsonl"""
import os, sys
from pathlib import Path
R = str(Path(__file__).resolve().parents[2])  # experiments/qwen-role-decisions
SP = str(Path(R) / "out" / "labels" / "s2wild-judges-r3")  # judge work dir (gitignored out/)
import json, sys

changed=json.load(open(sys.argv[1])); ids=set()
def walk(o):
    if isinstance(o,str) and ":" in o and o.startswith("c3-"): ids.add(o)
    elif isinstance(o,list): [walk(x) for x in o]
    elif isinstance(o,dict): [walk(v) for k,v in o.items() if k not in ("v1","v2","totals")]
walk(changed)
r1=[l for l in open(f"{R}/out/labels/s2wild-consensus.jsonl") if l.strip()]
v2={json.loads(l)["id"]:l for l in open(f"{R}/out/labels/s2wild-v2-consensus.jsonl") if l.strip()}
assert set(v2)==ids, (len(v2),len(ids), sorted(ids-set(v2))[:5], sorted(set(v2)-ids)[:5])
kept=[l for l in r1 if json.loads(l)["id"] not in ids]; replaced=len(r1)-len(kept); added=len(ids)-replaced
with open(f"{R}/out/labels/s2wild-consensus-v2.jsonl","w") as f:
    for l in kept: f.write(l if l.endswith("\n") else l+"\n")
    for i in sorted(ids): f.write(v2[i] if v2[i].endswith("\n") else v2[i]+"\n")
print("kept",len(kept),"replaced",replaced,"added",added,"total",len(kept)+len(ids))
