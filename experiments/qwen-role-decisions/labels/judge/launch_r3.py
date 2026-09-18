"""Print the next (chunk, judge) pairs to launch for round 3, given launched-r3.txt and a cap on running agents.
usage: python3 launch_r3.py <n_free>"""
import os, sys
from pathlib import Path
R = str(Path(__file__).resolve().parents[2])  # experiments/qwen-role-decisions
SP = str(Path(R) / "out" / "labels" / "s2wild-judges-r3")  # judge work dir (gitignored out/)
import os,sys,glob

n_free=int(sys.argv[1]); chunks=sorted(os.path.basename(p)[6:8] for p in glob.glob(f"{SP}/chunks-r3/chunk-*.json"))
launched=set()
if os.path.exists(f"{SP}/launched-r3.txt"):
    for l in open(f"{SP}/launched-r3.txt"):
        p=l.split()
        if p: launched|={(p[0],j) for j in p[1:]}
todo=[(c,j) for c in chunks for j in ("low","medium","high","fable") if (c,j) not in launched]
print("remaining",len(todo)); print(" ".join(f"{c}:{j}" for c,j in todo[:n_free]))
