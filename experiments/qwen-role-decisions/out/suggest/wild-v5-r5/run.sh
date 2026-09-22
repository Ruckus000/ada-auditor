#!/bin/zsh
# R5 end-to-end check: the two wild documents where R5 overrides model H decisions, run
# through the product path (wild-v4-runin configuration + R5 now in labels.rules.decide),
# so the own-stack context effect the offline r5_rescore cannot see is measured.
cd "/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor/experiments/qwen-role-decisions"
R=out/suggest/wild-v5-r5
for s in c3-0094 c3-0128; do
  t0=$(date +%s)
  python3 -B -m labels.suggest --pdf out/cohort3/real/$s.pdf --adapter out/stage1/adapter-r10 --threshold 0.9933 --all-blocks --split-enumerated-heads --split-run-in-heads 0.5 --python ~/.venvs/qwen-role-decisions/bin/python --out $R/$s/sidecar.json > $R/$s.log 2>&1
  echo "$s rc=$? seconds=$(( $(date +%s) - t0 ))" >> $R/timings.txt
done
echo DONE >> $R/timings.txt
