# Stage 2 — finish the wild gate at 99%: a harness-agnostic runbook

This runbook is written so that any capable coding agent (it was written for **Kimi K3**) can execute it from a shell in the repository, without this project's Claude-specific sessions, subagents or cross-session messaging. Everything it needs is a file path or a command. Read the whole thing before running anything.

## 0. What is true now (2026-09-18)

- Model under test: `out/stage1/adapter-r10` (Qwen3.5-4B-MLX LoRA), operating threshold **0.9933** (registered on validation; never re-derived on wild data).
- Labels for the wild population are **four-judge Claude-consensus labels** (`label_source: claude-consensus`). Every number graded against them must say so.
- Gate (user decision 2026-09-18): **accuracy exact 95 % lower bound ≥ 0.99 and FP upper bound ≤ 0.01 on cards covered at 0.9933**, on the combined wild population. **Abstention is reported as the product's ask-rate, not gated.**
- State: rounds 1–3 labelled 2,273 cards over 30 documents. At 0.9933: raw accuracy 0.9903 [0.9848–0.9941], FP 0 (UB 0.0020), abstention 0.142; net of the 20 "convention-conflict" rows 0.9932 [0.9892–0.9968]. Round 3 has **680 unjudged cards** (the session limit halted judging; every partial judge file was deleted because one killed judge fabricated rows).
- Where things live (codex checkout `/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor`, branch `claude/heading-labelling-pass`, all paths below relative to `experiments/qwen-role-decisions/`):
  - sidecars and cards: `out/suggest/wild-v2/<stem>/{sidecar.json,cards.jsonl,pages/marked-408/*.png}` (round 2, 10 docs) and `out/suggest/wild-r3/…` (round 3, 20 docs; `population.json` holds the registered draw and the 10 extension ids).
  - labels: `out/labels/s2wild-consensus-v2.jsonl` (round 2, 1,246 rows), `out/labels/s2wild-r3-consensus.jsonl` (round 3, 1,040 labelled + 680 `label: null`), source rows `out/labels/s2wild-r3-source.jsonl`.
  - judge tooling (this commit): `labels/judge/PROTOCOL.md`, `labels/judge/consensus.py`, `labels/judge/r3_prep.py`, `labels/judge/v2_prep.py`, `labels/judge/v2_patch.py`, `labels/judge/launch_r3.py`. Work directory for judging is `out/labels/s2wild-judges-r3/` (gitignored). Provenance of rounds 1–3 judging: `out/labels/s2wild-judges*/`.
  - evaluation tooling: `labels/fold_wild.py`, `labels/eval_wild.py`, `eligibility_eval.py split`.
  - record: `docs/research/document-remediation/heading-stage2-2026-09-18-results.md` (repo root).

## 1. Non-negotiables

- Labels are never written or edited by hand. A label exists only when the judge protocol produced it.
- The Qwen model's output is never a label. Judges never see predictions, other judges' files, or existing labels.
- The test split is never evaluated. New wild ids go to validation by host with `--keep`; the split refuses if a kept id moves.
- **Never merge a judge file from a run that did not finish.** A run is finished only when it wrote every card of its chunk and ended with the line `done <chunk> <count>`, and `wc -l` equals the chunk length. Delete anything else.
- Every reported number carries "graded against Claude-consensus labels" (or, if a non-Claude judge takes a seat, "graded against consensus labels, judges: <models>").

## 2. Judge protocol v3 (two seats + tie-break)

Protocol text for judges: `labels/judge/PROTOCOL.md` (this is v2: enumerator-only card = `Lbl`; a head card split from a list item is judged on its own line). v3 changes only who votes:

- **Seat 1** and **Seat 2** judge every card, blind, in separate fresh contexts. If they agree on the heading bit (H vs not-H), that is the label; type by agreement, level from seat 1 when levels differ.
- Cards where the two seats **disagree on the heading bit** go to a **tie-break seat** (fresh context, same protocol). Label = the 2-of-3 majority. If all three differ on type but agree on the heading bit, the heading bit stands and the type is the majority or seat 1's.
- No consensus (all three heading bits differ is impossible with a binary bit; a card with fewer than two valid votes after `Unsure` votes are dropped) → `label: null`, counted.
- `consensus.py --judges seat1,seat2,tiebreak --min-agree 2 --no-calib` implements this: a card with two agreeing votes is consensus; the tie-break file only needs rows for the disagreeing ids.

**Judge run = one fresh agent context per chunk**, given exactly: the protocol file path, the chunk file path, the output path, and the instruction "Work quickly: one look per image, decide, move on. Reply only with the final `done` line." Nothing else in context. Use whatever your harness calls a fresh session/thread/subtask; do not reuse a context across chunks.

## 3. Step 0 — choose the smallest adequate judge model (one chunk per candidate)

Registered decision rule, fixed before any run: a candidate's **heading-bit agreement with the existing four-judge consensus on chunk 00** (62 cards, all four seats present) decides its role: **≥ 0.99 → full seat; 0.973–0.99 → tie-break seat only; < 0.973 → not used.** (0.973 is the weakest judge already used, Sonnet; Opus-quick scored 0.998, Fable-quick 0.992.)

Candidates, cheapest first: **Kimi K3** (only if it reads images), **Claude Haiku 4.5**, then Claude Opus (quick) and Claude Fable (quick) as the known-adequate fallbacks. Run each candidate once:

```bash
cd experiments/qwen-role-decisions
mkdir -p out/labels/s2wild-judges-r3/calib/<candidate>
# judge run: PROTOCOL = labels/judge/PROTOCOL.md, CHUNK = out/labels/s2wild-judges-r3/chunks/chunk-00.json,
#            OUT = out/labels/s2wild-judges-r3/calib/<candidate>/chunk-00.jsonl
```

(The round-3 chunk files are not in git; rebuild them first with `python3 labels/judge/r3_prep.py --chunks-dir out/labels/s2wild-judges-r3/chunks` — it is deterministic, seed 20260919, and reproduces chunk 00.)

Score:

```bash
python3 - <<'EOF'
import json
cons={json.loads(l)["id"]:json.loads(l) for l in open("out/labels/s2wild-r3-consensus.jsonl")}
cons={k:v for k,v in cons.items() if v["label"] and v["votes"]["judges"]==4}
n=ok=0
for l in open("out/labels/s2wild-judges-r3/calib/<candidate>/chunk-00.jsonl"):
    r=json.loads(l); c=cons.get(r["id"])
    if c and r["type"]!="Unsure": n+=1; ok+=((r["type"]=="H")==c["label"]["heading"])
print("<candidate> heading-bit agreement", round(ok/n,4), "n", n)
EOF
```

Record every candidate's number in the Stage 2 record whether or not it is used. Seats: seat 1 = the best-scoring adequate model (expected Opus-quick), seat 2 = the cheapest full-seat model, tie-break = the cheapest adequate model not already seated.

## 4. Step 1 — re-judge the 20 convention-conflict cards

These 20 round-2 cards are bare enumerators ("I.", "A.") labelled H under protocol v1; v2 says `Lbl`. Re-judge them under v3 so the raw view is honest (v1 rows stay in provenance, nothing edited by hand):

```
c3-0794:2 c3-0794:60 c3-0128:196 c3-0794:7 c3-0094:55 c3-0794:12 c3-0794:97 c3-0128:4 c3-0094:58 c3-0128:119
c3-0794:42 c3-0128:7 c3-0094:60 c3-0794:70 c3-0128:29 c3-0794:10 c3-0128:10 c3-0128:39 c3-0128:188 c3-0128:181
```

```bash
cd experiments/qwen-role-decisions
python3 - <<'EOF'
import json; ids="c3-0794:2 c3-0794:60 c3-0128:196 c3-0794:7 c3-0094:55 c3-0794:12 c3-0794:97 c3-0128:4 c3-0094:58 c3-0128:119 c3-0794:42 c3-0128:7 c3-0094:60 c3-0794:70 c3-0128:29 c3-0794:10 c3-0128:10 c3-0128:39 c3-0128:188 c3-0128:181".split()
json.dump({"round2":{"changed":ids}}, open("out/labels/s2wild-conflict-ids.json","w"))
EOF
python3 labels/judge/v2_prep.py out/labels/s2wild-conflict-ids.json out/suggest/wild-v2   # -> out/labels/s2wild-v2-source.jsonl and chunks-v2/chunk-00.json under the work dir
# judge runs: seat1, seat2 (and tie-break on disagreements) -> out/labels/s2wild-judges-r3/out-conflict/<seat>/chunk-00.jsonl
python3 labels/judge/consensus.py --judges seat1,seat2,tiebreak --min-agree 2 --no-calib \
  --source out/labels/s2wild-v2-source.jsonl --outdir out/labels/s2wild-judges-r3/out-conflict \
  --outfile out/labels/s2wild-v2-consensus.jsonl --write
python3 labels/judge/v2_patch.py out/labels/s2wild-conflict-ids.json   # rewrites out/labels/s2wild-consensus-v2.jsonl: 20 rows replaced by id, all others byte-identical
```

`v2_prep.py` expects the changed-id file's values to be lists of ids (any nesting); `v2_patch.py` asserts the new consensus covers exactly those ids and nothing else.

## 5. Step 2 — finish round 3 on the covered cards only

Only cards covered at 0.9933 enter the gate, so only they are judged (abstention needs no labels). 566 of the 680 unjudged cards are covered → 10 chunks of 62, without `prev`/`next` (the image is the evidence).

```bash
cd experiments/qwen-role-decisions
python3 - <<'EOF'
import json,glob
pred={c["card_id"]:c for f in glob.glob("out/suggest/wild-r3/*/sidecar.json") for c in json.load(open(f))["cards"]}
cons={json.loads(l)["id"]:json.loads(l) for l in open("out/labels/s2wild-r3-consensus.jsonl")}
ids=[i for i,c in cons.items() if not c["label"] and pred[i]["score"]>=0.9933]
json.dump(ids, open("out/labels/s2wild-r3-remaining-ids.json","w")); print(len(ids))   # expect 566
EOF
python3 labels/judge/r3_prep.py out/suggest/wild-r3 --only out/labels/s2wild-r3-remaining-ids.json --no-context \
  --chunks-dir out/labels/s2wild-judges-r3/chunks-remaining --source out/labels/s2wild-r3-remaining-source.jsonl
# judge runs, at most 10 concurrent: for each chunk-XX.json, seat1 -> out-remaining/seat1/chunk-XX.jsonl, seat2 -> out-remaining/seat2/chunk-XX.jsonl
# then one tie-break run per chunk over the disagreeing ids only (build a small chunk from them) -> out-remaining/tiebreak/chunk-XX.jsonl
python3 labels/judge/consensus.py --judges seat1,seat2,tiebreak --min-agree 2 --no-calib \
  --source out/labels/s2wild-r3-remaining-source.jsonl --outdir out/labels/s2wild-judges-r3/out-remaining \
  --outfile out/labels/s2wild-r3-remaining-consensus.jsonl --write
python3 - <<'EOF'
# merge: keep every round-3 row that already has a label; replace the null rows for the 566 ids with the new rows; the other 114 stay null (uncovered, unlabelled by design)
import json
new={json.loads(l)["id"]:l for l in open("out/labels/s2wild-r3-remaining-consensus.jsonl")}
rows=[l for l in open("out/labels/s2wild-r3-consensus.jsonl")]
out=[new.get(json.loads(l)["id"], l) if json.loads(l)["label"] is None else l for l in rows]
open("out/labels/s2wild-r3-consensus.jsonl","w").writelines(x if x.endswith("\n") else x+"\n" for x in out)
print("rows", len(out), "labelled", sum(json.loads(x)["label"] is not None for x in out))
EOF
```

Before merging, check every judge file: line count equals its chunk length, and the run ended with its `done` line. Copy all judge outputs and the protocol into `out/labels/s2wild-judges-r3/` (they already live there) for provenance.

## 6. Step 3 — fold, split, evaluate

```bash
cd experiments/qwen-role-decisions
# The round-2 fold reads a combined source: round-1 source rows for unchanged ids plus the 26 round-2 rows. It exists; rebuild only if missing:
python3 - <<'PY'
import json
v2={json.loads(l)["id"]:l for l in open("out/labels/s2wild-v2-source.jsonl")}
with open("out/labels/s2wild-v2-all-source.jsonl","w") as f:
    for l in open("out/labels/s2wild-all-source.jsonl"):
        i=json.loads(l)["id"]; f.write(v2.pop(i, l))
    f.writelines(v2.values())
PY
python3 -B -m labels.fold_wild --consensus out/labels/s2wild-consensus-v2.jsonl --sidecars out/suggest/wild-v2 --names labels/cohort3-names.txt --pdfs out/cohort3/real --source out/labels/s2wild-v2-all-source.jsonl --out-labels out/labels/wild-v2-labels.jsonl --out-predictions out/stage1/pred-wild-v2-r10.jsonl --out-cards out/labels/wild-v2-cards.jsonl
python3 -B -m labels.fold_wild --consensus out/labels/s2wild-r3-consensus.jsonl --sidecars out/suggest/wild-r3 --names labels/cohort3-names.txt --pdfs out/cohort3/real --source out/labels/s2wild-r3-source.jsonl --out-labels out/labels/wild-r3-labels.jsonl --out-predictions out/stage1/pred-wild-r3-r10.jsonl --out-cards out/labels/wild-r3-cards.jsonl
# Split: build on the round-2 split; never overwrite an existing split or labels file (they are provenance for recorded numbers).
cat out/labels/keys-all-4-plus-wild-v2.jsonl out/labels/wild-r3-labels.jsonl > out/labels/keys-all-4-plus-wild-final.jsonl
python3 -B eligibility_eval.py split --labels out/labels/keys-all-4-plus-wild-final.jsonl --salt s2wild-final-2026-09-18 --out out/keys-all-4-wild-final/split --keep out/keys-all-4-wild-v2/split/split.json --keep-labels out/labels/keys-all-4-plus-wild-v2.jsonl --assign-new validation
python3 -B -m labels.eval_wild --labels out/labels/wild-r3-labels.jsonl --predictions out/stage1/pred-wild-r3-r10.jsonl --cards out/labels/wild-r3-cards.jsonl > out/stage1/eval-wild-r3-r10.txt
cat out/labels/wild-v2-labels.jsonl out/labels/wild-r3-labels.jsonl > out/labels/wild-23-labels.jsonl; cat out/stage1/pred-wild-v2-r10.jsonl out/stage1/pred-wild-r3-r10.jsonl > out/stage1/pred-wild-23-r10.jsonl; cat out/labels/wild-v2-cards.jsonl out/labels/wild-r3-cards.jsonl > out/labels/wild-23-cards.jsonl
python3 -B -m labels.eval_wild --labels out/labels/wild-23-labels.jsonl --predictions out/stage1/pred-wild-23-r10.jsonl --cards out/labels/wild-23-cards.jsonl > out/stage1/eval-wild-23-r10.txt
```

Existing split directories `out/keys-all-4-wild`, `-wild-v2` and `-wild-r3` and the labels files they were built from are provenance: never overwrite them. The 20 re-judged conflict ids are already pinned to validation by the kept split, so nothing moves. Re-folding round 3 regenerates `wild-r3-labels.jsonl` in full (old 1,040 rows plus the new ones), which is why the chain above rebuilds from the round-2 labels file rather than appending.

The `coverage_curve` point `t: 0.9933` in `eval-wild-23-r10.txt` holds the gate numbers: `accuracy_ci[0]` (lower bound) and `fp_rate_ci[1]` (upper bound). `coverage` there is the reported ask-rate complement. If `fold_wild` refuses a row shape, read its message; it validates every consensus row (actor `consensus-4judge`, label source `claude-consensus`; if a non-Claude judge took a seat, add that actor/source to `LABEL_SOURCES` in `eligibility_eval.py` and to the fold's accepted values before folding, and disclose it).

**Gate check:** lower bound ≥ 0.99 and FP upper bound ≤ 0.01 → met; write the record (§8) and stop.

## 7. Step 4 — only if the lower bound is short by ≤ 0.005

Cheapest lever first, both registered before use:

- **4a. Generalise the split.** The largest remaining error class is a heading merged with its first paragraph by the auto-tagger with no enumerator. `labels/split_heads.py` splits only enumerated first lines. Extend: a `P`/`LI`/`H*` block with `line_count ≥ 2` whose first physical line is ≤ 6 words and ends before 60 % of the block width splits into head + body. `Cards.java` must emit `first_line_x1` beside `first_line` (same glyph walk that computes `first_line`; see `firstLineOf`). Test on validation first: training keys must stay byte-identical (`candidate_pool`/`document_cards` hashes unchanged, as in round 2). Re-run `labels.suggest --split-enumerated-heads` only on documents whose blocks change, diff the card ids (new `…h` heads and same-id shortened bodies, as `out/labels/s2wild-v2-changed.json` did for round 2), judge only the changed cards under v3, patch by id, re-run §6.
- **4b. Extension documents.** `out/suggest/wild-r3/population.json` → `extension` (10 ids). Run `labels.suggest` for each (see round-3 `timings.txt` for the command and ~2 s per card), judge only their covered cards under v3 (about 860 cards, 14 chunks), fold as a third wild set, re-run §6 on rounds 2+3+extension.
- Short by more than 0.005 after 4a: stop and report; do not spend more judging on it.

## 8. Step 5 — record

Add one section to `docs/research/document-remediation/heading-stage2-2026-09-18-results.md`: the judge-model calibration numbers and the seats chosen; protocol v3 and the tie-break count; the 20 re-judged conflict rows; "covered cards only" for round-3 completion with the 114 uncovered cards left unlabelled; the final views at 0.9933 (round 3 alone, rounds 2+3, plus extension if run) with exact bounds; abstention reported as ask-rate; the gate verdict per bar. Update the roadmap's Stage 2 line. Commit with the repository's trailer convention.

## 9. Token budget (judge runs)

| Step | seat 1 (Opus-class) | seat 2 (cheapest adequate) | tie-breaks |
|---|---|---|---|
| calibration | 0 | 1 per candidate | 0 |
| conflict cards | 1 | 1 | ≤ 1 |
| finish round 3 | 10 | 10 | ~1 total |
| extension (conditional) | ~14 | ~14 | ~1 |

Roughly 12 Opus-class runs to finish round 3, against 44 four-judge runs under the old protocol. Each 62-card quick run costs about 120k tokens on Claude models (62 images at ~414 tokens each plus overhead).
