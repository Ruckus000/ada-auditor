# Stage 2 wild round 3 — grow the wild population so the accuracy lower bound can be measured

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put enough untagged, never-seen PDFs in front of adapter-r10 that the Stage 2 accuracy gate (Clopper-Pearson lower bound ≥ 0.99, the recorded method) is decidable on the wild population, using the round-2 card builder and the same four-judge Claude-consensus labelling.

**Architecture:** The gate is a lower bound, so it is a sample-size question as much as a model question: with the recorded Clopper-Pearson bound it needs ≥ 368 answered cards at 0 covered errors, 874 at 3, 1,164 at 5, 1,439 at 7. Round 1's ten documents give about 1,100 answered cards with six covered misses outside the fragment shape (one merged H3 block the split may fix, three genuine, two scanner noise), so no card-building fix can pass the bound on that population. The census (`out/suggest/wild/_census/census.json`) holds 91 unused text-bearing untagged cohort-3 PDFs (1–600 blocks, 43 hosts). This plan draws 20 of them by a fixed seed (1,969 blocks, 17 hosts, about 1.5 h of model time, about 128 judge runs), runs `labels.suggest` with `--split-enumerated-heads`, judges every card blind with the four judges under protocol v2, folds the consensus into validation by host, and re-measures the same views as rounds 1 and 2 over the combined 30 documents. A second prefix of 10 more documents is pre-registered as the extension if the bound lands within 0.005 of the gate.

**Tech Stack:** `labels/suggest.py` (round-2 flag), `labels/fold_wild.py`, `labels/eval_wild.py`, `eligibility_eval.py split --keep … --assign-new validation`, the coordinator's judge tooling (`judge/v2_prep.py`, `consensus.py`, protocol v2).

**Spec:** `heading-stage2-2026-09-18-results.md` (Task 8 wild result; the round-2 section once written), plan `2026-09-18-stage2-enumerated-heading-split.md`, memory `heading-loop-stage0-1-night` (projection and census sizes).

## Global Constraints

- **Draw registered before any document is run.** `random.Random(20260919).shuffle(sorted unused ids)`; the first 20 are round 3, ids 21–30 are the pre-registered extension. Write `out/suggest/wild-r3/population.json` with the rule and the ids before the first sidecar; no re-draw.
- **Labels never fabricated, never edited by hand; the Qwen output is never a label.** Every card gets four blind judges; consensus ≥ 3 of 4 on the heading bit; no-consensus cards are counted and excluded.
- **Judge protocol v2** (enumerator-only card = Lbl). Judges never see predictions, other judges, or labels.
- **Model and threshold unchanged:** `adapter-r10`, `0.9933`. **Test split never evaluated.** New ids go to validation by host with `--keep`; the split refuses if any new document's host already sits in another split (the census already excluded hosts in the split).
- **Every number disclosed as "graded against Claude-consensus labels".**
- Commit per task, `git add <paths>`, trailer `Co-Authored-By: <model> <noreply@anthropic.com>`.

**Cut (YAGNI):** OCR of the 151 image-only PDFs; the 19 documents over 600 blocks; retraining; any product change; a threshold re-derivation (if the abstention gate is the only failing bar after round 3, that is its own plan, derived on validation, never on wild).

---

### Task 1: Register the draw (implementing chat)

**Files:** create `out/suggest/wild-r3/population.json`

- [ ] **Step 1:** Run and commit nothing; the file lives under gitignored `out/`, so paste its contents into the record in Task 5.

```bash
cd experiments/qwen-role-decisions && python3 -B - <<'EOF'
import json, random
c = json.load(open("out/suggest/wild/_census/census.json"))
used = set(json.load(open("out/suggest/wild/population.json"))["ids"])
bt = lambda x: x.get("blocks_total") or 0
rest = sorted(x["id"] for x in c if 1 <= bt(x) <= 600 and x["id"] not in used)
random.Random(20260919).shuffle(rest)
json.dump({"rule": "random.Random(20260919).shuffle(sorted unused census ids with 1<=blocks_total<=600); round3 = first 20, extension = ids 21-30",
           "pool_size": len(rest), "ids": rest[:20], "extension": rest[20:30]},
          open("out/suggest/wild-r3/population.json", "w"), indent=1)
print(rest[:20], rest[20:30])
EOF
```

Expected: 91 in the pool; 20 ids; 10 extension ids; the draw printed once.

### Task 2: Sidecars for the 20 documents (implementing chat)

**Files:** create `out/suggest/wild-r3/<stem>/sidecar.json` × 20

- [ ] **Step 1:** For each id, in the registered order:

```bash
cd experiments/qwen-role-decisions && python3 -B -m labels.suggest --pdf out/cohort3/real/<stem>.pdf --adapter out/stage1/adapter-r10 --threshold 0.9933 --all-blocks --split-enumerated-heads --python ~/.venvs/qwen-role-decisions/bin/python --out out/suggest/wild-r3/<stem>/sidecar.json
```

- [ ] **Step 2:** Record per document: `blocks_total`, `cards_considered`, `split_heads`, wall time. A document the tagger cannot process is recorded as such and replaced by the next extension id, in order, with the replacement written into `population.json` under `"replacements"`.
- [ ] **Step 3:** Hand the coordinator the list of stems and confirm every `cards.jsonl` has `image` paths under `pages/marked-408`.

### Task 3: Four-judge consensus on every card (coordinator)

- [ ] **Step 1:** Build `out/labels/s2wild-r3-source.jsonl` from the 20 `cards.jsonl` files (same row shape as round 1) and chunks of 62 under `judge/chunks-r3/`.
- [ ] **Step 2:** Judge every chunk with the four judges (low = Opus quick, medium = Sonnet, high = Opus thorough, fable = Fable medium) under protocol v2, 20 concurrent, waves tracked in `launched.txt`.
- [ ] **Step 3:** `python3 consensus.py --source …r3-source.jsonl --outdir judge/out-r3 --outfile out/labels/s2wild-r3-consensus.jsonl --write`. Calibration is unavailable (no audit overlap); report pairwise agreement, unanimity, 3/4, no-consensus counts, and the type mix.
- [ ] **Step 4:** Copy judge outputs and protocol to `out/labels/s2wild-judges-r3/` for provenance.

### Task 4: Fold, split, evaluate (implementing chat)

- [ ] **Step 1:** `labels.fold_wild` over `out/suggest/wild-r3` with the r3 consensus → `out/labels/wild-r3-labels.jsonl`, `out/stage1/pred-wild-r3-r10.jsonl`, `out/labels/wild-r3-cards.jsonl`.
- [ ] **Step 2:** Split with `--keep out/keys-all-4-wild/split/split.json --keep-labels <the kept labels> --assign-new validation`; refuse if any kept id moves or any new host collides.
- [ ] **Step 3:** `labels.eval_wild` three ways: r3 alone; rounds 2 + 3 combined (30 documents); and the combined set under the shape-blind selector. Same columns as before, plus per-document clean rate and the coverage curve.
- [ ] **Step 4:** If the combined accuracy lower bound is within 0.005 of 0.99 and FP passes, run the extension ids (Task 2 again for ids 21–30, then Tasks 3–4) and report the 40-document result as well. If the bound is more than 0.005 short, do not extend; report and stop.

### Task 5: Record and roadmap

- [ ] **Step 1:** New section "Wild round 3: population growth" in `heading-stage2-2026-09-18-results.md`: the draw (rule, ids, pool size), per-document facts, judging statistics, the three eval views with exact bounds, and the gate verdict per bar (accuracy LB, FP UB, abstention).
- [ ] **Step 2:** Roadmap line: the Stage 2 verdict on the combined wild population, and what remains if a bar still fails (abstention → threshold re-derivation on validation; accuracy → the specific miss anatomy).
- [ ] **Step 3:** Commit.

**Not in this plan:** training round 13 on wild labels, OCR, threshold changes, product-branch merge.
