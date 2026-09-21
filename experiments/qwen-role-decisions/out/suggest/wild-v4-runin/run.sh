#!/bin/zsh
# Stage 2 run-in split, wild re-measurement: the wild-v2/wild-r3 configuration plus the
# validation-frozen --split-run-in-heads 0.5 (record a0588cd), on the 11 wild documents where
# the dry run fires. The other 19 documents are byte-identical by construction.
cd "/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor/experiments/qwen-role-decisions"
R=out/suggest/wild-v4-runin
for s in c3-0252 c3-0489 c3-0268 c3-0299 c3-0507 c3-0755 c3-0794 c3-0094 c3-0128 c3-0178 c3-0650; do
  t0=$(date +%s)
  python3 -B -m labels.suggest --pdf out/cohort3/real/$s.pdf --adapter out/stage1/adapter-r10 --threshold 0.9933 --all-blocks --split-enumerated-heads --split-run-in-heads 0.5 --python ~/.venvs/qwen-role-decisions/bin/python --out $R/$s/sidecar.json > $R/$s.log 2>&1
  rc=$?
  echo "$s rc=$rc seconds=$(( $(date +%s) - t0 ))" >> $R/timings.txt
done
echo DONE >> $R/timings.txt
