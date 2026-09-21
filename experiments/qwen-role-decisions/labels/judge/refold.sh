#!/usr/bin/env bash
# Re-fold and re-evaluate the wild gate with the run-in split (width 0.5) swapped in.
# Run from experiments/qwen-role-decisions (bash or zsh). Inputs, all under out/ (gitignored;
# on the data branch kimi-data-run-in-2026-09-21): the per-round *-changed.json and
# *-replacements.jsonl in out/labels/s2wild-judges-runin/ (the 53 judged rows from
# s2wild-runin-consensus.jsonl plus null rows for the 23 uncovered changed cards),
# and out/labels/s2wild-{v2,r3}-source-runin.jsonl. It builds a sidecar view per round in
# which the 11 fired documents point at out/suggest/wild-v4-runin. Writes to $OUT only.
set -e
J=out/labels/s2wild-judges-runin
OUT="${OUT:-/tmp/runin-refold}"
mkdir -p "$OUT"
for r in v2 r3; do
  if [ $r = v2 ]; then SC=out/suggest/wild-v2; C=out/labels/s2wild-consensus-v2-final.jsonl
  else SC=out/suggest/wild-r3; C=out/labels/s2wild-r3-consensus-final.jsonl; fi
  mkdir -p "$OUT/sc-$r"
  for d in $SC/c3-*/; do
    d=${d%/}; s=$(basename "$d")
    if [ -f out/suggest/wild-v4-runin/$s/sidecar.json ]; then ln -sfn "$PWD/out/suggest/wild-v4-runin/$s" "$OUT/sc-$r/$s"
    else ln -sfn "$PWD/$d" "$OUT/sc-$r/$s"; fi
  done
  python3 -B labels/judge/v2_patch.py $J/$r-changed.json $J/$r-replacements.jsonl $C "$OUT/$r-consensus.jsonl"
  python3 -B -m labels.fold_wild --consensus "$OUT/$r-consensus.jsonl" --sidecars "$OUT/sc-$r" \
    --names labels/cohort3-names.txt --pdfs out/cohort3/real --source out/labels/s2wild-$r-source-runin.jsonl \
    --out-labels "$OUT/$r-labels.jsonl" --out-predictions "$OUT/$r-pred.jsonl" --out-cards "$OUT/$r-cards.jsonl"
done
cat "$OUT/v2-labels.jsonl" "$OUT/r3-labels.jsonl" > "$OUT/23-labels.jsonl"
cat "$OUT/v2-pred.jsonl" "$OUT/r3-pred.jsonl" > "$OUT/23-pred.jsonl"
cat "$OUT/v2-cards.jsonl" "$OUT/r3-cards.jsonl" > "$OUT/23-cards.jsonl"
python3 -B -m labels.eval_wild --labels "$OUT/23-labels.jsonl" --predictions "$OUT/23-pred.jsonl" --cards "$OUT/23-cards.jsonl" > "$OUT/eval.txt"
grep -c . "$OUT/23-labels.jsonl"
