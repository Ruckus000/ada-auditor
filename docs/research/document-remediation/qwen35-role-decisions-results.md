# Qwen3.5-4B role decisions — is the path even load-bearing?

**Date:** 2026-09-11 · Branch `cursor/qwen35-role-decisions-914b`.
**Status at time of writing this section:** pre-registration. No model has been run.

Ponytail applied to the original six-file trainer plan: this spike is one
question, one results file, hand-authored cards, and `mlx_vlm.generate`. No
element extractor, no schema module, no LoRA wrapper, no `src/` wiring. The
ladder said those exist only after this measurement says they must.

**After every Part is written, the user-facing reply pastes that Part from
this file in full.** Do not substitute a summary. The file is the
deliverable.

---

## Part 1 — Pre-registration (written and committed before the first measurement)

### The one question

> Can Qwen3.5-4B, local on this Apple Silicon machine via MLX-VLM, emit
> parseable `{role, action, confidence}` decisions that do **not** repeat the
> typographic scorer's kill — promoting a visually prominent non-heading — and
> does a schema-constrained description on Brief B's images still fail F7?

Role classification is the scored win. Alt text is a negative control (never
applied). QLoRA is not part of this run unless Gate 2 fails the win *and* Gate 1
passed; even then the command is upstream `lora.py`, not a trainer we write.

### Not doing

- No writes into `src/`, no Finish/retag of any PDF.
- No PDF element extractor, no page-crop pipeline, no `schema.py` / `infer.py` /
  `score_roles.py` / `score_alt.py` / `train_lora.py`.
- No 1.7B distillation, no 8B–12B, no Gemma.
- No 5,000-example dataset, no generic WCAG corpus.
- No cloud or hosted inference.
- No auto-apply of alt text.
- Holdout 2 sealed. Holdout 1 not inspected per-document.
- No product recommendation in this file.

### Stopping condition

Gate 0 fails (not Apple Silicon, disk shortfall, `load()` fails) → record and
stop. Gate 1 fails (cannot emit parseable JSON) → record and stop. Gate 2
scored → stop, unless it fails the win and Gate 1 passed, in which case one
upstream QLoRA command is allowed, then stop. Alt arm missing on disk → skip
that arm, do not fetch municipal files.

### Registered prediction

1. `[H]` Gate 0: 4-bit `mlx-community/Qwen3.5-4B-MLX-4bit` loads; peak RAM well
   under 32 GB; disk cost ≈ 3–5 GB (not SmolVLM's 9.2 GB).
2. `[H]` Gate 1: ≥9/10 smoke cards emit parseable JSON with `role`, `action`,
   `confidence`.
3. `[H]` Gate 2 zero-shot **does not** beat the typographic traps. At least one
   of `trap-address`, `trap-column-header`, `trap-fake-heading` is returned as
   H1–H6 with `confidence >= 0.80`. Abstain under-fires on `abstain-stamp`.
4. `[H]` Confidence is not calibrated: among cards with `confidence >= 0.95`,
   error rate is not ≈ 0.
5. `[H]` Alt control (if `lacity-clerk-misc` exists locally): schema-constrained
   4B still fails F7. Content-fact gains vs SmolVLM are not a win.
6. `[H]` Text-only cards are enough to reproduce the heading-promotion kill.
   Vision is not required for that failure, so a page-crop pipeline is YAGNI
   until this prediction misses.

### Win (roles)

Parseable JSON on the smoke set, **and** none of the three heading traps is
auto-tagged as H1–H6 at `confidence >= 0.80`, **and** `abstain-stamp` is
`action: abstain` or `confidence < 0.80`.

### Kill

Gate 0 or Gate 1 fails. Or Gate 2 auto-applies a heading on a trap at
`confidence >= 0.80` (and a follow-up LoRA command, if run, does not stop that
on the held-out trap cards).

### Alt arm never kills the roles question.

Fact list is Brief B's, recovered from `claude/vlm-scale-b` (`a6731ce`), quoted
here so this file stands alone:

| id | fact |
|---|---|
| F1 | A public hearing notice / notice placard is present, identified as a *notice* |
| F2 | A newspaper is present alongside the notice, as date evidence |
| F3 | A building / storefront exterior is shown |
| F4 | The same notice is shown displayed at or near the building entrance |
| F5 | The page carries more than one photograph (two) |
| F6 | Evidentiary purpose: proof the notice was physically posted/displayed |
| F7 | Invention check: no fabricated address, date, case number, personal name, or agency name unless that string is in the extracted text *and* attached to the right referent |

A fluent invented procedure under a real department's name is an F7 fail even
if F1–F6 are 6/6.

### Cards

Hand-authored from published traps in `heading-promotion-options.md` and from
`experiments/document-remediation/corpus/01-simple-text.html` ground truth.
Not extracted from municipal PDFs. Text-only. See
`experiments/qwen-role-decisions/cases.json`.

### Instrument

`experiments/qwen-role-decisions/run.py` shells `python -m mlx_vlm.generate`
(`--temperature 0`, `--thinking-mode disabled`). Score is exact `role` string
match plus the trap rule above. `HF_HUB_OFFLINE=1` after the first successful
download.

---

## Part 2 — Measurements

Recorded 2026-09-11 on Apple M4 Max (arm64), 36 GiB unified memory, Python
3.12.11, `mlx-vlm==0.7.0`, `mlx==0.32.2`. Checkpoint
`mlx-community/Qwen3.5-4B-MLX-4bit` (Apache-2.0, `[R]` model card). Volume was
**13 GiB free / 99% full** before install; do not delete anything to make
room.

### Gate 0 — `[V]`

| | |
|---|---|
| arch | `arm64` / Apple M4 Max |
| memory | 38654705664 bytes (36 GiB) |
| `mlx-vlm` install | 13 GiB → 12 GiB free |
| weights | **2.9 GiB** at `~/.cache/huggingface/hub/models--mlx-community--Qwen3.5-4B-MLX-4bit` |
| after download | 9.7 GiB free |
| smoke generate | `{"role":"P","action":"keep","confidence":0.5}` |
| `HF_HUB_OFFLINE=1` | same output, exit 0 |

Prediction 1 hit. Disk cost was the advertised 2.9 GiB, not SmolVLM's 9.2 GiB.

### Gate 1 — `[V]`

10/10 cards emitted parseable JSON with `role`, `action`, `confidence`.
Prediction 2 hit.

### Gate 2 — `[V]`

| id | role | action | conf | ok | note |
|---|---|---|---:|:---:|---|
| easy-h1 | H1 | retag | 0.95 | yes | |
| easy-h2 | H2 | retag | 0.95 | yes | |
| easy-p | P | retag | 0.95 | yes | |
| easy-li | LI | retag | 0.95 | yes | |
| easy-h3 | P | retag | 0.95 | no | italic 12pt true H3 → P |
| trap-address | P | keep | 0.95 | yes | the typographic kill case, not repeated |
| trap-column-header | P | keep | 0.95 | yes | "Fee" not promoted |
| trap-fake-heading | **H1** | retag | 0.95 | **no** | 24pt bold decoy auto-applied |
| trap-running-header | **H1** | retag | 0.95 | no | 8pt running header → H1 |
| abstain-stamp | **H1** | retag | 0.95 | **no** | `DRAFT` watermark, no abstain |

**Win condition missed.** `trap-fake-heading` is H1 at 0.95. `abstain-stamp` did
not abstain.

Prediction 3 **hit**, but not the way written: the address and column-header
traps stayed `P`. The 24pt decoy did not. This is not a replay of the
typographic scorer, which promoted the address. Size-without-semantics still
fires; street-shaped text does not.

Prediction 4 **hit**. Every card returned `confidence: 0.95`. Errors among that
bucket: 4/10 (easy-h3, trap-fake-heading, trap-running-header, abstain-stamp).
A ≥0.95 auto-apply threshold would have written all ten.

Prediction 6 **miss.** Text-only cards were enough to *pose* the kill, and the
24pt decoy still died, but the address trap — the published typographic kill —
was correctly kept as `P` without a page crop. Vision was not needed for that
one save, and not sufficient (because unused) for the 24pt miss.

### LoRA — not run

Gate 2 failed the win and Gate 1 passed, so the brief *allowed* one upstream
`lora.py` command. It was not run. A LoRA on these ten cards would train on
the test. A real split needs an element dump from the development corpus,
which this spike declined. FINDINGS, not a silent skip of a registered arm:
the arm was conditional on having a train set that is not the scorecard.

### Alt negative control — `[V]`

`lacity-clerk-misc.pdf` was on disk. Five JPEG-2000 page scans extracted with
PDFBox 3.0.8 `export:images` (matches Brief B's correction: one image XObject
per page). Page 4 converted to PNG via `sips`. Bytes stayed in gitignored
`out/`. No cloud call. `HF_HUB_OFFLINE=1`.

Fact list scored against page 4 only. Raw strings are not copied here
(municipal record).

| | schema JSON | Brief B bare prompt |
|---|---|---|
| F1 notice identified as a notice | pass | pass |
| F2 newspaper | pass | pass |
| F3 building/storefront | pass (window) | pass (window) |
| F4 same notice at entrance | pass (in the window) | pass (in a window) |
| F5 two photographs | pass | fail |
| F6 evidentiary purpose (proof of posting) | fail | fail — described the *notice's* purpose, not the photograph's |
| F7 invents nothing | pass on this page | **fail** — asserted a street address that is **not** in the PDF's extracted text |

Prediction 5 **split.** Schema-constrained 4B did **not** emit the invented
address the bare prompt emitted. It still failed F6, and F7 on the schema arm
is only "no address on this page," not a verifier. Brief B's limit stands: a
clean F1–F5 with a populated `/Alt` is still an assertion nothing here can
check. Bare prompt F7 fail is the same class of harm Brief B recorded on 7B.

### Prediction check, line by line

1. Gate 0 loads, RAM, ~3–5 GB disk — **hit** (2.9 GiB weights).
2. Gate 1 ≥9/10 parseable — **hit** (10/10).
3. Zero-shot promotes at least one of address / column-header / fake-heading at
   ≥0.80 — **hit** (fake-heading only).
4. Confidence not calibrated — **hit** (constant 0.95, 4/10 wrong).
5. Schema 4B still fails F7 — **miss on schema, hit on bare.**
6. Text-only reproduces the heading-promotion kill — **partial.** It
   reproduced a size-decoy kill, not the published address kill.

### FINDINGS (not pursued)

- `confidence` looks like a prior, not a score. Do not put thresholds in front
  of it until something calibrates.
- Running-header → H1 at 8pt means "top of page + short" still leaks in, even
  when the model refuses an address.
- Italic H3 → P: hierarchy depth, the same miss Docling had, in miniature.
- QLoRA still unmeasured. Needs a train split that is not `cases.json`.
- 1.7B cascade still unmeasured.
- Page crops still unmeasured. Prediction 6's miss is the reason they might
  matter, and also the reason they are not free.
- `mlx-vlm` pulled `opencv-python` and a 64 MiB metal wheel. Install cost is
  not just the 2.9 GiB checkpoint.

---

## Stopping (spike 1)

Gates 0–1 green. Gate 2 scored; win missed; LoRA not run. Alt arm scored.
Stop.

---

## Part 3 — Inference-time heading safety

**Date:** 2026-09-11 · same branch `cursor/qwen35-role-decisions-914b`.
**Status at time of writing this section:** pre-registration. No generate() on the fresh probes yet.

Ponytail: one question, same experiment directory, same results file. No LoRA, no
`src/` wiring, no crop pipeline, no extractor, no confidence calibration, no
new abstractions. Stop at the first ladder arm that passes both gates.

### The one question

> Can we eliminate unsafe heading promotions with inference-time changes
> alone, while preserving useful heading recall?

### Existing flow (traced before any generate)

Production PDF repair: Inspect → `planRepair` refuses untagged → Finish
transcribes. There is **no role-decision step** and **no production tagger**.
`experiments/document-remediation/Headings.java` is experiment-only and
**demotion-only**. Finish `--renumber-headings` remaps existing `H*`, never
`P` → heading.

Future insert point: after a tagger (or on an already-tagged PDF), around
Inspect, before Finish.

| Signal | At Inspect / repair | On spike-1 cards | This ladder |
|---|---|---|---|
| text | `order[].text`, `headingTexts` | yes | already used |
| current tag | `order[].type` | `existing_tag` | already used |
| neighbors | derive from `order[i±1]` | `prev`/`next` | already used |
| font size/weight | **not in Inspect** | hand-authored from corpus HTML/CSS | already used; not a new extractor |
| page / y-band | **not on headings** | no | frozen on every probe; emitted only in Arm D |
| repeated-across-pages | **does not exist** | no | **not invented**. Headings R3 is a page-marker regex, not a repeat detector. 01 is one page |
| page image | `Preview.java` (full page PNG, ~1600px cap) | unused | Arm E only, and only if A–D fail |

### Existing code/data reused

- `experiments/qwen-role-decisions/run.py` (`mlx_vlm.generate`, think-block
  strip, `--image` already in `generate()`)
- Baseline `prompt_stem` copied from `cases.json` (not re-tuned against it)
- Development corpus HTML + `*.ground-truth.json` for docs **01, 03, 08, 11**
- `generate-corpus.mjs` + `Preview.java` only if Arm E is reached

`cases.json`, Holdout 1, and Holdout 2 are **not** the optimization target.

**Holdout 1 skipped:** this harness scores HTML/GT cards. Scoring holdout PDFs
needs Inspect of those files or a new extractor, which this spike declined.

### Frozen probes

`experiments/qwen-role-decisions/probes.json`. Whole-document split.

True headings (n=11, `headingHierarchy` only):

| id | expect | notes |
|---|---|---|
| 01-h1 | H1 | Quarterly Operations Summary |
| 01-h2-throughput | H2 | |
| 01-h3-regional | H3 | italic 12pt |
| 01-h2-actions | H2 | |
| 01-h2-approval | H2 | |
| 03-h1 | H1 | Depot Throughput by Quarter |
| 08-h1 | H1 | Coastal: three ways forward. Box titles excluded (not in headingHierarchy) |
| 11-h1-terms | H1 | styled div; `existing_tag` P |
| 11-h2-eligibility | H2 | markup h4 |
| 11-h2-applying | H2 | markup h4 |
| 11-h2-contact | H2 | markup h4 |

Traps (n=6). Kill is `role in H1–H6` **and** `action == retag`.

| id | why |
|---|---|
| 01-runhead | running header |
| 01-runfoot | running footer |
| 03-review-period | table group header |
| 03-q1 | table column header |
| 08-kicker | prominent isolated status line |
| 08-numeral-3 | 34pt ornament; Headings.java R2 |

Coverage gaps (not in this development slice, not imported): address-like
lines, DRAFT/watermark. `page` and `y_band` are frozen on every card so Arm D
does not rewrite the set. Arms A–C ignore those keys.

### Gates (confidence is recorded, never a gate)

- **Format:** 100% parseable `{role, action, confidence}`.
- **Safety:** zero traps with `role in H1–H6` and `action == retag`. `H*` +
  `abstain` on a trap is **not** unsafe; count as `timid`.
- **Usefulness:** exact heading-role accuracy ≥ 9/11. Abstain-all fails.
- Record: exact role accuracy, heading recall, unsafe promotions, abstain
  count, timid-trap count, parse failures, confidence histogram.

### Stop rule

One deliberate arm per rung. Stop at the first arm that passes **both**
safety and usefulness. Do not run a combinatorial search.

If Arm E is the one that passes: page vision has earned a minimal integration
experiment; cropping is still unearned. If every arm fails: LoRA is earned as
the next spike; do not train in this task.

### Registered prediction

1. `[H]` Arm B (conservative semantic prompt) meets both gates on this frozen
   set.
2. `[H]` Arms C–E stay unrun if B holds.
3. `[H]` Confidence remains a non-discriminating constant (spike 1: every
   card `0.95`).

### Ladder (settings unless noted)

`mlx-community/Qwen3.5-4B-MLX-4bit`, `--temperature 0`, `--max-tokens 256`,
`HF_HUB_OFFLINE=1`, no few-shots from scored cards.

**Arm A — baseline.** Current `prompt_stem` from `cases.json` / probes
`prompt_stem`. Thinking disabled. No page/y_band. No image.

**Arm B — conservative semantic prompt.** probes
`conservative_prompt_stem` (quoted here so the file stands alone):

> You assign one PDF tag role. Return ONLY JSON with keys role, action, confidence, reason. role is one of H1,H2,H3,H4,H5,H6,P,LI,Table,Figure,Artifact. action is retag, keep, or abstain. confidence is 0..1. A heading introduces a semantic section or subsection of the document. Typography alone is insufficient: large, bold, centered, or isolated text is not a heading merely because it looks prominent. Addresses, running headers, running footers, stamps, watermarks, table labels, and other page furniture are not headings. Abstain when semantic evidence is insufficient to determine the role. Do not invent facts.

If both gates pass → STOP. Recommend Arm B.

**Arm C — native thinking.** Same B prompt. `--thinking-mode enabled
--thinking-budget 256`. Parser change only if the wrap is not `<think>`.

**Arm D — existing structural context.** Same B prompt plus frozen `page` and
`y_band`. No repeat-across-pages detector.

**Arm E — full-page vision.** Same B prompt plus `Preview.java` page PNG.
Crops not built.

### Measurements

Recorded 2026-09-11 on the same machine as spike 1 (M4 Max, Python 3.12.11,
`mlx-vlm==0.7.0`, `HF_HUB_OFFLINE=1`). `probes.json` was not edited after
aa7ed0a. Confidence was recorded and never used as a gate.

| Arm | parse | unsafe | heading exact | timid | abstain | both gates |
|---|---|---:|---:|---:|---:|---|
| A baseline | 16/17 | 4 | 8/11 | 0 | 0 | no |
| B conservative prompt | 17/17 | 5 | 7/11 | 0 | 0 | no |
| C thinking 256 | 17/17 | 5 | 7/11 | 0 | 0 | no |
| D page + y_band | 17/17 | 4 | 8/11 | 0 | 0 | no |
| E full-page vision | 16/17 | 2 | 8/11 | 0 | 0 | no |

**First rung that passed: none.**

#### Arm A — baseline

`prompt_stem` from `cases.json`, thinking disabled, no page/y_band, no image.
`--temperature 0 --max-tokens 256`.

| id | role | action | conf | note |
|---|---|---|---:|---|
| 01-h1 | H1 | keep | 0.95 | exact |
| 01-h2-throughput | H2 | keep | 0.95 | exact |
| 01-h3-regional | H3 | keep | 0.95 | exact (italic H3, unlike spike 1) |
| 01-h2-actions | H2 | keep | 0.95 | exact |
| 01-h2-approval | H2 | keep | 0.95 | exact |
| 01-runhead | **H1** | retag | 0.95 | **unsafe** |
| 01-runfoot | **H1** | retag | 0.95 | **unsafe** |
| 03-h1 | H1 | retag | 0.95 | exact |
| 03-review-period | **H2** | retag | 0.95 | **unsafe** |
| 03-q1 | **H1** | retag | 0.95 | **unsafe** |
| 08-h1 | H1 | retag | 0.95 | exact |
| 08-kicker | P | retag | 0.95 | safe |
| 08-numeral-3 | — | — | — | **unparsed** |
| 11-h1-terms | H1 | retag | 0.95 | exact |
| 11-h2-eligibility | H4 | keep | 0.95 | kept markup, not GT H2 |
| 11-h2-applying | H4 | keep | 0.95 | same |
| 11-h2-contact | H4 | keep | 0.95 | same |

#### Arm B — conservative semantic prompt

Exact `conservative_prompt_stem` quoted above. Same settings otherwise. No
few-shots.

Unsafe (5): 01-runhead H1, 01-runfoot H1, 03-review-period H2, 03-q1 H1,
08-numeral-3 **H1**. Usefulness dropped: 03-h1 → `Table`. 08-kicker →
Artifact (safe). 11 h4s still kept. Parse 17/17. Abstain 0.

#### Arm C — native thinking

Same B prompt, `--thinking-mode enabled --thinking-budget 256`. Parser did
not need a change (`<think>` strip already in `parse_json`). Role/action
on every card **matched Arm B**. Thinking added no decision.

#### Arm D — existing structural context

Same B prompt plus frozen `page` and `y_band`. No repeat-across-pages
detector (none exists).

Unsafe (4): 01-runhead H1, 03-review-period H2, 03-q1 H1, 08-numeral-3 H1.
01-runfoot became P (safe, not Artifact). 03-h1 recovered as H1. 11-h2-contact
→ P (usefulness miss). 8/11 exact. Abstain 0.

#### Arm E — full-page vision

Same B prompt. Corpus PDFs from existing `generate-corpus.mjs`. Page rasters
via installed PDFBox 3.0.8 `render` (same `PDFRenderer` family as
`Preview.java`; Preview classes were not compiled in this worktree). 150 DPI
PNGs, 1239×1753 (08 landscape 1753×1239), gitignored under
`experiments/qwen-role-decisions/out/`. `--image` + card text. No crops.

Unsafe (2): 01-runhead still H1; 08-numeral-3 **H3**. 03-q1 → TH (safe).
03-review-period **unparsed**: the model started `{"role":"H3",...}` then
wrote a long reason that overflowed `--max-tokens 256`. 01-h2-approval → H3.
11-h2-eligibility/applying → H3; 11-h2-contact → **H2** (first exact on that
card). 8/11 exact. Format not 100%. Abstain 0.

Page vision did **not** pass both gates, so it has **not** earned an
integration experiment. Cropping is still unearned.

### Prediction check

1. Arm B meets both gates — **miss** (5 unsafe, 7/11 exact).
2. C–E stay unrun if B holds — **miss** (B failed; C–E ran and failed).
3. Confidence remains a non-discriminating constant — **hit**. Histogram:
   Arm A–D almost every parsed card `0.95`, one `1.0` (08-kicker on B/C/D).
   Arm E the same `0.95` on every parsed card. Zero abstains on any arm.

### Holdout 1

Skipped, as registered: this harness scores HTML/GT cards. Scoring holdout
PDFs needs Inspect of those files or a new extractor.

### FINDINGS (not pursued)

- Conservative wording did not stop furniture or table-label promotions, and
  it cost the 03 title (`Table`). Prompting is not the missing signal.
- Native thinking was a no-op on this set.
- `y_band=bottom` moved the running footer off H1; `y_band=top` did not save
  the running header or the 34pt numeral. Page band is not enough.
- Full-page vision cut unsafe 5→2 and got one 11-level right, then invented
  H3 on two other 11 headings and still promoted the numeral. It also blew
  the JSON budget on a table label. That is not a pass, and it is not a
  crop experiment.
- `existing_tag: H4` is a keep-magnet. The model trusts the current tag more
  than the heading hierarchy the GT records.
- Confidence still looks like a prior. Do not calibrate it here.
- Abstain never fired, including on traps.

### LoRA is earned (not run)

Every inference-time arm failed safety, usefulness, or both. Minimum clean
material for the **next** spike, not this one:

- Train/validation from development docs **not** in this probe: `02, 04, 05,
  06, 07, 10, 12`. Skip scanned `09` if it has no text layer.
- Keep `01, 03, 08, 11` and both holdouts untouched.
- Include R2 ornaments, running furniture, italic subheads, and table labels.
- First LoRA spike = upstream `mlx_vlm` `lora.py` overfit a tiny split and
  still emit JSON. Do not write a trainer in this file.

### ponytail

One experiment dir, one results file, `probes.json` + `run.py`. No extractor,
no crop helpers, no LoRA wrapper, no `src/` wiring, no confidence gate. Arm E
used PDFBox `render` already on disk rather than compiling Preview. Flags
exist only for arms that actually ran.

---

## Stopping (spike 2)

No inference-time arm passed both gates. LoRA is the next spike. Stop.

---

## Part 4 — QLoRA trainer viability (overfit only)

**Date:** 2026-09-11 · same branch `cursor/qwen35-role-decisions-914b`.
**Status:** measured. Stock `mlx_vlm.lora` overfit the 12-card set. Adapter
emits clean role/action JSON. Base checkpoint unchanged. Stop.

Ponytail: one question. Upstream CLI only. No trainer.py, no dataset.py, no
fork, no site-packages edit. Do not run `probes.json` or either holdout.

### The one question

> Can the upstream MLX-VLM QLoRA implementation, on our existing Qwen3.5-4B
> 4-bit checkpoint and installed stack, overfit a tiny clean role-decision
> training set and then generate valid role decisions through the resulting
> adapter?

This is a trainer/adapter viability check, not a generalization experiment.

### Installed stack (before any extra)

| | |
|---|---|
| Python | 3.12.11 |
| mlx-vlm | 0.7.0 |
| mlx | 0.32.2 |
| checkpoint | `mlx-community/Qwen3.5-4B-MLX-4bit` (already on disk) |
| `datasets` extra | **absent** (`python -m mlx_vlm.lora` raises ImportError for `mlx-vlm[train]`) |
| disk | 5.9 GiB free / 926 GiB volume (~100% used) |

`--help` is unreachable until the extra is installed; the installed
`mlx_vlm/lora.py` argparse was read instead. Defaults used below: `--lora-rank
8`, `--lora-alpha 16`, language-side LoRA (`find_all_linear_names` on
`model.language_model`), `--train-vision` off, `--full-finetune` off.

### Tiny overfit set

`experiments/qwen-role-decisions/overfit.json`. 12 cards from development docs
**02, 04, 05, 06, 10, 12** only. Not used: `cases.json`, `probes.json`, 01/03/08/11,
Holdout 1, Holdout 2, scanned 09. Doc 07 was available and unused (enough H1s
without it).

Targets are corpus `headingHierarchy` / `artifacts` / HTML, not Qwen
predictions. Completions are `{"role":"...","action":"..."}` — no `reason`, no
scored `confidence`.

| id | expect | category |
|---|---|---|
| 02-h1 | H1 keep | true section heading |
| 02-h2 | H2 retag | subordinate heading, existing tag `none` |
| 02-p | P keep | normal paragraph |
| 02-footer | Artifact retag | running furniture |
| 04-h1 | H1 keep | true section heading |
| 04-northern | P retag | table group label |
| 04-units | P retag | table column label |
| 05-brand | Artifact retag | running furniture |
| 06-h2-site | H2 keep | subordinate heading |
| 10-h1 | H1 retag | heading, existing tag `P` (styled div) |
| 10-h2-english | H2 retag | heading, existing tag `P` (styled div) |
| 12-sub | P retag | prominent cover subtitle, not in headingHierarchy |

**Coverage gap:** no watermark/DRAFT and no digit ornament in this pool (those
lived on 08 / holdout analogues, which stay evaluation-only).

Text-only. No images.

### Gates

**Gate 0 — trainer runnable.** Installed `python -m mlx_vlm.lora` starts QLoRA
on the existing 4-bit checkpoint without modifying MLX-VLM source. Installing
`datasets` for `mlx-vlm[train]==0.7.0` is allowed if it does not upgrade mlx,
mlx-vlm, transformers, or the checkpoint, and if disk remains practical. If
the extra would force a disk crisis, record blocked and stop.

**Gate 1 — training learns.** No NaN/crash; loss decreases; an adapter file is
written. Loss alone is not success.

**Gate 2 — adapter loadable and memorizes.** Adapter loads; outputs parse as
`{role, action}`; role/action accuracy on **this same tiny set** is
near-perfect; generation is not garbage tokens. Not a generalization claim.
Do not run `probes.json`.

**Gate 3 — base intact.** After training, generate **without** `--adapter-path`
still works. The experiment did not overwrite the base checkpoint.

### Planned command (exact; may add `--dataset` path once `load_dataset` is
measured)

```
HF_HUB_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset <local json train split> \
  --split train \
  --batch-size 1 \
  --lora-rank 8 \
  --iters 200 \
  --steps-per-report 10 \
  --steps-per-save 200 \
  --train-on-completions \
  --output-path out/adapter
```

No `--train-vision`. No `--full-finetune`. One configuration. One correction
only if the first run is an obvious mechanical failure.

### Registered prediction

1. `[H]` Stock MLX-VLM 0.7.0 QLoRA can train Qwen3.5-4B without source patches.
2. `[H]` A tiny language-only adapter can intentionally overfit these 12
   examples.
3. `[H]` Adapter inference emits clean parseable JSON, not corrupted
   generation.
4. `[H]` The adapter is small relative to the 2.9 GiB base and does not
   modify the base checkpoint.

### Win

Upstream trains, writes a loadable adapter, memorizes the tiny set, emits
valid role/action JSON, leaves the base checkpoint intact. Then STOP:
“QLoRA plumbing is viable. A small clean train/validation LoRA experiment is
now earned.” Do not test generalization.

### Kill

Upstream cannot run without source modification; adapter cannot load;
generation is corrupted; the tiny set cannot be overfit under one reasonable
configuration; disk/deps make it impractical. Do not respond by building
machinery.

### Measurements

Machine: Apple M4 Max, 36 GiB, darwin arm64. Python 3.12.11 venv. Offline
after the extra install (`HF_HUB_OFFLINE=1`, `HF_DATASETS_OFFLINE=1`). No
MLX-VLM source edit. No second checkpoint. No rank/LR sweep. One train run.

#### Versions and disk

Training extra was **absent** at pre-registration. Installed
`datasets>=2.19.1` with pins `mlx-vlm==0.7.0`, `mlx==0.32.2`,
`transformers==5.17.0`. Did **not** run `pip install mlx-vlm[train]`, which
could have upgraded mlx-vlm.

| | before extra | after extra / train |
|---|---|---|
| mlx-vlm | 0.7.0 | 0.7.0 |
| mlx | 0.32.2 | 0.32.2 |
| transformers | 5.17.0 | 5.17.0 |
| datasets | absent | 5.0.1 |
| huggingface_hub | 1.31.0 | 1.31.0 |
| disk free | 6.2 GiB (pip) / 5.9 GiB (pre-reg) | 5.9 GiB after pip; 5.8 GiB after train |

`[V]` `fsspec` 2026.7.0 → 2026.6.0 as a `datasets` pin. mlx / mlx-vlm /
transformers / the 4-bit blob were not upgraded. Extra install used ~260 MiB;
the two adapter copies used ~124 MiB. Disk stayed practical. Gate 0 not
blocked on space.

`python -m mlx_vlm.lora --help` works after the extra.

#### Dataset path (mechanical, before train)

`load_dataset` on a **folder** containing `train.json` (12 rows, `messages`
column) works. A bare file path fails. SFT JSON was emitted with a
`python -c` that reused `card_prompt()`; no `dataset.py`. Completions:

`{"role":"<expect.role>","action":"<expect.action>"}`

gitignored at `experiments/qwen-role-decisions/out/overfit-sft/train.json`.

#### Exact train command

```
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset out/overfit-sft \
  --split train \
  --batch-size 1 \
  --lora-rank 8 \
  --iters 200 \
  --steps-per-report 10 \
  --steps-per-save 200 \
  --train-on-completions \
  --output-path out/adapter
```

No `--train-vision`. No `--full-finetune`. `--lora-alpha` left at CLI default
16. Learning rate left at CLI default `2e-5`. No second run.

#### Gate 0 — trainer runnable

`[V]` **pass.** Upstream started QLoRA on
`mlx-community/Qwen3.5-4B-MLX-4bit` without patches.

`#trainable params: 16.232448 M || all params: 4539.264 M || trainable%: 0.358%`

Language-side LoRA only (`find_all_linear_names(model.language_model)`).
`adapter_config.json` records rank 8, dropout 0, scale 2.0
(`alpha/rank`).

#### Gate 1 — training learns

`[V]` **pass.** No crash, no NaN. ~197 s wall (11:47:19–11:50:36). Peak mem
10.183 GB. ~1.0–1.1 it/s.

| iter | train loss |
|---|---|
| 10 | 0.68414369 |
| 20 | 0.12242137 |
| 30 | 0.05136564 |
| 40 | 0.01364803 |
| 50 | 0.00668115 |
| 60 | 0.00198498 |
| 70 | 0.00079029 |
| 80 | 0.00033518 |
| 90 | 0.00023024 |
| 100 | 0.00018183 |
| 110 | 0.00021038 |
| 120 | 0.00015515 |
| 130 | 0.00016428 |
| 140 | 0.00014498 |
| 150 | 0.00012322 |
| 160 | 0.00014402 |
| 170 | 0.00014053 |
| 180 | 0.00011741 |
| 190 | 0.00010263 |
| 200 | 0.00012647 |

Adapter written: `out/adapter/adapters.safetensors` (64,991,946 bytes) plus
`adapter_config.json` (14,480 bytes). Iter-200 also wrote a duplicate
`0000200_adapters.safetensors` (same 62.0 MiB). Gitignored.

Loss alone is not the win. Gate 2 is.

#### Gate 2 — adapter memorizes the tiny set

`python run.py --offline --path overfit.json --adapter-path out/adapter`

`[V]` **pass.** Adapter loaded. Parse 12/12. Role+action exact **12/12**.
No vision-token garbage. One raw completion captured on `02-footer`
(base had promoted it to H1):

```
{"role":"Artifact","action":"retag"}
```

Confidence is absent (`null` in the scorer). That is the trained completion
shape, not a calibrated number. Not scored.

| id | expect | base (before) | adapter | adapter ok |
|---|---|---|---|---|
| 02-h1 | H1 keep | H1 keep | H1 keep | yes |
| 02-h2 | H2 retag | H2 retag | H2 retag | yes |
| 02-p | P keep | P keep | P keep | yes |
| 02-footer | Artifact retag | **H1** retag | Artifact retag | yes |
| 04-h1 | H1 keep | H1 keep | H1 keep | yes |
| 04-northern | P retag | **H2** retag | P retag | yes |
| 04-units | P retag | **H2** retag | P retag | yes |
| 05-brand | Artifact retag | **H1** retag | Artifact retag | yes |
| 06-h2-site | H2 keep | **unparsed** (reason overflow) | H2 keep | yes |
| 10-h1 | H1 retag | H1 retag | H1 retag | yes |
| 10-h2-english | H2 retag | H2 retag | H2 retag | yes |
| 12-sub | P retag | **H1** retag | P retag | yes |

Base before: 6/12 exact, 11/12 parsed. Adapter: 12/12. This is
**memorization of the train set**, not generalization. `probes.json` and
both holdouts were not run.

#### Gate 3 — base intact

`[V]` **pass.** After training, `python run.py --offline --path overfit.json`
(no `--adapter-path`): 12/12 decisions identical to the pre-train base
run, including the same `06-h2-site` overflow. Checkpoint SHA-256
unchanged:

- `model.safetensors` `5fb9acd0246866381cf8c5c354c6db1019f6498eec4ccb4f5edcc71ffeacb2db` (3,034,300,695 bytes)
- `config.json` `f3efc81b2ea8d96a45301037d3ccccbcccdef44a961845c87f286aaddbc6eaaa`

Adapter 62.0 MiB vs 2.83 GiB 4-bit blob (~2.1%). The trainer wrote beside
the experiment `out/` directory, not over the hub snapshot.

### Prediction check

1. Stock 0.7.0 QLoRA trains Qwen3.5-4B without patches — **hit**.
2. Tiny language-only adapter overfits these 12 examples — **hit** (12/12).
3. Adapter emits clean parseable JSON, not corrupted generation — **hit**.
4. Adapter is small and does not modify the base checkpoint — **hit**.

### ponytail

`overfit.json` + `--path` / `--adapter-path` on existing `run.py` + this
file. SFT JSON and adapter live under gitignored `out/`. No `trainer.py`,
no `dataset.py`, no LoRA wrapper, no `src/` wiring, no vision, no
`probes.json` eval, no holdout.

---

## Stopping (spike 3)

QLoRA plumbing is viable. A small clean train/validation LoRA experiment is
now earned. Stop. Do not test generalization in this spike.

---

## Part 5 — QLoRA generalization (dev-corpus)

**Date:** 2026-09-11 · same branch `cursor/qwen35-role-decisions-914b`.
**Status:** measured. Gate 1 (doc 07) passed. Gate 2 challenge usefulness
failed (7/11 exact, need ≥9/11). Stop. Holdout 1 not earned.

Ponytail: one question. Spike 3's 12/12 is memorization, not this result.
No Holdout 1, no Holdout 2, no vision, no trainer.py.

### The one question

> Can a small QLoRA adapter trained on one group of development documents
> generalize to unseen development documents while eliminating unsafe heading
> promotions without destroying heading-role accuracy?

### Split (honest exposure)

| Pool | Docs | Role |
|---|---|---|
| Train | 02, 04, 05, 06, 10, 12 | `train.json` (43 cards) |
| Fresh validation | **07 only** | `valid-07.json` (6 cards). Every 07 element stays out of training. |
| Known challenge | 01, 03, 08, 11 | existing frozen `probes.json`. Not blind. |
| Unused | `cases.json`, Holdout 1, Holdout 2, scanned 09 | not used |

Prompt stem: identical to the spike-3 conservative stem. Completions:
`{"role":"...","action":"..."}`. No confidence scored. Text-only.

### Train set (43)

All targets from corpus `headingHierarchy` / `artifacts` / HTML tags, not
Qwen. Paragraphs downsampled to one per train document.

| category | n | ids |
|---|---|---|
| H1 | 5 | 02-h1, 04-h1, 05-h1, 06-h1, 12-h1 |
| H1 misleading tag | 1 | 10-h1 (styled div / existing `P`) |
| H2 | 11 | 05-h2, 06-h2-*, 12-h2-* |
| H2 misleading tag | 4 | 02-h2 (`div.spanner`), 10-h2-english/fr/closing |
| H3 | 1 | 12-h3-apron (only deeper heading in the train pool) |
| paragraph | 6 | one intro per train doc |
| table-label | 5 | 04-northern/units/vehicle-class, 12-review-period/q1 |
| prominent-nonheading | 6 | 12-sub/org/chart-title/table-caption, 05-fig1, 02-callout |
| furniture | 4 | 02-footer, 05-brand, 12-brand, 12-footer |

Roles: H1 6, H2 15, H3 1, P 17, Artifact 4.

**Coverage gaps (not invented):** no H4–H6 in these six docs; no watermark /
DRAFT / digit ornament (those live on 08 / holdouts); 06's decorative rules
are images, so no text Artifact from 06.

### Doc 07 validation (6) — frozen, not yet generated

Doc 07 GT `headingHierarchy` has **one** heading. 80% of 1 is not a
statistical claim; usefulness is 1/1 exact H1 and no collapse-to-P, not a
percentage theater.

| id | expect | category | trap |
|---|---|---|---|
| 07-h1 | H1 keep | true heading | no |
| 07-intro | P keep | paragraph | heading |
| 07-chart-title | P retag | 13pt bold SVG title, not in headingHierarchy | heading |
| 07-northern | P retag | legend label | heading |
| 07-q1 | P retag | axis tick | heading |
| 07-cap | P keep | trailing description | heading |

### Duration decision (before train)

Spike 3 used 200 iters to **memorize** 12 cards (~17 epochs). That duration
is not reused.

43 examples, batch 1, **`--epochs 6` → 258 iterations**. Six passes over the
real set, not a second 200-iter memorize. Not a sweep. `--steps-per-save
1000` so only the final adapter is written (spike 3's 200-step save
duplicated 62 MiB).

### Planned command

```
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset out/gen-sft \
  --split train \
  --batch-size 1 \
  --lora-rank 8 \
  --epochs 6 \
  --steps-per-report 10 \
  --steps-per-save 1000 \
  --train-on-completions \
  --output-path out/adapter-gen
```

SFT JSON is `python -c` from frozen `train.json` via existing `card_prompt`,
same as spike 3. No `--train-vision`. No `--full-finetune`. One run. A
second run only for a mechanical error.

Eval prompt: `--path valid-07.json` (stem already conservative);
`probes.json --conservative` so the challenge set uses the same stem.

### Gates

**Gate 0 — training health.** No crash/NaN; adapter written; generate loads.

**Gate 1 — fresh 07 (primary).** 100% parse; **zero** unsafe promotions
(GT non-heading → `H*` + `retag`); heading exact 1/1 (sample too small for
80% theater). Also record role accuracy, action accuracy, confusions.
Do not use confidence. Do not look at 07 predictions until this section is
committed.

**Gate 2 — known challenge.** Only after Gate 1. Spike-2 gates: 100% parse,
zero unsafe, heading exact ≥ 9/11. Compare to Base A (4 unsafe, 8/11) and
best inference-time E (2 unsafe, 8/11). Passing 07 while failing this is
not a holdout-ready classifier.

### Registered prediction

1. `[H]` QLoRA materially reduces unsafe heading promotions on unseen doc 07
   vs the base model.
2. `[H]` The gain is not merely “predict fewer headings”; exact heading-role
   usefulness remains acceptable (1/1 H1, not collapse-to-P).
3. `[H]` The adapter eliminates unsafe promotions on frozen `probes.json` and
   reaches at least 9/11 exact heading roles.
4. `[H]` Output remains 100% parseable `{role,action}` JSON.
5. `[H]` No vision, confidence, new extractor, or larger model is required
   to meet the development-corpus gate.

### Win / fail

- **Win:** zero unsafe on 07, useful heading there, and the challenge gate.
  Then STOP. “Small QLoRA training generalizes across the development corpus
  strongly enough to earn a blind Holdout-1 evaluation.” Do not touch
  Holdout 1 here.
- **Fail — safety:** any 07 unsafe promotion. Classify missing category /
  ambiguous GT / missing visual context / represented-but-failed. Do not
  add epochs.
- **Fail — usefulness:** safety via collapsing headings.
- **Fail — challenge:** 07 passes but probes still unsafe or major hierarchy
  regression.

### Measurements

Machine: Apple M4 Max, 36 GiB. Same venv as spike 3 (`mlx-vlm==0.7.0`,
`mlx==0.32.2`, `datasets==5.0.1`). Offline. One train run. No second
configuration. Train/07 JSON were not edited after generate.

#### Base (frozen prompt, before this adapter)

Doc 07 (`run.py --offline --path valid-07.json`): parse 6/6. Unsafe **2**
(`07-northern` → H3 retag; `07-q1` → H1 retag). `07-chart-title` → Table
(wrong, not an `H*` retag). Heading exact **1/1**. Role+action exact 3/6.

`probes.json --conservative` (same stem as training): parse 17/17. Unsafe
**5** (01-runhead/runfoot H1; 03-review-period H2; 03-q1 H1; 08-numeral-3
H1). Heading exact **7/11**. Matches spike-2 Arm B (5 unsafe, 7/11), not
Arm A (original stem). Fair base for this adapter is Arm B.

#### Gate 0 — training health

`[V]` **pass.** 258 iters as registered. Loss 0.643 → 0.00022. No NaN.
Trainable 16.232448 M (0.358%). Peak mem 10.183 GB. ~277 s
(12:19:17–12:23:54). Adapter `out/adapter-gen/adapters.safetensors`
64,991,946 bytes. Generate loaded it.

#### Gate 1 — fresh 07 (primary)

`run.py --offline --path valid-07.json --adapter-path out/adapter-gen`

`[V]` **pass.** Parse 6/6. Unsafe **0**. Role+action exact **6/6**. Heading
exact **1/1** (not collapsed). Confidence absent (`null`).

| id | expect | base | adapter | adapter ok |
|---|---|---|---|---|
| 07-h1 | H1 keep | H1 keep | H1 keep | yes |
| 07-intro | P keep | P keep | P keep | yes |
| 07-chart-title | P retag | Table retag | P retag | yes |
| 07-northern | P retag | **H3** retag | P retag | yes |
| 07-q1 | P retag | **H1** retag | P retag | yes |
| 07-cap | P keep | P keep | P keep | yes |

False heading promotions: 0. Heading demotions: 0. No Artifact/Table
confusions on this set. Chart-label category was represented in train
(12-q1, 04-northern, 12-chart-title); this is generalization, not a
missing-class fix.

#### Gate 2 — known challenge (after Gate 1)

`run.py --offline --conservative --adapter-path out/adapter-gen`

`[V]` **fail usefulness.** Parse 17/17. Unsafe **0** (was 5). Heading exact
**7/11** (need ≥9/11). Same 7/11 as this conservative base; not a
usefulness win vs Arm A (8/11) or E (8/11). Safety *does* beat A and E.

| id | expect | base (conservative) | adapter | notes |
|---|---|---|---|---|
| 01-h1 | H1 | H1 | H1 | |
| 01-h2-throughput | H2 | H2 | H2 | |
| 01-h3-regional | H3 | H3 | H3 | italic H3 held |
| 01-h2-actions | H2 | H2 | H2 | |
| 01-h2-approval | H2 | H2 | H2 | |
| 01-runhead | Artifact | **H1** | Artifact | unsafe cleared |
| 01-runfoot | Artifact | **H1** | Artifact | unsafe cleared |
| 03-h1 | H1 | Table | H1 | heading recovered |
| 03-review-period | P | **H2** | P | unsafe cleared |
| 03-q1 | P | **H1** | P | unsafe cleared |
| 08-h1 | H1 | H1 | H1 | |
| 08-kicker | Artifact | Artifact | P | safe; P vs Artifact |
| 08-numeral-3 | P | **H1** | P | unsafe cleared; digit ornament was a train coverage gap |
| 11-h1-terms | H1 | H1 | **H2** | hierarchy miss; existing `P` |
| 11-h2-eligibility | H2 | H4 | H4 | existing-tag keep-magnet |
| 11-h2-applying | H2 | H4 | H4 | same |
| 11-h2-contact | H2 | H4 | H4 | same |

Net heading_exact stayed 7/11: gained `03-h1`, lost `11-h1-terms`. The
three 11 H2s never moved off H4.

**Classification (not a second train run):**

- 11 H4→should-be-H2: **missing training category**. The train pool has no
  heading whose existing tag is the wrong *heading* level. Spike 2 already
  named `existing_tag: H4` as a keep-magnet. Doc 11 is the challenge set,
  so it was correctly excluded from train.
- 11-h1 P→H2 instead of H1: **represented** (10-h1 is P→H1) but failed.
- 08-kicker Artifact→P: furniture vs cover-subtitle `P` (12-sub). Safe.
  Not scored as unsafe.

Poor challenge heading accuracy is not a mechanical error. No second run.

### Prediction check

1. Unsafe on unseen 07 falls (2 → 0) — **hit**.
2. Heading usefulness on 07 holds (1/1 H1) — **hit**.
3. Probes: unsafe 0 **and** ≥9/11 exact — **miss** (unsafe 0; exact 7/11).
4. 100% parseable `{role,action}` — **hit** (07 6/6, probes 17/17).
5. Dev-corpus gate without vision/confidence/extractor/bigger model — **miss**
   (Gate 2 usefulness).

### ponytail

`train.json` + `valid-07.json` + existing `run.py` + this file. Adapter
under gitignored `out/adapter-gen`. No trainer, no dataset module, no
vision, no Holdout 1 path, no rank sweep, no extra epochs after 7/11.

---

## Stopping (spike 4)

**Fail — challenge usefulness.** Fresh doc 07 is clean and useful. The
frozen probes are now *safe* (0 promotions) but heading exact is 7/11, not
9/11, because doc 11's wrong-level existing tags still win. Holdout 1 is
not earned. Stop. Do not add epochs. Do not inspect Holdout 2. A later
spike may add one targeted train category (wrong-level existing heading
tags) only if that is still the residual after this record; that is not
this spike.

---

## Part 6 — role-only; existing_tag withheld

**Date:** 2026-09-11 · same branch `cursor/qwen35-role-decisions-914b`.
**Status:** measured. Arm B failed usefulness (safety held). Arm C failed
safety (usefulness would have passed). Stop.

Ponytail: one variable. Does the model see `existing_tag` and predict
action, or does it predict semantic role with action derived? Do not add
wrong-tag training data until this is measured. No Holdout 1/2, no vision.

### The one question

> Can the current QLoRA adapter meet the development-corpus safety +
> usefulness gates when `existing_tag` is withheld from the model and
> action is derived deterministically?

### Variable

Arm A (registered reference, **not rerun**): spike 4 `out/adapter-gen`
with `existing_tag` in the prompt and `{role,action}` from the model.

| set | parse | unsafe | heading | exact |
|---|---|---|---|---|
| 07 | 6/6 | 0 | 1/1 | 6/6 |
| probes | 17/17 | 0 | 7/11 | — |

Arm B (this spike): same adapter. Hide `existing_tag`. Ask for `{"role":...}`
only. Ignore any model `action`. Scorer:

`action = "keep" if predicted_role == existing_tag else "retag"`

`existing_tag` remains on the card for the scorer. Current tag is mutation
state, not semantic evidence.

Arm C: earned **only if Arm B fails**. Same frozen 43 train cards, no 07 /
probes / holdouts, no new categories. Role-only input and
`{"role":"<gt>"}` target. Same QLoRA config as spike 4 (`--epochs 6`,
rank 8, batch 1). One run.

### Arm B commands

```
python run.py --offline --role-only --path valid-07.json --adapter-path out/adapter-gen
python run.py --offline --role-only --adapter-path out/adapter-gen
```

### Gates

07: parse 6/6, unsafe 0, H1 exact 1/1, no material regression vs Arm A.

Challenge: parse 17/17, unsafe 0, heading exact ≥ 9/11.

Critical cards, reported individually: `11-h1-terms`,
`11-h2-eligibility`, `11-h2-applying`, `11-h2-contact`. Also confirm
already-correct headings do not break.

Safety remains the hard gate. Do not trade zero-unsafe for hierarchy.

### Registered prediction

1. `[H]` Withholding `existing_tag` does not revive unsafe promotions on 07
   or probes.
2. `[H]` Doc 11's H4 keep-magnet was the current tag in the prompt; Arm B
   predicts H2 on the three H4 cards.
3. `[H]` Already-correct headings stay exact.
4. `[H]` Arm B reaches ≥9/11 heading exact, so Arm C is not earned.

### Win / fail

- **Arm B pass:** STOP. “The current tag was harmful classification
  context. Role prediction should be independent of mutation state; action
  should be derived deterministically. A blind Holdout-1 evaluation bridge
  is now earned.” Do not retrain.
- **Arm B fail, safety holds:** Arm C once, same data, role-only contract.
- **Arm C pass:** STOP. Holdout-1 evaluation earned.
- **Arm C still fails doc-11 hierarchy:** STOP. Only then is targeted
  hierarchy data earned. Do not invent it here.
- **Safety regresses:** STOP. Do not keep a hierarchy gain that costs
  unsafe promotions.

### Measurements

Arm B generate used the already-committed `--role-only` path. Adapter
`out/adapter-gen` was not retrained. Logs: `out/armb-07.jsonl`,
`out/armb-probes.jsonl` (gitignored).

#### Arm B — Gate 1, fresh 07

`run.py --offline --role-only --path valid-07.json --adapter-path out/adapter-gen`

`[V]` **fail usefulness.** Parse 6/6. Unsafe **0**. Role accuracy **5/6**.
Derived-action accuracy **5/6**. Heading exact **0/1** (need 1/1). Material
regression vs Arm A: the only true heading (`07-h1`, existing `H1`) predicted
**H2**, so derived action was `retag` instead of `keep`. The five traps stayed
`P`. Safety held. Do not trade that for hierarchy.

| id | expect | exist | Arm A | Arm B role | derived |
|---|---|---|---|---|---|
| 07-h1 | H1 keep | H1 | H1 keep | **H2** | retag |
| 07-intro | P keep | P | P keep | P | keep |
| 07-chart-title | P retag | none | P retag | P | retag |
| 07-northern | P retag | none | P retag | P | retag |
| 07-q1 | P retag | none | P retag | P | retag |
| 07-cap | P keep | P | P keep | P | keep |

Confusion: `H1→H2` 1. No action-ok / role-wrong rows on this set.

#### Arm B — Gate 2, known challenge

`run.py --offline --role-only --adapter-path out/adapter-gen`

`[V]` **fail usefulness.** Parse 17/17. Unsafe **0**. Role accuracy **11/17**.
Derived-action accuracy **15/17**. Heading exact **6/11** (need ≥9/11; Arm A
was 7/11). Safety held. Four rows are action-ok with the wrong role — a
correct derived `retag` does not conceal those misses.

| id | expect | exist | Arm A | Arm B | notes |
|---|---|---|---|---|---|
| 01-h1 | H1 | H1 | H1 | H1 | held |
| 01-h2-throughput | H2 | H2 | H2 | H2 | held |
| 01-h3-regional | H3 | H3 | H3 | **P** | already-correct broke |
| 01-h2-actions | H2 | H2 | H2 | **P** | already-correct broke |
| 01-h2-approval | H2 | H2 | H2 | H2 | held |
| 01-runhead | Artifact | none | Artifact | Artifact | |
| 01-runfoot | Artifact | none | Artifact | Artifact | |
| 03-h1 | H1 | H1 | H1 | H1 | held |
| 03-review-period | P | TH | P | P | |
| 03-q1 | P | TH | P | P | |
| 08-h1 | H1 | none | H1 | H1 | |
| 08-kicker | Artifact | none | P | P | action-ok, role-wrong |
| 08-numeral-3 | P | P | P | P | |
| 11-h1-terms | H1 | P | H2 | **H2** | still wrong |
| 11-h2-eligibility | H2 | H4 | H4 | **H2** | keep-magnet broke |
| 11-h2-applying | H2 | H4 | H4 | **P** | not H4, not H2 |
| 11-h2-contact | H2 | H4 | H4 | **P** | not H4, not H2 |

Critical cards:

- `11-h1-terms`: expected H1, predicted H2 (same as Arm A).
- `11-h2-eligibility`: expected H2, predicted H2 (Arm A kept H4).
- `11-h2-applying`: expected H2, predicted P.
- `11-h2-contact`: expected H2, predicted P.

Already-correct headings that broke: `07-h1`, `01-h3-regional`,
`01-h2-actions`.

Confusion (gt→pred, misses only): `H2→P` 3, `Artifact→P` 1, `H1→H2` 1,
`H3→P` 1.

Hiding the tag did not revive unsafe promotions. It did move one of three
H4 keep-magnets onto H2. It did not reach 9/11, and it demoted headings the
same adapter had right when the tag was visible. This adapter was trained
with `existing_tag` in the prompt and `{role,action}` completions, so Arm C
is earned. Safety did not regress, so the retrain is allowed.

#### Prediction check (Arm B)

1. Withholding `existing_tag` does not revive unsafe promotions — **hit**.
2. Doc 11 H4 keep-magnet was the tag; Arm B predicts H2 on the three H4
   cards — **partial miss** (eligibility H2; applying/contact P).
3. Already-correct headings stay exact — **miss**.
4. Arm B reaches ≥9/11 so Arm C is not earned — **miss**; Arm C is earned.

#### Arm C — one retrain (earned because Arm B failed)

Same frozen `train.json` (43 cards, docs 02/04/05/06/10/12). No 07, no
probes, no holdouts, no wrong-tag examples. SFT via `python -c` using
`ROLE_ONLY_STEM` and `card_prompt(..., hide_existing_tag=True)`. Completions
`{"role":"<gt>"}` only. Paths `out/gen-sft-role` and `out/adapter-role`
(gitignored) so `out/adapter-gen` stays the Arm A reference.

```
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset out/gen-sft-role \
  --split train \
  --batch-size 1 \
  --lora-rank 8 \
  --epochs 6 \
  --steps-per-report 10 \
  --steps-per-save 1000 \
  --train-on-completions \
  --output-path out/adapter-role
```

`[V]` One run. `TRAIN_EXIT:0`. Iterations **258**. Learning rate `2.000e-05`.
`#trainable params: 16.232448 M || all params: 4539.264 M || trainable%: 0.358%`.
Language-side LoRA, rank 8, no vision. Loss 0.296 → **0.000178**. Peak mem
9.707 GB. Trained tokens 45,114 (spike 4 was 56,946; completions are shorter
because they no longer carry `action`). Adapter 62 MiB. `adapter-gen`
untouched.

Eval, in order, deriving action as in Arm B. Logs: `out/armc-07.jsonl`,
`out/armc-probes.jsonl`.

#### Arm C — Gate 1, fresh 07

`run.py --offline --role-only --path valid-07.json --adapter-path out/adapter-role`

`[V]` **pass.** Parse 6/6. Unsafe **0**. Role accuracy **6/6**. Derived-action
accuracy **6/6**. Heading exact **1/1**. No material regression vs Arm A.
The H1 Arm B demoted is H1 again.

| id | expect | exist | Arm A | Arm B | Arm C |
|---|---|---|---|---|---|
| 07-h1 | H1 keep | H1 | H1 | **H2** | H1 |
| 07-intro | P keep | P | P | P | P |
| 07-chart-title | P retag | none | P | P | P |
| 07-northern | P retag | none | P | P | P |
| 07-q1 | P retag | none | P | P | P |
| 07-cap | P keep | P | P | P | P |

#### Arm C — Gate 2, known challenge

`run.py --offline --role-only --adapter-path out/adapter-role`

`[V]` **fail safety.** Parse 17/17. Heading exact **10/11** (meets ≥9/11).
Role accuracy **14/17**. Derived-action accuracy **15/17**. Unsafe **1**
(was 0). Usefulness would have passed. Safety is the hard gate, so the arm
fails. Do not keep the hierarchy gain.

| id | expect | exist | Arm A | Arm B | Arm C | notes |
|---|---|---|---|---|---|---|
| 01-h1 | H1 | H1 | H1 | H1 | H1 | held |
| 01-h2-throughput | H2 | H2 | H2 | H2 | H2 | held |
| 01-h3-regional | H3 | H3 | H3 | **P** | H3 | Arm B break restored |
| 01-h2-actions | H2 | H2 | H2 | **P** | H2 | Arm B break restored |
| 01-h2-approval | H2 | H2 | H2 | H2 | H2 | held |
| 01-runhead | Artifact | none | Artifact | Artifact | Artifact | |
| 01-runfoot | Artifact | none | Artifact | Artifact | Artifact | |
| 03-h1 | H1 | H1 | H1 | H1 | **H2** | only heading miss |
| 03-review-period | P | TH | P | P | P | |
| 03-q1 | P | TH | P | P | P | |
| 08-h1 | H1 | none | H1 | H1 | H1 | |
| 08-kicker | Artifact | none | P | P | P | action-ok, role-wrong |
| 08-numeral-3 | P | P | P | P | **H1** | **unsafe**; 34pt digit |
| 11-h1-terms | H1 | P | H2 | H2 | **H1** | |
| 11-h2-eligibility | H2 | H4 | H4 | H2 | **H2** | |
| 11-h2-applying | H2 | H4 | H4 | P | **H2** | |
| 11-h2-contact | H2 | H4 | H4 | P | **H2** | |

Critical cards (all four exact under Arm C):

- `11-h1-terms`: expected H1, predicted H1.
- `11-h2-eligibility`: expected H2, predicted H2.
- `11-h2-applying`: expected H2, predicted H2.
- `11-h2-contact`: expected H2, predicted H2.

Already-correct headings: Arm B's two 01 breaks returned. `07-h1` returned.
`03-h1` is the new heading miss (H1→H2, derived `retag`).

Confusion (gt→pred, misses only): `Artifact→P` 1, `H1→H2` 1, `P→H1` 1.
Action-ok / role-wrong: `08-kicker` only. `08-numeral-3` is not in that
bucket: derived `retag` is the wrong mutation *because* the role is wrong.

The H4 keep-magnet is gone on this adapter. Doc-11 hierarchy is not the
residual. The residual is the digit ornament spike 4 had already cleared
(`08-numeral-3`, existing `P`, 34pt bold `"3"`). Arm B hid the tag on the
*same* spike-4 adapter and still predicted `P`, so inference-time
`existing_tag` is not what refuses this trap. The unsafe promotion appears
only after the role-only retrain. The training contract change is the
variable that revived it.

Targeted H4-vs-H2 training data is **not** earned: the four critical cards
are exact. Holdout 1 is **not** earned: safety failed. No second retrain.

### Prediction check (this spike)

1. Withholding `existing_tag` does not revive unsafe promotions — **hit on
   Arm B, miss on Arm C** (08-numeral-3).
2. Doc 11 H4 keep-magnet was the tag; Arm B predicts H2 on the three H4
   cards — **partial miss on B**; **hit on C** (all three H2, and the H1).
3. Already-correct headings stay exact — **miss on B**; **partial on C**
   (`03-h1` H1→H2).
4. Arm B reaches ≥9/11 so Arm C is not earned — **miss**; Arm C was earned
   and then failed the safety gate.

### ponytail

`run.py --role-only` (already committed before Arm B generate) + this file.
SFT emitted with `python -c` from frozen `train.json`. One upstream
`mlx_vlm.lora` into gitignored `out/adapter-role`. No trainer, no dataset
module, no vision, no Holdout 1 path, no rank sweep, no wrong-tag examples,
no second retrain after the unsafe promotion.

---

## Stopping (spike 6)

**Fail — safety on Arm C.** The cheaper hypothesis is only half-true.

Arm B: hiding the current tag from the tag-trained adapter does **not**
meet the gates. Usefulness fell. Safety held. The adapter was using
`existing_tag`.

Arm C: training the same 43 cards as a role classifier, with action derived,
clears doc 11 (10/11 heading exact, all four critical cards) and restores
fresh 07, **and** promotes `08-numeral-3` to H1. Zero-unsafe is the hard
gate. Do not trade it for hierarchy.

`existing_tag` is mutation state, not semantic evidence. Withholding it at
inference (Arm B) does not meet the gates. Retraining without it (Arm C)
clears the hierarchy the tag had magnetized and fails safety on a trap the
tag-trained adapter refused even when the tag was hidden. Adding H4-vs-H2
examples would climb a rung that already held. Stop.

Holdout 1 is not earned. Do not inspect Holdout 2. A later spike may ask
what information besides the current tag distinguishes a true heading from
a digit ornament; that is not this spike.

---

## Part 7 — R2 ornament veto around role-only QLoRA

**Date:** 2026-09-11 · same branch `cursor/qwen35-role-decisions-914b`.
**Status:** measured. Gates A, B, C pass. Stop. Holdout-1 evaluation
earned, not built.

Ponytail: the residual is one known ornament class. Test the existing
deterministic exclusion before teaching the model. No retrain, no new
examples, no Holdout 1/2, no vision, no rule engine.

### Trace (before any hybrid code)

`experiments/document-remediation/Headings.java`, comment R2 NO LETTERS
(lines 41–42) and the predicate at line 220:

```
boolean noLetters = !t.chars().anyMatch(Character::isLetter);
```

`t` is `StructText.of(el)` — the element's text. Not font size. Not the
current tag, except that Headings.java only *walks* current H1–H6 (it is a
demotion pass). Empty text is skipped (`if (t.isEmpty()) continue`). A match
is demoted with `setStructureType("P")`. Designed for corpus `08-slide-layout`
decorativeGraphics "large numerals 1/2/3"; the probe card is `08-numeral-3`
(`"3"`, 34pt, existing `P`).

It is **not** `text.isdigit()`. `"Q1"` (07-q1, 03-q1, train 12-q1) contains a
letter and must not match. Invoking the Java stage needs a tagged PDF; the
cards already carry the text, so the experiment copies the one-line
predicate. Provenance: `Headings.java:220`. Python `str.isalpha()` stands in
for `Character.isLetter` on this Latin-script corpus.

Headings.java would not fire on `08-numeral-3` as tagged today, because the
element is already `P`. The hybrid uses the same *text* predicate as a
**promotion veto**: letter-less text is not a heading, so Qwen is not allowed
to make it one. Restricting the veto to current H* would miss the unsafe
case this spike exists to stop.

### The one question

> Is the smallest safe system now QLoRA + one already-existing deterministic
> exclusion?

### Architecture (registered)

1. Evaluate R2 on card `text`.
2. If it matches: `final_role = P`. Still call Qwen; keep `model_role`.
3. Else: `final_role = model_role` from `out/adapter-role` (role-only,
   `existing_tag` withheld).
4. `action = "keep" if final_role == existing_tag else "retag"`.

R2 is a narrow veto, not a second classifier. Scoring uses `final_role`.
A vetoed row reports both roles; do not pretend Qwen predicted `P`.

### Not doing

No retrain, no new cards, no counterfactual augmentation, no Holdout 1/2,
no vision, no prompt tuning, no extractor, no SafetyPolicy / RuleEngine,
no `src/` wiring. Do not retune R2 against individual examples.

### Gate A — predicate scope (no model)

Apply the frozen predicate to every card in `train.json`, `valid-07.json`,
and `probes.json`. Record every match. Hard requirement: zero true headings
(`expect.role` in H1–H6 and not a trap). If a true heading matches → STOP.

### Gate B — hybrid, fresh 07

```
python run.py --offline --role-only --r2-veto --path valid-07.json --adapter-path out/adapter-role
```

Must stay parse 6/6, unsafe 0, role 6/6, heading 1/1. If R2 changes a
correct 07 decision → STOP.

### Gate C — hybrid, frozen probes

```
python run.py --offline --role-only --r2-veto --adapter-path out/adapter-role
```

Must reach complete 17/17, unsafe 0, heading exact ≥ 9/11. Critical card
`08-numeral-3`: report R2, `model_role`, `final_role`, derived action.
Confirm the four doc-11 cards and `01-h3-regional` / `01-h2-actions` stay
exact, and no previously safe non-heading becomes an H* retag.

### Registered prediction

1. `[H]` Existing R2 matches `08-numeral-3`.
2. `[H]` Existing R2 matches no known true heading in the exposed
   development corpus.
3. `[H]` Fresh doc 07 remains 6/6 with unsafe 0.
4. `[H]` Frozen probes reach unsafe 0 while retaining 10/11 heading exact.
5. `[H]` No additional training, vision, or model capacity is required to
   pass the development gate.

### Win / fail

- **Win:** Gate A zero true headings, 07 preserved, probes unsafe 0 and
  heading exact ≥ 9/11. STOP. Conclusion: the smallest passing development
  architecture is role-only QLoRA plus the existing R2 ornament veto, with
  action derived. A minimal Holdout-1 evaluation bridge is then earned —
  not built here.
- **R2 hits a true heading:** STOP. Veto not earned. Do not tune.
- **R2 misses `08-numeral-3`:** STOP. Do not invent a replacement rule.
- **Numeral fixed, another unsafe appears:** STOP. Report it. Do not stack
  another heuristic.
- **Safety passes, heading exact < 9/11:** STOP. Do not sacrifice hierarchy.

### Measurements

Adapter `out/adapter-role` was not retrained. Predicate is
`r2_ornament` in `run.py` (`Headings.java:220`). Logs: `out/r2-07.jsonl`,
`out/r2-probes.jsonl`.

#### Gate A — predicate scope (no model)

`[V]` **pass.** Zero true headings matched.

| set | cards | true headings | R2 matches | heading hits |
|---|---|---|---|---|
| train.json (02/04/05/06/10/12) | 43 | 22 | 0 | 0 |
| valid-07.json | 6 | 1 | 0 | 0 |
| probes.json | 17 | 11 | 1 | 0 |

The one match: `08-numeral-3`, text `"3"`, GT `P`, existing `P`, trap
heading. Vetoing heading promotion is correct.

`Q1` (train 12-q1, `07-q1`, `03-q1`) did not match — R2 is no letters, not
isdigit. `07-h1` "Throughput Trend Analysis" did not match.

#### Gate B — hybrid, fresh 07

`run.py --offline --role-only --r2-veto --path valid-07.json --adapter-path out/adapter-role`

`[V]` **pass.** Parse 6/6. Unsafe **0**. Role exact **6/6**. Derived-action
**6/6**. Heading exact **1/1**. Every `r2_veto` is false. R2 changed no 07
decision. Spike 6 preserved.

#### Gate C — hybrid, frozen probes

`run.py --offline --role-only --r2-veto --adapter-path out/adapter-role`

`[V]` **pass.** Parse 17/17. Unsafe **0** (was 1). Role exact **15/17**.
Derived-action **16/17**. Heading exact **10/11**. Gates `pass: true`.

The only row that moved vs spike-6 adapter-alone is `08-numeral-3`.

Critical card `08-numeral-3`:

| | |
|---|---|
| R2 | match (no letters) |
| Qwen `model_role` | **H1** (still wrong) |
| hybrid `final_role` | **P** |
| derived action | keep (`P` == existing `P`) |
| unsafe | false |

The model is still wrong. The safety layer prevented application.

| id | expect | exist | spike 6 | hybrid | notes |
|---|---|---|---|---|---|
| 01-h1 | H1 | H1 | H1 | H1 | |
| 01-h2-throughput | H2 | H2 | H2 | H2 | |
| 01-h3-regional | H3 | H3 | H3 | H3 | held |
| 01-h2-actions | H2 | H2 | H2 | H2 | held |
| 01-h2-approval | H2 | H2 | H2 | H2 | |
| 01-runhead | Artifact | none | Artifact | Artifact | |
| 01-runfoot | Artifact | none | Artifact | Artifact | |
| 03-h1 | H1 | H1 | H2 | H2 | only heading miss; unchanged |
| 03-review-period | P | TH | P | P | |
| 03-q1 | P | TH | P | P | letter present; R2 silent |
| 08-h1 | H1 | none | H1 | H1 | |
| 08-kicker | Artifact | none | P | P | action-ok, role-wrong |
| 08-numeral-3 | P | P | **H1** unsafe | **P** (veto; model H1) | |
| 11-h1-terms | H1 | P | H1 | H1 | |
| 11-h2-eligibility | H2 | H4 | H2 | H2 | |
| 11-h2-applying | H2 | H4 | H2 | H2 | |
| 11-h2-contact | H2 | H4 | H2 | H2 | |

All four doc-11 cards remain exact. No previously safe non-heading became
an H* retag.

### Prediction check

1. Existing R2 matches `08-numeral-3` — **hit**.
2. Existing R2 matches no known true heading — **hit**.
3. Fresh doc 07 remains 6/6 with unsafe 0 — **hit**.
4. Frozen probes reach unsafe 0 while retaining 10/11 heading exact — **hit**.
5. No additional training, vision, or model capacity — **hit**.

### ponytail

One predicate in `run.py`, provenance `Headings.java:220`. `--r2-veto`
keeps `model_role`. No RuleEngine, no retrain, no new cards, no Holdout 1
extractor, no `src/` wiring.

---

## Stopping (spike 7)

**Pass.** The smallest passing development architecture is a role-only
QLoRA classifier plus the existing R2 ornament veto, with mutation action
derived deterministically.

The model is useful but not independently safe; one pre-existing
deterministic exclusion handles a known class better.

A minimal blind Holdout-1 evaluation bridge is now earned. Do not build
it in this spike. Do not retrain. Do not inspect Holdout 2.

---

## Part 8 — Blind Holdout 1 through a real PDF bridge (pre-registration)

**Date:** 2026-09-11 · same branch. Adapter `out/adapter-role` is not
retrained. Holdout 2 stays sealed.

### The one question

> Does the frozen role-only QLoRA + R2 hybrid remain safe and useful on
> blind Holdout 1 when driven from real PDF extraction rather than
> hand-authored development cards?

This spike may build only the minimum evaluation bridge. No production
tagger, no `src/` wiring, no new veto, no vision, no retrain.

### What Qwen actually receives

Traced from `card_prompt()` with `hide_existing_tag=True` (`--role-only`):

1. `ROLE_ONLY_STEM`
2. `Element: {text!r}`
3. `Font: {font_pt}pt`
4. `Weight: {weight}`
5. `Previous: {prev}`
6. `Next: {next}`
7. `JSON:`

Not sent: `existing_tag`, `page`, `y_band`, confidence. R2 and derived
action still read `text` and `existing_tag` outside the prompt.

`font_pt` and `weight` were in the training cards. They are not optional.
A missing font is a **bridge failure**, never a fabricated 12pt.

### Real PDF path vs those fields

Chromium `page.pdf()` emits untagged PDFs. The existing experiment tagger
(`@opendataloader/pdf` via `run-opendataloader.mjs`) writes a structure
tree. `Inspect.order` then walks BLOCK types (`H1`–`H6`, `P`, `Figure`,
`Table`, `L`, `LI`, `Caption`, `Formula`) — TH/TD are not in that set.

| classifier field | PDF path |
|---|---|
| target text | glyphs under the structure element. `StructText.of` joins one-letter MCIDs with spaces, which is unusable as prompt text. `Cards.java` re-reads the same `TextPosition` stream and inserts a space at an x-gap > 0.12em or a line change (letter gaps measured ≈0, word gaps ≈0.19em on tagged 01). |
| prev / next | previous / next **usable** BLOCK card in the same PDF, after empty-text / missing-font rows are dropped. `"none"` at the ends. |
| font_pt | `TextPosition.getFontSizeInPt()` of the first glyph, rounded. PDF points, not the CSS sizes on the hand cards. |
| weight | font name contains `"bold"` after subset-tag strip — `Tables.java:365`. |
| existing_tag | structure type through the RoleMap (scorer / action only). |
| locator | `{stem}:{orderIndex}` in `StructText.find` / Inspect-order. |

Candidate universe is label-independent: every Inspect-order BLOCK
element. Empty text or missing font → `bridge_failures.json`, not a
model abstention.

### Frozen command

**Frozen at `e961473`.** Adapter `out/adapter-role` was not retrained.

```
python run.py --dump-dir <odl-tagged-pdfs> --out-dir <out> \
  --predict --offline --role-only --r2-veto --adapter-path out/adapter-role
```

Then, after predictions are hashed and labels opened:

```
python run.py --score-holdout <out>/predictions.jsonl --gt-dir <holdout>
```

Scoring matches `headingHierarchy` by `compare.mjs` `norm` (lower, strip
non-alnum). Unsafe = GT non-heading whose `final_role` is H1–H6 **and**
`derived_action` is `retag`. R2 remains `r2_ornament` / Headings.java:220.

Generation settings unchanged: `mlx_vlm.generate`, temperature 0,
`--max-tokens 256`, thinking disabled, no image.

### Gate B — bridge fidelity (exposed 01, 03, 08, 11; 07 tagged not scored)

ODL-tagged copies: `experiments/document-remediation/out/bridge-tagged/`.
Dump + match: `run.py --from-blocks out/bridge-dev/blocks.json --match-probes`.
Hybrid log: `out/bridge-dev/hybrid.jsonl`.

`[V]` All 17 known critical cases located. Two empty-text figures reported
as bridge failures (`08-slide-layout:4`, `11-deliberately-inaccessible:10`).

```
python run.py --from-blocks out/bridge-dev/blocks.json --out-dir out/bridge-dev \
  --match-probes --offline --role-only --r2-veto --adapter-path out/adapter-role
```

`[V]` **pass.** Parse 17/17. Unsafe **0**. Heading exact **10/11**. Gates
`pass: true`. `08-numeral-3`: R2 match, `model_role` H1, `final_role` P.
All four doc-11 cards exact.

| id | PDF text | exist | hybrid | notes |
|---|---|---|---|---|
| 01-h1 | Quarterly Operations Summary | H1 | H1 | font 26 vs card 20 |
| 01-h2-throughput | Throughput | H2 | H2 | |
| 01-h3-regional | Regional detail | H3 | **H2** | only heading miss |
| 01-h2-actions | Actions carried forward | H2 | H2 | |
| 01-h2-approval | Approval sequence | H2 | H2 | |
| 01-runhead | Northwind Logistics · Internal · Page 1 of 1 | P | Artifact | |
| 01-runfoot | …Prepared 2026-08-23… | P | Artifact | |
| 03-h1 | Depot Throughput by Quarter | H1 | **H1** | was H2 on hand cards |
| 03-review-period | Review period | P | P | ODL tagged P, not TH |
| 03-q1 | Q1 | P | P | |
| 08-h1 | Coastal: three ways forward | H1 | H1 | |
| 08-kicker | Board discussion · not for circulation | P | P | |
| 08-numeral-3 | 3 | **H1** | **P** (R2; model H1) | ODL already H1 |
| 11-h1-terms | Terms of Access | H1 | H1 | ODL already H1, not P |
| 11-h2-eligibility | Eligibility | H2 | H2 | ODL already H2, not H4 |
| 11-h2-applying | Applying | H2 | H2 | |
| 11-h2-contact | Contact | H2 | H2 | |

Hard development-bridge gate held. Do not touch Holdout 1 until this
section is committed.

### Holdout-1 gates (pre-registered; not yet run)

Format / execution

- a decision for every selected evaluable candidate
- 100% parseable model output where Qwen is invoked
- `model_role` / `r2_match` / `final_role` recorded distinctly
- bridge failures reported separately, never as abstention

Safety — hard

After predictions are frozen and ground truth is revealed: **zero**
ground-truth non-headings may end with final role H1–H6 and derived
action `retag`. Record model-only unsafe separately from final hybrid
unsafe.

Usefulness

- GT headings: exact heading-level accuracy ≥ 80% (numerator/denominator)
- also report heading detection ignoring level
- predicting no headings must not pass

R2

Unchanged. Record every Holdout-1 match. A true-heading collision fails
the hybrid. Do not retune.

### Registered prediction

1. `[H]` The real PDF path can reproduce the inputs required by the frozen
   classifier without a general extraction subsystem.
2. `[H]` The PDF-derived bridge preserves the passing development result.
3. `[H]` The frozen hybrid produces zero unsafe promotions on blind
   Holdout 1.
4. `[H]` Exact heading-level accuracy on Holdout 1 is ≥80%.
5. `[H]` R2 causes no true-heading collision.
6. `[H]` No retraining, vision, new veto, or larger model is required.

### Win / fail

- **PASS:** zero final unsafe, ≥80% heading exact, no R2 true-heading
  collision, parse coverage complete. STOP. Conclusion: the frozen hybrid
  passed blind Holdout 1 and is load-bearing enough to earn a minimal
  production integration experiment. Do not build that experiment here.
  Do not inspect Holdout 2.
- **FAIL — bridge:** STOP. Representation/extraction, not model tuning.
- **FAIL — safety:** STOP. Classify the failure. Do not add a veto.
- **FAIL — usefulness:** STOP. Report the confusion pattern. Do not tune
  on Holdout 1.
- **R2 hits a true heading:** STOP. Do not repair it against Holdout 1.

Holdout 1 becomes spent evidence once scored. One blind run.

### Measurements (one blind run, after freeze)

Predictions frozen before labels were opened.

| | |
|---|---|
| freeze commit (bridge + gates) | `e961473` |
| hash recorded | `8dc6db1` |
| predictions SHA-256 | `4ec2198a7216d979edd1e5e20deda5ee07f1a819e95c47ec970a4568deb4fe17` |
| path | gitignored `experiments/qwen-role-decisions/out/h1/predictions.frozen.jsonl` |
| command | `run.py --dump-dir out/holdout-tagged --out-dir out/h1 --predict --offline --role-only --r2-veto --adapter-path out/adapter-role` |

ODL tagged 16/16 Holdout-1 PDFs. Cards.java selected 444 evaluable BLOCK
elements. Bridge failures: 3 empty-text figures on `h04` (not abstentions).
Parse **444/444**. Derived action **444/444** (deterministic). No GT fields
in the prediction artifact.

#### Execution

A decision for every evaluable candidate. `model_role` / `r2_match` /
`final_role` distinct. Bridge failures reported separately.

#### Safety — **fail** (hard gate)

Final unsafe promotions: **17**. Model-only unsafe: **18**. R2 prevented
one (`h01-big-text-not-heading:7`, text `£680`, model H2 → final P).

| locator | text | exist | model | final | class |
|---|---|---|---|---|---|
| h05:0,7,8,11 | `R` / `e` / `R` / `y` | Figure | H1/H2 | same | extraction: logo glyphs as text; R2 silent (they are letters) |
| h14:4 | `R` | Figure | H2 | H2 | same Figure-letter leak |
| h06:14 | Depot Staff Vehicles | P | H2 | H2 | table header row (represented in train 03; model failed) |
| h07:3 | Depot | P | H2 | H2 | table header cell |
| h07:6–9 | `H1` / `H2` / `H1` / `H2` | P | H2 | H2 | three-level table headers whose *text* is the token H1/H2 |
| h08:3,120 | Registration | P | H2 | H2 | repeating table column header across pages |
| h09:8 | Notice to berth holders… | P | H2 | H2 | spanning banner; needs layout |
| h11:4 | Berth Occupancy by Month | H1 | H2 | H2 | chart title (doc attack: chart labels as headings) |
| h11:7 | Month of year | P | H2 | H2 | chart axis label |
| h13:1 | COMMERCIAL IN CONFIDENCE | H2 | H1 | H1 | classification stamp above the real H1 |

Five of seventeen are single-letter Figure leftovers. Eight are table
headers ODL emitted as `P`. Two are chart furniture. One is a banner. One
is a stamp. None is the letter-less ornament R2 covers.

Do not add a veto in this spike.

#### Usefulness (would have passed if safety had)

GT headings **43/51** exact (84%). Detection **47/51**. Demotions **0**.
Hierarchy confusions **4**: h02 H1→H2; h12 Purpose H2→H1; h16
Discrepancies H3→H2; h16 Segregation H3→H2. Unmatched **4**, all h02
body-sized headings: ODL merged each heading with the following sentence
into one `P`, so no card existed to score (bridge miss, not a model
abstention). Predicting-no-headings did not occur.

Final role **422/444**. R2 matches **152**, **0** true-heading collisions
(almost all `h08` table numbers).

#### Prediction check

1. Real PDF path reproduces required inputs — **hit** (on development;
   Holdout 1 dump also emitted font/weight/text/neighbors).
2. Bridge preserves development result — **hit** (10/11, unsafe 0).
3. Zero unsafe on Holdout 1 — **miss**.
4. Heading exact ≥80% — **hit** (43/51).
5. R2 no true-heading collision — **hit**.
6. No retrain / vision / new veto / larger model — **hit** (none added).

### ponytail

Cards.java + `run.py --dump-dir/--predict/--score-holdout`. No production
tagger, no `src/` wiring, no new veto, adapter untouched. Holdout 2 not
opened.

---

## Stopping (spike 8)

**FAIL — safety.** The frozen Qwen3.5-4B role-only QLoRA + R2 hybrid did
not remain safe on blind Holdout 1 when driven from real PDF extraction.

Usefulness and R2's no-letter predicate both held. Safety did not. The
17 unsafe retags are not the development numeral class: they are figure
glyph leaks, table headers, chart furniture, a spanning banner, and a
classification stamp.

Holdout 1 is spent. Do not retrain against it. Do not add another veto
in this spike. Do not inspect Holdout 2.

---

## Part 9 — Structural heading eligibility (pre-registration)

**Date:** 2026-09-11 · same branch. ML freeze unchanged: Qwen3.5-4B 4-bit,
`out/adapter-role`, role-only prompt, R2, derived action, no vision.
Holdout 1 predictions remain immutable (`4ec2198a…`). Holdout 2 sealed.

### The one question

> Can existing PDF structure and existing remediation rules define a
> narrow heading-eligibility boundary that removes the unsafe classes
> without changing the QLoRA adapter?

Candidate-scope / structural safety. Not a training spike.

### Inventory (completed before any new predicate)

Headings.java is **demotion-only**. Rules: R1 length, R2 no letters (frozen
in `r2_ornament`), R3 page-marker regex, R4 caption-text, R5 geometric
table containment (`belongsToTable` on boxes, not parent pointers), R6
short following paragraph, R7 nothing after, R8 restore hierarchy.
`PDStructureElement.getParent()` already exists (Tables.java / Figures.java
removeKid). `StructText.find` does not expose the parent. Cards.java
currently throws parent types away.

| H1 failure class | existing evidence |
|---|---|
| Figure glyph leaks (5) | `existing_tag == Figure`, parent `Document` |
| table headers (h07, h08) | `getParent` chain `P → TD → TR → Table` |
| h06 "Depot Staff Vehicles" | **not** under a Table — ODL left the unruled grid as Document-level `P` |
| chart furniture (h11) | **no Figure** — SVG text, same hole Headings.java R5 recorded for doc 07 |
| spanning banner (h09) | Document-level `P`; R1 length would describe it as a body paragraph |
| classification stamp (h13) | already `H2`; no Headings rule names stamps (R3 is page markers only) |

True-heading source types on hand-authored train/07/probes, spent H1 GT
matches, and tagged development 01: **never** Figure, Table, L, LI,
Caption, or Formula. Those types are outside the heading-promotion
domain. `none` / `P` / `H1`–`H6` remain in-domain (`H*` because wrong
headings must stay demotable).

FINDING NOT PURSUED — candidate segmentation/merge (h02's four unmatched
headings). Do not change ODL in this spike.

### Architecture (registered)

`existing_tag` still withheld from Qwen. It may participate in **scope**.

Ladder; stop at the first rung that holds.

**Arm A — source type.** `Figure`, `Table`, `L`, `LI`, `Caption`,
`Formula` are not eligible for H1–H6 promotion. Preserve the existing
non-heading type; do not call Qwen. `P` / `none` / `H1`–`H6` still go to
the frozen hybrid.

**Arm B — Table/Figure ancestry.** Only if A leaves unsafe cases. Walk
`getParent()`; if any ancestor is `Table` or `Figure`, the text is not a
document heading. Do not teach Qwen table strings.

**Arm C — existing Headings.java rule.** Only if residual remains. Use a
rule that already describes the mechanism. Do not add all-caps, banner
regexes, or font-size gates.

### Frozen ML

No change to adapter, prompt, R2, generation, or action derivation.

### Gates

Development (tuning/regression): train, 07, probes, real-PDF bridge of
development docs. Holdout 1: spent diagnostic only; not a second test.

Hard, before Holdout 2 can be earned:

- zero final unsafe H* promotions on that exposed universe
- no structural gate blocks a known true heading
- development heading usefulness still ≥ 9/11 (probes) / 6/6 (07)
- PDF bridge still emits a decision for every evaluable candidate

Report Qwen calls avoided. Bonus, not the win.

### Registered prediction

1. `[H]` The five Figure-letter failures disappear by restricting heading
   promotion to structurally eligible source types.
2. `[H]` Existing Table/Figure ancestry eliminates most table/chart-furniture
   unsafe promotions.
3. `[H]` These structural gates collide with zero known true document headings.
4. `[H]` Heading usefulness remains materially unchanged because Qwen still
   handles genuine document-flow candidates.
5. `[H]` At most one residual failure class remains after existing structural
   evidence is used.
6. `[H]` No retraining, new model, vision, or bespoke rule engine is required.

### Win / fail

- **Win:** A or A+B (or A+B plus one existing Headings rule) yields zero
  exposed unsafe, zero true-heading collisions, usefulness holds. STOP.
  Holdout 2 is then earned — not run here.
- **Source-type or ancestry gate hits a true heading:** STOP that rung.
- **Banner/stamp remain after existing rules:** STOP. Residual earns a
  later layout spike. Do not stack heuristics.
- **Usefulness collapses:** STOP.

### Measurement (2026-09-11)

ML freeze unchanged. Holdout 1 predictions not regenerated
(`4ec2198a…` still matches `out/h1/predictions.frozen.jsonl`). Cards.java
now emits `ancestors` via `el.getParent()`. Rescore joins that dump onto
the frozen rows and reapplies R2 + derived action. Holdout 2 untouched.

True-heading source types, confirming the registered domain: matched GT
headings on spent H1 are only `P` / `H1`–`H4`; every matched heading's
ancestor tuple is `('Document',)`. Hand-card true headings in
`train.json` / `valid-07.json` / `probes.json` are `P` / `none` /
`H1`–`H4`. Tagged development 01/03/07/08/11 heading probes are Document
`H*`. **None** of Figure, Table, L, LI, Caption, Formula. **None** inside
a Table or Figure.

#### Arm A — source type (spent H1 diagnostic)

Out-of-flow types preserve their existing non-heading role; Qwen is not
called. `P` / `none` / `H*` still go to the frozen hybrid.

`[V]` parse 444/444. Final unsafe **12** (was 17). Heading exact **43/51**.
Detection 47/51. Demotions **0**. True-heading collisions **0**. Qwen
calls avoided **21** (11 Figure, 6 Caption, 4 Table).

The five Figure-letter leaks (`h05:0,7,8,11`, `h14:4`) become `final_role
= Figure`, `derived_action = keep`. Model still said H1; the architecture
does not apply it.

Does not pass the hard safety gate. Continue.

#### Arm B — Table/Figure ancestry (spent H1 diagnostic)

A+B. Text whose parent walk contains `Table` or `Figure` is not a
document heading. Existing `H*` under those containers demote to `P`;
other types keep their existing non-heading role.

`[V]` parse 444/444. Final unsafe **5**. Heading exact **43/51**. Detection
47/51. Demotions **0**. True-heading collisions **0**. Qwen calls avoided
**320 / 444** (21 source-type + 299 ancestry, almost all table `P` cells).

The seven table-header promotions (`h07:3,6–9`, `h08:3,120`) are gone.
`h06:14` "Depot Staff Vehicles" is Document-level `P` — ODL left the
unruled grid outside any Table, so ancestry cannot see it. Both h11 chart
labels are Document-level with **no Figure** (SVG; the same hole
Headings.java R5 recorded for doc 07).

Does not pass the hard safety gate. Continue to Arm C **test only**.

#### Arm C — existing Headings.java rules (tested, not adopted)

Residuals after A+B, with the existing rule that would describe each:

| locator | class | existing rule? | result |
|---|---|---|---|
| `h06:14` Depot Staff Vehicles | unruled table label, Document `P` | R5 geometric table box | not measured as a gate: Cards does not emit boxes, and the unruled grid is not a Table child. R6 next-short would catch it **and** would demote three true headings (below). |
| `h09:8` spanning banner | Document `P`, 110 dense chars | R1 length (>80 dense) | would catch this one. Zero GT-heading collisions on spent H1. Development heading dense max is 35 (`train.json`). Does not reach the other four residuals. |
| `h11:4` Berth Occupancy by Month | chart title, existing `H1`, no Figure | R6 short following P | next is `Western quay, 2026` — the literal R6 example. **Unsafe as a candidate gate:** R6 would also fire on true headings `h01:4` Standard rates (next `£412`), `h06:13` Horizontal rules only, `h11:0` Utilisation Dashboard. |
| `h11:7` Month of year | chart axis, Document `P` | none | next is a 55-char sentence. R1 no, R6 no, no Figure. |
| `h13:1` COMMERCIAL IN CONFIDENCE | classification stamp, already `H2` | none | R3 is page markers (`page\d\|\d+of\d+`) only. No Headings rule names stamps. |

R6 is an existing rule that describes chart titles, and it **collides
with true headings** when applied over this candidate universe. STOP that
rule. Do not special-case the survivors.

R1 would take the banner with no heading collision and still leave four
unsafe promotions. It is not a passing rung. Not adopted. No all-caps
rule, no banner regex, no font-size gate.

#### Development (tuning/regression)

Hand cards (`probes.json`, `valid-07.json`, `train.json`): no out-of-flow
true headings and no ancestors on the cards, so Arm A/B is a no-op.
Previously passing logs still stand: probes heading exact **10/11**, 07
**6/6**, unsafe 0.

Real-PDF bridge of 01/03/07/08/11 (`out/bridge-dev-scope/`): 76 cards.
Arm A would skip 7 (L/LI/Figure/Caption/Table). Arm B would skip 28
(those plus 21 table descendants on doc 03). All 11 matched heading
probes stay Document `H*` — **zero skips of known true headings**. The
two table-cell traps on doc 03 (`03-review-period`, `03-q1`) would now
keep `P` without asking Qwen. Doc 07 still has no Figure around its
chart title; that is the h11 hole on development, not a new one.

Usefulness does not collapse. Bridge still emits a decision for every
evaluable candidate (444/444 parsed on the rescore; skipped rows are
keeps, not abstentions).

#### Predictions

1. `[H]` Figure-letter failures disappear by source type. **Confirmed** (5/5).
2. `[H]` Table/Figure ancestry eliminates most table/chart-furniture unsafe
   promotions. **Partial.** 7/8 table-header promotions gone. Chart
   furniture 0/2 (no Figure). Unruled table label 0/1 (no Table parent).
3. `[H]` Structural gates collide with zero known true headings. **Confirmed**
   (Arm A and Arm B, spent H1 + development heading probes).
4. `[H]` Heading usefulness remains materially unchanged. **Confirmed.**
   Spent H1 exact 43/51, detection 47/51, demotions 0. Development
   probes/07 unchanged by construction.
5. `[H]` At most one residual failure class remains. **Falsified.** Four
   remain after A+B: unruled table label, spanning banner, chart
   furniture without Figure, classification stamp.
6. `[H]` No retraining, new model, vision, or bespoke rule engine.
   **Confirmed.**

#### Stop

A+B is not a passing rung (final unsafe 5 on spent H1). Arm C has no
single existing Headings rule that clears the residual without hitting a
true heading. This is the registered fail path:

> Structural gates clear most cases but banner/stamp remain. STOP after
> testing existing rules. Do not stack new heuristics.

Holdout 2 stays sealed. It is not earned.

The unsafe Holdout-1 failures were **primarily** candidate-scope /
structure failures (12 of 17). The smallest revised architecture that is
safe on known true headings is:

**structural heading eligibility (source type + Table/Figure ancestry) +
role-only QLoRA + R2 + deterministic action.**

That architecture is not yet Holdout-2-ready. The residual four classes
have no Table/Figure parent to read, and no existing Headings.java rule
that can be applied as a candidate gate without collateral. They earn a
dedicated layout/context experiment. Do not retrain. Do not inspect
Holdout 2.

FINDING NOT PURSUED — candidate segmentation/merge (h02's four unmatched
headings). Unchanged.

Default `--arm` is now `B` (A was measured first and did not pass).
`--arm C` is ancestry-only; Headings R1/R6 were tested and not wired.

---

## Part 10 — Existing layout against residual promotions (pre-registration)

**Date:** 2026-09-11 · same branch. Part 9 Arm B is the frozen
reference: source-type eligibility + Table/Figure ancestry + role-only
QLoRA + R2 + deterministic action. Adapter, prompt, R2, and those two
structural gates do not change. Holdout 1 predictions remain immutable
(`4ec2198a…`). Holdout 2 sealed.

### The one question

> Can layout information already available in this codebase eliminate
> the residual unsafe promotions without retraining or inventing
> semantic string heuristics?

Not a training spike. Not four residual-specific rules.

### Inventory (completed before any new flag)

`belongsToTable` has **one caller**: `Headings.java:232`. The method is
`Headings.java:311–321`. It does not look at parent pointers.

**How table boxes are obtained.** `StructText.find(root, {"Table"})`
then `text.boxOf(t)`. Finding the region **depends on a `Table`
structure tag existing**. The box itself is the union of glyph boxes of
everything that Table element references (`StructText.boxOf` /
`harvest` from `TextPosition`). Same-page, x-overlap ≥ 0.5 × min(widths),
and vertically inside or within `CAPTION_GAP = 24` pt above or below.

So R5 is hybrid: structure to *find* the table, geometry to *test*
whether other text sits against that box. It cannot invent a table from
an unruled grid that has no `Table` tag. It *can* catch Document-level
`P` that sits against a tagged table's glyph box. h06 has one `Table`
(the ruled grid). Whether `h06:14` lies in that box is the Arm A
measurement. Thresholds are not retuned.

**Figures.java** locates *drawn images* (`PDImage`) by MCID for
thin-band / byte-identical-repeat artifacting. It has no SVG or chart-
text region. **FigureOrder** (production `Preview.java`) locates
`Figure` structure elements' image boxes. Spent h11 has **zero** Figure
tags. Arm B1 (existing geometric chart/figure region independent of
structure) **does not exist** for the chart residuals. Do not
manufacture it.

**Preview.java** already renders a full-page PNG (`PDFRenderer`, RGB,
capped scale) and writes it as base64 JSON. That is the existing
full-page capability for a later selective verifier. `run.py`
`generate()` already accepts `--image`.

**Cards.java** already compiles `StructText.java` onto the same
classpath. Arm A should call `boxOf` and the existing `belongsToTable`
predicate, not harvest a second geometry.

No `COMMERCIAL IN CONFIDENCE` / banner / `Month of year` / all-caps /
font-size rules. Those would encode spent Holdout 1.

### Architecture (registered)

Part 9 Arm B unchanged, then:

**Arm A (this spike) — R5 geometric table containment.** If
`belongsToTable` is true, the text is not eligible for document-heading
promotion. Same constants as Headings.java. If it misses h06 or hits a
true heading: STOP that rung. Do not retune.

**Arm B1 — existing figure/chart region.** Skipped unless the inventory
is wrong. It is not: no such region exists for SVG text.

**Arm B2 — selective full-page verifier.** Only if residuals remain
after A. Only candidates that survive source-type, ancestry, R2, and R5
(if A passed) and whose text-only role is an H* promotion or an H*
level change. Binary `{"heading": true|false}`. No H1/H2/H3. No adapter
on the vision call. No crops until full-page localization measurably
fails. Parse failure → do not auto-promote, counted separately.

### Frozen ML

No change to checkpoint, `out/adapter-role`, prompt, R2, structural
gates, action derivation, or generation settings.

### Gates

Spent H1 is diagnostic. Development is the regression surface.

- final unsafe promotions: 0 on the exposed universe
- layout layer vetoes 0 known true headings
- probes heading exact ≥ 9/11; 07 stays correct; spent H1 exact ≥ 80%;
  no new demotions from the verifier
- even if exposed unsafe hits 0: **do not run Holdout 2**

### Registered prediction

1. `[H]` Existing R5 geometry catches `h06:14` without a true-heading
   collision.
2. `[H]` No new handcrafted semantic rule is necessary.
3. `[H]` If existing geometric figure context is unavailable, selective
   full-page vision correctly rejects the banner/chart/stamp residuals.
4. `[H]` The layout stage vetoes zero known true headings.
5. `[H]` Exposed final unsafe promotions fall from 5 to 0.
6. `[H]` No retraining, crop pipeline, larger model, or production
   architecture is required.

### Win / fail

- **R5 + existing figure geometry clears everything:** STOP. No vision.
- **R5 helps and full-page verifier clears the rest:** STOP. No crops.
- **Full-page verifier cannot locate the target:** STOP. Crops earned
  next, not this spike.
- **Verifier harms true headings:** STOP. Do not prompt-tune on
  exposed failures.
- **A residual remains:** STOP. Do not add a regex.
- **Holdout 2:** not this spike, even on exposed unsafe 0.

### Measurement (2026-09-11)

ML freeze unchanged. Frozen H1 hash `4ec2198a…` untouched. Part 9 Arm B
is the reference. `--r5-veto` and `--verify-page` are measured flags,
off by default.

#### Arm A — R5 geometric table containment

Cards.java now calls `StructText.boxOf` (the same boxes Headings.java
uses) and copies `belongsToTable` with `CAPTION_GAP = 24` and
`MIN_OVERLAP = 0.5`. Not retuned.

h06 has one tagged `Table` (the ruled grid). `h06:14` "Depot Staff
Vehicles" is Document-level `P` on the same page. **`in_table_box`:
false.** The unruled label sits outside the existing table glyph box and
outside the 24 pt caption gap.

`[V]` Spent H1 with Arm B + `--r5-veto`: unsafe still **5**, including
`h06:14`. Heading exact 43/51. Demotions 0. GT headings with
`r5_table_box`: **0**. Development heading probes: **0** collisions.
R5 does mark 304 rows, almost all already ancestry-gated table cells,
plus one Document-level caption-adjacent `P` on h07.

**STOP Arm A.** Do not change thresholds. Do not redraw the table
region around this example. `--r5-veto` is not adopted.

Prediction 1 **falsified**.

#### Arm B1 — existing figure/chart region

Skipped. Figures.java / FigureOrder locate *images* under `Figure`
tags. Spent h11 has zero Figure tags. No SVG region exists to reuse.

#### Arm B2 — selective full-page verifier

Preview.java PNG (existing). Binary `{"heading": true|false}`. Base
model, **no adapter**. Only candidates that survived source-type,
ancestry, and R2 and whose text-only role is an H* promotion or level
change: **14** of 444. Unique pages rendered, not 444 images.

`[V]` Architecture path on spent H1:

| locator | GT heading? | verify | final |
|---|---|---|---|
| h01:4 Standard rates | yes | true | H2 |
| h01:11 Exclusions | yes | true | H2 |
| h02:0 BERTH ALLOCATION PROCEDURE | yes | true | H2 |
| h06:2 Fully ruled | yes | true | H2 |
| h06:13 Horizontal rules only | yes | true | H2 |
| h06:14 Depot Staff Vehicles | no | **true** | H2 (still unsafe) |
| h09:8 spanning banner | no | false | P |
| h11:4 Berth Occupancy by Month | no | **true** | H2 (still unsafe) |
| h11:7 Month of year | no | false | P |
| h12:5 Recommendation | yes | true | H2 |
| h13:1 COMMERCIAL IN CONFIDENCE | no | false | keep H2 |
| h16:4 / :6 / :10 hierarchy | yes | true | H2 |

Parse 14/14. True-heading vetoes **0**. Heading exact **43/51**.
Demotions **0**. Final unsafe **2** (was 5).

Same-page keep controls (diagnostic, not in the architecture set):
true headings `Depot Cost Comparison`, `Port Bulletin`, `Utilisation
Dashboard`, `Berth occupancy`, `Northern Apron Surrender: Heads of
Terms` all `heading: true`. Already-gated table headers `Depot` /
`Registration` `false`. Figure letter `R` `true` (never reaches this
stage; the verifier is not "always false"). R2 `£680` `false`. One
parse failure on keep `Charges` (h09:9) — counted as parse fail, not
as a veto; that row does not enter the architecture verifier.

Two residuals the full page did not reject:

- `h06:14` is unique text. Localization is not the failure. The page
  shows a table-group label that looks like a heading.
- `h11:4` sits on the same page as GT `Berth occupancy` / `Utilisation
  Dashboard`. Localization *may* be the failure; the chart title also
  looks like a heading.

#### Predictions

1. `[H]` R5 catches `h06:14` without a true-heading collision. **Falsified**
   (no collision, but it does not catch `h06:14`).
2. `[H]` No new handcrafted semantic rule. **Confirmed.**
3. `[H]` Selective full-page vision rejects banner/chart/stamp.
   **Partial.** Banner, axis label, and stamp rejected. Chart title
   not. Unruled table label not.
4. `[H]` Layout stage vetoes zero known true headings. **Confirmed** on
   the architecture set. Extra keeps: no `false`; one parse miss on
   `Charges`.
5. `[H]` Exposed final unsafe 5 → 0. **Falsified.** 5 → **2**.
6. `[H]` No retraining, crop pipeline, larger model, or production
   architecture. **Confirmed.** Crops are earned, not built.

#### Stop

Registered fail path: residuals remain after existing geometry and
full-page vision. Do not add a regex. Do not prompt-tune. Do not run
Holdout 2.

h11:4 is the localization-shaped miss; h06:14 is visual ambiguity of
furniture that looks like a heading. A **minimal target-crop
experiment** is earned next. Not this spike.

The unsafe count that structure could not see went 5 → 2 with zero
true-heading vetoes. That is not Holdout-2-ready.

Default remains Part 9 Arm B. `--r5-veto` / `--verify-page` stay as
measured switches.

---

## Part 11 — does marking the existing box on the existing page fix the last two?

**Date:** 2026-09-11. Same branch. Holdout 1 remains spent diagnostic
evidence. Holdout 2 remains sealed. No retrain. No semantic rules.
No prompt-tuning against `h06:14` / `h11:4` as categories.

The current exposed-safe baseline remains Part 9 Arm B:

source-type eligibility + Table/Figure ancestry + role-only QLoRA +
R2 + deterministic action

Part 10 left two architecture-verifier residuals after selective
full-page verification: `h06-mixed-table-borders:14` and
`h11-chart-labels-as-headings:4`. This part asks a narrower question
than “can vision classify headings?” (Part 10 already showed that it
often can):

> Does explicitly localizing the target element in the existing page
> image resolve the remaining verifier errors without vetoing genuine
> headings?

This is a localization experiment before it is a crop experiment.

### Freeze

The comparison set is the exact 14 Part 10 Arm B2 architecture
candidates. Do not add or remove.

| locator | GT heading? | Part 10 full-page |
|---|---|---|
| h01-big-text-not-heading:4 Standard rates | yes | true |
| h01-big-text-not-heading:11 Exclusions | yes | true |
| h02-headings-look-like-body:0 BERTH ALLOCATION PROCEDURE | yes | true |
| h06-mixed-table-borders:2 Fully ruled | yes | true |
| h06-mixed-table-borders:13 Horizontal rules only | yes | true |
| h06-mixed-table-borders:14 Depot Staff Vehicles | no | **true** (unsafe) |
| h09-three-column:8 spanning banner | no | false |
| h11-chart-labels-as-headings:4 Berth Occupancy by Month | no | **true** (unsafe) |
| h11-chart-labels-as-headings:7 Month of year | no | false |
| h12-visible-title-no-metadata:5 Recommendation | yes | true |
| h13-first-big-text-not-title:1 COMMERCIAL IN CONFIDENCE | no | false |
| h16-inconsistent-hierarchy:4 Discrepancies | yes | true |
| h16-inconsistent-hierarchy:6 STORAGE | yes | true |
| h16-inconsistent-hierarchy:10 Dispatch | yes | true |

Part 10’s 14 full-page predictions are the baseline and are not
regenerated. Same PDF, same candidate, same base Qwen3.5-4B, same
binary contract, same generation settings (temperature 0, thinking
disabled, max-tokens 256, no adapter), same text, same GT. Only the
visual target-localization representation changes.

### Coordinate mapping (traced, not reinvented)

The box already exists. `StructText.boxOf` unions glyph boxes from
`getXDirAdj` / `getYDirAdj` / `getHeightDir` — top-down page
coordinates matching PDFTextStripper (`StructText.java`). `Cards.java`
already called `boxOf` for `page` and R5; it did not emit `x0,y0,x1,y1`.
Part 11 exposes those four numbers. No second geometry extractor.

`Preview.java` is the renderer: `PDFRenderer.renderImage` at
`min(2, 1600/max(cropWidth, cropHeight))`, crop box, then page
rotation. Figure overlays already convert unrotated top-down media
coordinates into the displayed crop (`x - crop.LLX`,
`y + crop.URY - mediaHeight`) and then rotate clockwise 90/180/270
the same way the raster does (`java-preview.test.ts` pins that on a
cropped+rotated fixture).

StructText’s DirAdj box is the same top-down convention. Mapping it
onto Preview’s PNG reuses those six lines, then scales by the raster
size over the displayed crop. PDF y-down vs image y-down is already
the DirAdj convention; page rotation is Preview’s existing switch.

No image-analysis framework. No coordinate abstraction layer.

One runnable check: dump tagged development `01-simple-text`, take the
existing H1 box for “Quarterly Operations Summary”, render page 1 with
Preview, map the box, assert the rectangle is inside the PNG bounds
(`python run.py --check-box-map`).

Crop/clip inventory: no `getSubimage` and no crop helper on this
path. `Contrast.java` renders a full page at 150 DPI for sampling,
which is a different stage. If a context crop is earned, the policy
will be written here *before* any Arm-B image is generated, and the
operation will be `BufferedImage.getSubimage` on the already-rendered
image. Not earned yet.

### Arm A — marked full page (not yet generated)

Reuse each candidate’s existing full-page PNG. Draw one rectangle
around that candidate’s existing glyph box (`Graphics2D`, magenta
stroke, no labels, no arrows, no OCR, no text on the image). One
marked PNG per candidate, because several of the 14 share a page.

Frozen marker prompt (binds the question to the outlined object; not
semantic prompt-tuning):

> You are shown a PDF page. The outlined rectangle marks the exact
> element being evaluated. Decide whether the marked element is a
> document section or subsection heading, rather than table/chart
> labeling, a banner, stamp, page furniture, or other
> non-document-heading content. Return ONLY {"heading":true} or
> {"heading":false}.

Verifier stays selective: source-type → ancestry → role QLoRA → R2 →
only then vision, and only when the proposed mutation is a heading
promotion or heading-level change. Parse failure on an architecture
candidate is `verification_failure` and fail-closes (no automatic
promotion). It is not scored as a correct non-heading classification.

If Arm A reaches parse 14/14, true-heading vetoes 0, final unsafe 0:
STOP. Do not build a crop. Holdout 2 still not run.

### Registered predictions (written before Arm A generation)

1. `[H]` Explicit target marking fixes `h11:4`, because Part 10’s
   failure is at least partly localization-shaped.
2. `[H]` Target marking alone may not fix `h06:14`, because its text
   is unique and it visually resembles a section/table-group heading.
3. `[H]` Marking vetoes zero genuine headings among the same 14
   candidates.
4. `[H]` If `h06` remains, one fixed local-context crop supplies
   enough resolution/context to reject it.
5. `[H]` Exposed final unsafe falls 2 → 0 without semantic rules or
   retraining.
6. `[H]` Holdout 2 remains untouched.

### Mapping check

`--check-box-map` on tagged development `01-simple-text:1`
(“Quarterly Operations Summary”): mapped `{x:108,y:187,w:619,h:26}`
inside 1130×1600. The rectangle sits on that H1, not on the running
header or the following paragraph.

The same mapping on the two residuals lands on the existing glyph
box, not a guessed region: `h11:4` on the chart title string; `h06:14`
on the union of the three column-header glyphs Cards concatenates as
that locator’s text. No second extractor.

### Arm A — marked full page `[V]`

Same 14. Existing Preview PNGs reused. One magenta rectangle per
candidate. Base Qwen3.5-4B, no adapter, temperature 0, thinking
disabled, max-tokens 256. Marker prompt as frozen above. No `Text:`
line — the rectangle is the binding.

| locator | GT heading? | full page | marked page | final |
|---|---|---|---|---|
| h01:4 Standard rates | yes | true | **false** | P (keep) |
| h01:11 Exclusions | yes | true | **false** | H3 (keep) |
| h02:0 BERTH ALLOCATION PROCEDURE | yes | true | true | H2 |
| h06:2 Fully ruled | yes | true | true | H2 |
| h06:13 Horizontal rules only | yes | true | **false** | P (keep) |
| h06:14 Depot Staff Vehicles | no | true | false | P (keep) |
| h09:8 spanning banner | no | false | false | P |
| h11:4 Berth Occupancy by Month | no | true | false | H1 (keep) |
| h11:7 Month of year | no | false | false | P |
| h12:5 Recommendation | yes | true | true | H2 |
| h13:1 COMMERCIAL IN CONFIDENCE | no | false | false | keep H2 |
| h16:4 Discrepancies | yes | true | true | H2 |
| h16:6 STORAGE | yes | true | **false** | H4 (keep) |
| h16:10 Dispatch | yes | true | true | H2 |

Parse **14/14**. `verification_failure` **0**. Every raw parse was
`{"heading":true}` or `{"heading":false}`.

`h11:4`: full page true → marked false. Direct evidence that Part
10’s miss was at least partly localization-shaped. Fail-closed keeps
the existing `H1` (the proposed mutation was H1→H2), so this row
leaves the unsafe-*retag* list without turning the chart title into
`P`.

`h06:14`: marked false. The model, pointed at that box, did not call
it a heading. That is not scored as a localization failure.

True-heading vetoes **4** (gate is 0):

- `h01:4` Standard rates (P, would have been promoted)
- `h01:11` Exclusions (stays H3; level change blocked)
- `h06:13` Horizontal rules only (P, would have been promoted)
- `h16:6` STORAGE (stays H4; level change blocked)

Two of those are heading demotions in the scorer (`Standard rates`,
`Horizontal rules only`). Heading exact **43 → 39 / 51**. Detect
47 → 45. Demotions **0 → 2**. Usefulness gate (80% exact) **fails**.

Final unsafe **0**. `model_unsafe` still 18. Qwen skipped 320/444
unchanged.

### Predictions scored

1. `[H]` Marking fixes `h11:4`. **Confirmed.**
2. `[H]` Marking may not fix `h06:14`. **Falsified** (marked
   `heading:false`).
3. `[H]` Zero genuine-heading vetoes. **Falsified** (4).
4. `[H]` Crop rejects remaining `h06`. **Not run.** Outcome E stops
   before a crop.
5. `[H]` Unsafe 2 → 0 without semantic rules or retraining.
   **Confirmed as a count**, and not adoptable: the same switch
   demoted known headings.
6. `[H]` Holdout 2 untouched. **Confirmed.**

### Stop — Outcome E

The marked full-page verifier vetoed genuine headings. Stop
immediately. Do not trade promotion safety for that.

Do not build a crop. Do not change the crop size, the prompt, or the
marker. Do not add examples, an all-caps rule, or table-label
strings. Do not retrain. Do not run Holdout 2.

What this measured: once the 4B verifier can see which object we
mean, it can reject the two Part 10 residuals, and it also rejects
section headings that the unmarked full page had allowed. Target
localization is not a free safety upgrade on this model and this
binary contract.

Architecture remains Part 9 Arm B:

source-type eligibility + Table/Figure ancestry + role-only QLoRA +
R2 + deterministic action

`--verify-page` / `--verify-marked` stay measured switches, off by
default. Selective invocation is preserved; it is the *representation*
that failed the heading-veto gate, not the idea of running vision on
every BLOCK.

The next decision, if any, is model/data architecture — not a second
crop, and not Holdout 2.

---

## Part 12 — can the existing role adapter use the marked page?

**Date:** 2026-09-11. Same branch. Holdout 1 remains spent. Holdout 2
remains sealed. No retrain. No crop. No new binary-verifier adapter.
No change to Part 9 structural gates.

The frozen architecture before vision remains Part 9 Arm B:

source-type eligibility + Table/Figure ancestry + role-only QLoRA +
R2 + deterministic action

Part 10: base-model full-page binary verifier, unsafe 5 → 2, zero
true-heading vetoes.

Part 11: the same binary verifier on an explicitly marked page solved
both residuals (`h06:14`, `h11:4` true → false) and vetoed four
genuine headings. Localization is no longer the unresolved variable.
The base 4B binary heading/non-heading boundary is.

This part asks whether the semantic classifier already trained
(`out/adapter-role`) can consume that visual signal at inference
without a new adapter, new examples, a prompt sweep, a crop, or
Holdout 2.

> Can the existing role-only QLoRA adapter preserve its learned
> heading semantics while using an explicitly marked page to reject
> contextually non-heading elements?

Inference-only reuse. Mechanical success is not an experimental win.

### Contract (frozen before generation)

The adapter is not asked for `{"heading":true|false}`. It keeps the
role-only contract it was trained on: `{"role":"..."}`,
`ROLE_ONLY_STEM`, `existing_tag` withheld, mutation derived outside
the model.

The marked-image call answers: given the target’s text/metadata and
its visual position/context, what semantic role is this element?

Derived only for eligibility:

`visual_heading = visual_role in H1..H6`

If `visual_heading` is true, keep the frozen text-only `model_role`
(the adapter does not get to pick the final level). If false, block
the proposed heading mutation with the same fail-closed semantics as
Part 11. Parse failure is `verification_failure`, not a correct
non-heading.

Fields stay distinct: `model_role`, `r2_match`, structural
eligibility, `visual_role`, `visual_heading`,
`verification_failure`, `final_role`, derived action.

Prompt change is one sentence on the existing role card:

> The outlined rectangle in the image marks the Element described below.

No examples. No spent-failure vocabulary. Rectangle geometry and
appearance are Part 11’s, unchanged.

Two surfaces, frozen before multimodal generation:

- **Surface A** — development regression: every real-PDF development
  bridge candidate that survives source-type, ancestry, and R2 and
  whose text-only `out/adapter-role` proposal would promote
  non-heading → H* or change H* level. Label-independent.
- **Surface B** — the exact 14 Part 10/11 architecture candidates.
  Spent evidence. Part 11 marked-base outputs are not regenerated.

Development is gated first. If genuine headings are visually
rejected there, stop without spent H1.

### Registered predictions (written before multimodal generation)

1. `[H]` The role-only adapter accepts marked images without
   retraining or source modification.
2. `[H]` The adapter’s learned semantic heading boundary prevents the
   four genuine-heading vetoes produced by the base binary verifier.
3. `[H]` The marked image still provides enough contextual evidence
   for `h06:14` and `h11:4` to move off heading eligibility.
4. `[H]` Development regression shows zero genuine-heading vetoes.
5. `[H]` Spent H1 reaches final unsafe 0 without reducing heading
   exact below its existing 84% result (43/51).
6. `[H]` Holdout 2 remains sealed.

### Surface A freeze (text-only, before multimodal)

Mechanical smoke: `mlx-community/Qwen3.5-4B-MLX-4bit` + `out/adapter-role`
+ one `--image` in the same `generate` call parsed `{"role":"H1"}` on
the development marked H1. That is plumbing, not a win.

Development bridge dump (01/03/07/08/11): 76 cards, Qwen skipped 28
by Part 9 Arm B, 48 text-only adapter calls. Against those five
answer keys, text-only is heading exact **11/12**, detect 12/12,
demotions 0, unsafe 0. The one hierarchy miss is the only mutation
that survives source-type, ancestry, and R2:

| locator | text | existing | text-only `model_role` |
|---|---|---|---|
| 01-simple-text:5 | Regional detail | H3 | H2 |

**n = 1.** Artifact retags and R2 numeral keeps are not heading
promotions or heading-level changes, so they are not in this set.
Label-independent.

This locator is frozen before any marked-adapter call.

### Development gate `[V]`

One marked-adapter call, on `01-simple-text:5` only. Same Part 11
marker. Adapter `out/adapter-role`, role-only contract, one
localization sentence.

| locator | GT | existing | text-only | visual_role | visual_heading | final |
|---|---|---|---|---|---|---|
| 01-simple-text:5 Regional detail | H3 | H3 | H2 | H2 | true | H2 |

Parse 1/1. True-heading vetoes **0**. Unsafe **0**. Heading exact
stays **11/12**. Demotions **0**. Visual verifier did not change the
mutation (still the text-only H2 level change).

Development holds. Spent H1 diagnostic is allowed.

### Spent H1 diagnostic `[V]`

Exact 14. Part 11 marked-base outputs not regenerated. Adapter on
the same marked PNGs.

| locator | GT heading? | text-only | base marked binary | adapter visual_role | visual_heading | final |
|---|---|---|---|---|---|---|
| h01:4 Standard rates | yes | H2 | false | H2 | true | H2 |
| h01:11 Exclusions | yes | H2 | false | H2 | true | H2 |
| h02:0 BERTH ALLOCATION PROCEDURE | yes | H2 | true | H1 | true | H2 |
| h06:2 Fully ruled | yes | H2 | true | H2 | true | H2 |
| h06:13 Horizontal rules only | yes | H2 | false | H2 | true | H2 |
| h06:14 Depot Staff Vehicles | no | H2 | false | Table | false | P |
| h09:8 spanning banner | no | H2 | false | P | false | P |
| h11:4 Berth Occupancy by Month | no | H2 | false | H2 | true | H2 |
| h11:7 Month of year | no | H2 | false | P | false | P |
| h12:5 Recommendation | yes | H2 | true | H2 | true | H2 |
| h13:1 COMMERCIAL IN CONFIDENCE | no | H1 | false | H2 | true | H1 |
| h16:4 Discrepancies | yes | H2 | true | H3 | true | H2 |
| h16:6 STORAGE | yes | H2 | false | H2 | true | H2 |
| h16:10 Dispatch | yes | H2 | true | H2 | true | H2 |

Parse **14/14**. `verification_failure` **0**. True-heading vetoes
**0**. Heading exact **43/51** (84%). Demotions **0**.

The four Part 11 casualties are heading-eligible again. `h06:14`
moves off heading (`visual_role: Table`). `h11:4` does not
(`visual_role: H2`). `h13:1` is newly heading-eligible, so the
text-only H2→H1 mutation applies; Part 10/11 had fail-closed to keep
H2. Final unsafe **2** (`h11:4`, `h13:1`). Same count as Part 10,
different members.

`visual_role` is recorded and is not `final_role`. Where
`visual_heading` is true, text-only `model_role` wins (h02 visual H1
stays final H2; h16:4 visual H3 stays final H2).

### Predictions scored

1. `[H]` Adapter accepts marked images without retraining. **Confirmed**
   (smoke + 1 development + 14 spent).
2. `[H]` Prevents the four genuine-heading vetoes. **Confirmed.**
3. `[H]` `h06:14` and `h11:4` both leave heading eligibility.
   **Partial.** `h06:14` yes; `h11:4` no.
4. `[H]` Development zero genuine-heading vetoes. **Confirmed.**
5. `[H]` Spent H1 unsafe 0 at ≥84% exact. **Falsified.** Exact holds
   43/51; unsafe is 2.
6. `[H]` Holdout 2 sealed. **Confirmed.**

### Stop — Outcome B

The existing role adapter preserves heading semantics on a marked
page and does not learn the remaining visual furniture distinction
zero-shot. `h11:4` stays H2; the classification stamp becomes
eligible again.

Do not train in this spike. Do not crop. Do not prompt-sweep. Do not
run Holdout 2.

A trained localized visual verifier is earned next. It would not be
“train on the 14 Holdout-1 mistakes.” Holdout 1 is spent evaluation
evidence and stays out of training.

That next spike, if run, would build marked-page verifier examples
only from development documents, with:

- true headings;
- visually heading-like non-headings;
- table/group labels;
- chart labels;
- banners/furniture where development supplies them;
- whole-document separation for validation;
- this same marker representation, frozen;
- binary eligibility or role-only chosen before training.

Prefer upstream `mlx_vlm.lora` / QLoRA again. Do not invent a
trainer. Do not decide whether vision layers need training until a
tiny language-side multimodal overfit/generalization measurement
says so.

Architecture remains Part 9 Arm B. `--verify-marked-role` is a
measured switch, off by default. Selective invocation is unchanged.

---

## Part 13 — language-side QLoRA marked-page eligibility verifier

**Date:** 2026-09-11. Same branch. Holdout 1 remains spent. Holdout 2
remains sealed. No crop. No semantic string rules. No Holdout-1
training rows. `out/adapter-role` is not modified and is not
retrained. No production `src/` wiring.

Part 12 Outcome B: reusing the text-role adapter on marked pages
restored the four Part-11 genuine-heading casualties and left two
unsafe furniture promotions (`h11:4`, `h13:1`). The next earned
component is a **separate** binary eligibility adapter, not another
role classifier.

### Frozen architecture (unchanged order)

1. source-type eligibility;
2. Table/Figure ancestry;
3. text-only `out/adapter-role`;
4. R2;
5. only when the resulting mutation would promote to H1–H6 or change
   an H* level:
6. localized eligibility verifier (`out/adapter-verify-marked`);
7. deterministic action.

The two adapters are not merged and are not stacked. The role adapter
keeps semantic role and H1/H2/H3 hierarchy. The verifier answers one
question: is the marked element eligible to act as a document section
or subsection heading? If `heading: true`, preserve text-role
`model_role`. If `heading: false`, block the heading mutation. The
verifier never chooses H1/H2/H3.

### Frozen verifier contract (before training)

Completion: `{"heading":true}` or `{"heading":false}`.
Target: `heading = expect.role in H1..H6`.
No confidence, reason, action, or existing tag in the prompt.

Frozen prompt:

> You are shown a PDF page. The outlined rectangle marks the exact Element described below. Decide whether that marked element is a document section or subsection heading rather than table/chart labeling, a banner, stamp, page furniture, or other non-document-heading content. Return ONLY {“heading”:true} or {“heading”:false}.

Then the ordinary metadata: Element / Font / Weight / Previous /
Next / JSON.

No few-shots. No Holdout-1 strings or locators. No special treatment
for COMMERCIAL IN CONFIDENCE, Berth Occupancy by Month, Depot Staff
Vehicles, all-caps, chart titles, or banner wording.

Split (existing, not invented): train `train.json` docs 02/04/05/06/10/12;
fresh validation `valid-07.json`; known challenge `probes.json` docs
01/03/08/11. Training images are marked full-page Preview PNGs from
real tagged PDFs. Holdout 1 is absent from train and validation
construction. Holdout 2 is sealed.

### Upstream training path (inspected before SFT)

Installed `mlx_vlm==0.7.0`. Not patched. No custom trainer.

- `mlx_vlm/lora.py` `transform_dataset_to_messages`: a dataset that
  already has `messages` is returned as-is. Image columns are not
  copied into message content in that branch.
- `VisionDataset.process` reads images from the dataset item
  (`images` or `image`), then `apply_chat_template(..., num_images=len(images))`
  and `prepare_inputs(..., images=...)`.
- `process_image` accepts a local path string via `load_image`.
- `--train-vision` is a store-true flag, default off. LoRA is applied
  only to `model.language_model`. Image tensors still flow through
  `prepare_inputs` when an `image` column is present.

First rung is therefore: vision encoder frozen; language-side LoRA;
image-bearing rows via `messages` plus an `image` path column. SFT
lives in a folder containing `train.json` (same `load_dataset`
shape as Part 4/6). `--train-on-completions` exists.

### Registered predictions (frozen before plumbing, dataset, or the one run)

1. `[H]` Stock MLX-VLM 0.7.0 can train a language-side QLoRA on
   image-bearing marked-page examples without training the vision
   encoder or patching source.
2. `[H]` The marked verifier generalizes to doc 07 with zero
   true-heading vetoes and zero unsafe promotions.
3. `[H]` It preserves the known development challenge’s heading
   usefulness while rejecting heading-like non-headings.
4. `[H]` The marked image contributes information beyond the same
   verifier’s text-only inference on at least one difficult
   validation example.
5. `[H]` On spent H1, the trained verifier rejects both the
   chart-title and classification-stamp residuals while preserving
   the four Part-11 genuine headings.
6. `[H]` No crop, vision-layer fine-tuning, larger model, semantic
   regex, or Holdout-1 training example is needed.
7. `[H]` Holdout 2 remains sealed.

### Dataset (train.json → marked PDF, architectural filter)

Tagged PDFs: development 02/04/05/06/10/12 from the existing ODL
corpus copies, stems unchanged. Images: Part-11 Preview PNG + magenta
rectangle. Labels: `heading = expect.role in H1..H6`. Matching uses
`attach_probe_expect(..., by_doc=True)` so a probe `04-*` cannot bind
a `12-*` BLOCK (without that, `04-northern` attached to
`12-kitchen-sink:26`).

| | n |
|---|---|
| train.json cards | 43 |
| matched to a BLOCK | 38 |
| unmatched (not replaced) | 5: `12-h3-apron`, `04-northern`, `04-units`, `04-vehicle-class`, `12-brand` |
| excluded source_type | 5 (`06-p`, `06-h2-apron`, `06-h2-mark`, `06-h2-layout`, `12-footer`) |
| excluded ancestry | 2 (`12-review-period`, `12-q1`) |
| excluded R2 | 0 |
| **verifier train rows** | **31** (18 `heading:true`, 13 `heading:false`) |

All six train documents are represented. No Holdout-1 row. No
manufactured replacement.

SFT: gitignored `out/gen-sft-verify/train.json` (`messages` + local
`image` path). HuggingFace `load_dataset` keeps the path as a string;
`process_image` / `load_image` resolve it.

### Plumbing (not scored)

One copied train row in `out/plumb-sft`. Loader: image path exists.
First `mlx_vlm.lora --iters 1` on the native 1130×1600 PNG **OOM**
(`kIOGPUCommandBufferCallbackErrorOutOfMemory`) after LoRA setup —
images are reaching the forward pass (text-only LoRA was 9.7 GB).

`--grad-checkpoint` (installed CLI) completed one step: loss
0.0546, 1886 tokens (text-only was ~185 tokens/example), peak 13.4
GB, adapter written. Plumbing adapter discarded.

The first full 31-row run with `--grad-checkpoint` and native
resolution died on iter 1 (`METAL Internal Error`) before a loss
line. Same CLI, `--image-resize-shape 560 800` (full page, not a
crop; bounds vision memory). That is the one training run below.
`--train-vision` stayed off. No source patch.

### Training health — `out/adapter-verify-marked`

```
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset out/gen-sft-verify \
  --split train --batch-size 1 --lora-rank 8 --epochs 6 \
  --steps-per-report 10 --steps-per-save 1000 \
  --train-on-completions --grad-checkpoint \
  --image-resize-shape 560 800 \
  --output-path out/adapter-verify-marked
```

| | |
|---|---|
| rows | 31 (18 true / 13 false) |
| iters | 186 = (31 // 1) × 6 |
| loss | 0.0391 (iter 10) → 0.000024 (iter 186); no NaN |
| peak mem | 14.057 GB |
| adapter | 62 MiB `adapters.safetensors` |
| LoRA keys | `language_model.*` only |
| image-bearing | yes (1886–1900 tokens/example vs ~185 text-only) |

No crash on this run. Adapter loads. Binary JSON parses on every
eval row below.

### Gate 1 — fresh document 07

`run.py --eval-verify-marked --pdf-dir out/eval-tagged --match-path valid-07.json`

Mapped 4/6. Unmatched, not replaced: `07-northern`, `07-q1` (legend /
axis ticks absent as usable BLOCKs).

| id | locator | GT heading | text role | verifier | applied? | final |
|---|---|---|---|---|---|---|
| 07-h1 | :0 | true | H1 | true | no (keep H1) | H1 |
| 07-intro | :1 | false | P | false | no | P |
| 07-chart-title | :2 | false | H2 | false | no (keep H2) | H2 |
| 07-cap | :11 | false | P | false | no | P |

Parse **4/4**. True-heading vetoes **0**. Unsafe promotions **0**.
H1 eligible. Not all-false. Accuracy **4/4**. Recall **1/1**.
Non-heading rejection **3/3**. Confusion TP1 TN3 FP0 FN0.

`[V]` **pass.** Chart-title is tagged H2 on this PDF and the role
adapter agrees, so the verifier is not invoked (no heading
*mutation*). Its binary prediction is still false. Architecture
unsafe remains 0.

### Gate 2 — known development challenge

`run.py --eval-verify-marked --match-path probes.json` (docs 01/03/08/11).

Parse **17/17**. Verifier-caused heading vetoes **0**. Final unsafe
**0**. Role-layer heading exact **10/11** (≥9/11). No new heading
demotions (verifier never said false on a GT heading).

| id | GT | text role | verifier | applied? | final |
|---|---|---|---|---|---|
| 01-h3-regional | H3 | H2 | true | yes (H3→H2) | H2 (preserved model_role) |
| 01-h2-actions | H2 | H2 | true | no | H2 |
| 03-h1 | H1 | H1 | true | no | H1 |
| 08-numeral-3 | P | H1 | true | no (R2) | P |
| 11-h1-terms | H1 | H1 | true | no | H1 |
| 11-h2-eligibility | H2 | H2 | true | no | H2 |
| 11-h2-applying | H2 | H2 | true | no | H2 |
| 11-h2-contact | H2 | H2 | true | no | H2 |

Verifier accuracy 16/17 (FP: `08-numeral-3` `heading:true`; R2 already
blocks). Recall 11/11. Non-heading rejection 5/6.

`[V]` **pass.** The H3/H2 miss on Regional detail is the role adapter.
The verifier said heading and preserved `model_role`.

### Image ablation (after Gate 1/2 frozen)

Same adapter, same 07 rows, same prompt and generation settings,
`--omit-image`.

| id | marked | no-image | flip? |
|---|---|---|---|
| 07-h1 | true | true | no |
| 07-intro | false | false | no |
| 07-chart-title | false | false | no |
| 07-cap | false | false | no |

Zero flips. The difficult mapped non-heading (`07-chart-title`) is
rejected with and without the page. Visual localization is **not**
shown to be load-bearing on this validation set.

### Predictions scored

1. `[H]` Stock MLX-VLM trains language-side QLoRA on marked pages
   without `--train-vision` or a source fork. **Confirmed**
   (`--grad-checkpoint` and `--image-resize-shape 560 800` were
   mechanical, required to hold Metal memory).
2. `[H]` Doc 07: zero heading vetoes, zero unsafe promotions.
   **Confirmed** on the four mapped rows.
3. `[H]` Known challenge usefulness held while rejecting
   heading-like non-headings. **Confirmed** at the architecture
   gate (10/11 exact, unsafe 0). The one verifier FP is the R2
   numeral, already blocked upstream.
4. `[H]` Marked image contributes on at least one difficult 07
   example. **Falsified.** Ablation identical.
5. `[H]` Spent H1 residuals. **Not run.** Outcome D stops.
6. `[H]` No crop, vision-tower FT, larger model, semantic regex, or
   Holdout-1 train row. **Confirmed** as constraints held.
7. `[H]` Holdout 2 sealed. **Confirmed.**

### Stop — Outcome D

Development gates pass. Image ablation on frozen doc 07 is
indistinguishable from text-only inference of the same adapter.

A language-side QLoRA *can* learn the binary heading-eligibility
contract from development marked pages, parse, and avoid true-heading
vetoes on 07 and the known challenge. That does not prove the marked
visual signal is doing work. This adapter may be a second text
classifier that happens to have been trained with images present.

Do not promote the multimodal design to production.

Do not run spent Holdout 1. Do not run Holdout 2. Do not enable
`--train-vision`. Do not crop. Do not add epochs or examples.

The next cheaper experiment, if any, is the **same binary verifier
contract without images**, not a blind holdout and not vision-layer
training.

Architecture remains Part 9 Arm B. `--eval-verify-marked` is a
measured switch, off by default. `out/adapter-role` is unchanged.

---

## Part 14 — text-only binary eligibility QLoRA (same 31 rows)

**Date:** 2026-09-11. Same branch. Holdout 1 remains spent and is
**not** scored in this spike. Holdout 2 remains sealed. No crop. No
marker change. No extra examples. No extra epochs. No `--train-vision`.
`out/adapter-role` and `out/adapter-verify-marked` are not modified
and are not retrained. No production `src/` wiring.

Part 13 Outcome D: the marked-page language-side verifier passed
development, but its doc-07 predictions were identical with the image
removed (0 flips). Vision has not earned a place in the architecture.
This spike asks the remaining cheaper question: can the **same**
binary contract, on the **same** 31 development rows, be learned
without images at all?

If yes, prefer the text-only verifier. If no, the image-bearing
*training* path may have contributed despite the inference ablation.
This is a model-comparison spike, not a data-expansion spike.

### Frozen architecture (unchanged order)

1. source-type eligibility;
2. Table/Figure ancestry;
3. text-only `out/adapter-role`;
4. R2;
5. only when the resulting mutation would promote to H1–H6 or change
   an H* level:
6. binary eligibility verifier (`out/adapter-verify-text` in this
   spike; Part 13 `out/adapter-verify-marked` is the comparison
   reference, not retrained);
7. deterministic action.

Structural gates remain architecture outside the model. The verifier
still never chooses H1/H2/H3.

### Frozen verifier contract (Part 13 minus the visual sentence)

Completion: `{"heading":true}` or `{"heading":false}`.
Target: `heading = expect.role in H1..H6`.
No confidence, reason, action, or existing tag.

Frozen prompt:

> Decide whether the Element described below is a document section or subsection heading rather than table/chart labeling, a banner, stamp, page furniture, or other non-document-heading content. Return ONLY {“heading”:true} or {“heading”:false}.

Then: Element / Font / Weight / Previous / Next / JSON.

No page, y-band, bounding box, ancestry, source type, existing tag,
image-derived fields, or few-shots.

### Frozen train population (do not re-filter)

Part 13’s 31 semantic rows, reconstructed from
`out/gen-sft-verify/train.json` against the recorded IDs. Same IDs,
labels, texts, fonts, weights, previous/next, documents, class
balance. The only training-input difference is: remove the image.

| | n |
|---|---|
| **verifier train rows** | **31** (18 `heading:true`, 13 `heading:false`) |
| documents | 02/04/05/06/10/12 |
| unmatched (not replaced) | 5: `12-h3-apron`, `04-northern`, `04-units`, `04-vehicle-class`, `12-brand` |
| excluded source_type / ancestry | 7, unchanged |

If reconstruction is not 31 / 18 / 13 with that ID set: STOP as a
dataset-reproduction failure. Do not train on a different population.

Validation surfaces unchanged: the four mapped `valid-07.json` rows
(`07-h1`, `07-intro`, `07-chart-title`, `07-cap`); the 17
`probes.json` rows from docs 01/03/08/11. Unmatched `07-northern` and
`07-q1` stay unmatched. No text-only replacements.

Part 13 frozen comparison points (not retrained):

* Fresh 07: parse 4/4, vetoes 0, unsafe 0, eligibility 4/4, recall
  1/1, rejection 3/3. Image ablation: 0 flips.
* Known challenge: parse 17/17, vetoes 0, unsafe 0, role heading
  exact 10/11, verifier eligibility 16/17. FP: `08-numeral-3`,
  already blocked by R2.

### Registered predictions (frozen before plumbing, dataset, or the one run)

1. `[H]` The same 31-row binary eligibility task trains successfully
   without images.
2. `[H]` Fresh doc 07 remains parse 4/4, zero true-heading vetoes,
   zero architecture unsafe, accuracy 4/4.
3. `[H]` Known development challenge remains zero architecture unsafe
   with zero verifier-caused heading vetoes and role heading exact
   ≥9/11.
4. `[H]` Text-only verifier predictions on doc 07 match the Part-13
   marked verifier.
5. `[H]` The simpler verifier is at least as good as the marked
   verifier on the development gates.
6. `[H]` No images, crops, vision training, larger model, new rule,
   or additional data are needed.
7. `[H]` Holdout 2 remains sealed.

Spent Holdout 1 is not run in this spike even if development is
perfect. Mixing residuals in would turn an architecture comparison
into a failure-explanation experiment.

### Stop rule (after Gate 1, and Gate 2 only if Gate 1 passes)

* **A** — text-only matches or beats marked on both gates, no extra
  vetoes or unsafe promotions, usefulness holds. Prefer text-only.
  Marked verifier remains experimental evidence, not architecture.
* **B** — text-only fails fresh 07; marked passed. STOP. Report
  which rows differ. Do not enable `--train-vision`.
* **C** — fresh 07 passes, probes regress. STOP. Report
  disagreements. Do not patch the probe misses.
* **D** — outputs effectively identical everywhere. Marked-image
  training path is functionally redundant on all available
  development evidence.

Do not run Holdout 2.

### Dataset reconstruction — Gate 0 population

`--emit-verify-text-sft` loaded `out/gen-sft-verify/train.json`, replaced
the visual stem, dropped the `image` column, and zipped rows onto the
frozen Part-13 ID order. Image-filename document prefixes were checked
against those IDs. No PDF re-dump. No 43-card re-filter.

| | |
|---|---|
| n | **31** |
| heading true / false | **18 / 13** |
| ID set | exact Part-13 train IDs |
| documents | 02/04/05/06/10/12 |
| sha256 (`train.json`) | `43b0c82a500511465fe5fba6ba76b0846703d93661fd4d3f470fcbcdee3ab6f1` |

`[V]` **pass.** Not a dataset-reproduction failure.

SFT: gitignored `out/gen-sft-verify-text/train.json` (`messages` only).
No marked PNG generation.

### Training health — `out/adapter-verify-text`

```
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset out/gen-sft-verify-text \
  --split train --batch-size 1 --lora-rank 8 --epochs 6 \
  --steps-per-report 10 --steps-per-save 1000 \
  --train-on-completions \
  --output-path out/adapter-verify-text
```

No `--train-vision`. No `--image-resize-shape`. No `--grad-checkpoint`.
One run. `TRAIN_EXIT:0`.

| | |
|---|---|
| rows | 31 (18 true / 13 false) |
| iters | 186 = (31 // 1) × 6 |
| loss | 0.1085 (iter 10) → 0.000021 (iter 186); no NaN |
| peak mem | 8.495 GB |
| adapter | 62 MiB `adapters.safetensors` |
| LoRA keys | `language_model.*` only |
| trainable | 16.232448 M / 4539.264 M (0.358%) |
| tokens | 24,798 (~133/example; Part 13 image-bearing was ~1,886–1,900) |

Adapter written and loads. Binary JSON parses on every eval row below.

`[V]` **pass.**

### Gate 1 — fresh document 07

`run.py --eval-verify-text --pdf-dir out/eval-tagged --match-path valid-07.json`

Mapped 4/6. Unmatched, not replaced: `07-northern`, `07-q1`.

| id | GT | text role | Part 13 marked | Part 13 ablate | Part 14 text | applied? | final |
|---|---|---|---|---|---|---|---|
| 07-h1 | true | H1 | true | true | true | no (keep H1) | H1 |
| 07-intro | false | P | false | false | false | no | P |
| 07-chart-title | false | H2 | false | false | false | no (keep H2) | H2 |
| 07-cap | false | P | false | false | false | no | P |

Parse **4/4**. True-heading vetoes **0**. Unsafe **0**. H1 eligible.
Not all-false. Accuracy **4/4**. Recall **1/1**. Rejection **3/3**.
Confusion TP1 TN3 FP0 FN0.

Exact agreement with Part-13 marked: **4/4**. With Part-13 image
ablation: **4/4**. Zero heading/role/final disagreements.

`[V]` **pass.** Logs: `out/verify-07/verify-text.jsonl`.

### Gate 2 — known development challenge

Only because Gate 1 passed.

`run.py --eval-verify-text --pdf-dir out/eval-tagged --match-path probes.json`

Architecture: source type → ancestry → `out/adapter-role` → R2 →
selective `out/adapter-verify-text` → deterministic action.

Parse **17/17**. Verifier-caused heading vetoes **0**. Final unsafe
**0**. Role-layer heading exact **10/11** (≥9/11). No new heading
demotions (verifier never said false on a GT heading).

| id | GT | text role | verifier | applied? | final |
|---|---|---|---|---|---|
| 01-h3-regional | H3 | H2 | true | yes (H3→H2) | H2 (preserved model_role) |
| 01-h2-actions | H2 | H2 | true | no | H2 |
| 03-h1 | H1 | H1 | true | no | H1 |
| 08-numeral-3 | P | H1 | true | no (R2) | P |
| 11-h1-terms | H1 | H1 | true | no | H1 |
| 11-h2-eligibility | H2 | H2 | true | no | H2 |
| 11-h2-applying | H2 | H2 | true | no | H2 |
| 11-h2-contact | H2 | H2 | true | no | H2 |

Verifier accuracy 16/17 (FP: `08-numeral-3` `heading:true`; R2 already
blocks). Recall 11/11. Non-heading rejection 5/6. The verifier does
not get credit for R2.

Row-level disagreement vs Part-13 marked verifier: **0** of 17
(heading, `model_role`, `final_role`, `verify_applied`, `action`,
`unsafe`).

`[V]` **pass.** Logs: `out/verify-probes/verify-text.jsonl`.

### Direct Part-13 comparison

| metric | Part 13 marked verifier | Part 14 text-only verifier |
|---|---|---|
| train rows | 31 | 31 |
| epochs | 6 | 6 |
| fresh-07 parse | 4/4 | 4/4 |
| fresh-07 eligibility accuracy | 4/4 | 4/4 |
| fresh-07 true-heading vetoes | 0 | 0 |
| fresh-07 final unsafe | 0 | 0 |
| probe parse | 17/17 | 17/17 |
| probe eligibility accuracy | 16/17 | 16/17 |
| probe true-heading vetoes | 0 | 0 |
| probe final unsafe | 0 | 0 |
| role heading exact | 10/11 | 10/11 |
| peak memory | 14.057 GB | 8.495 GB |
| adapter size | 62 MiB | 62 MiB |

The FP is the same row (`08-numeral-3`). The role miss is the same
row (`01-h3-regional`). No additional vetoes. No additional unsafe
promotions.

### Predictions scored

1. `[H]` Same 31-row binary task trains without images. **Confirmed.**
2. `[H]` Fresh 07: parse 4/4, vetoes 0, unsafe 0, accuracy 4/4.
   **Confirmed.**
3. `[H]` Known challenge: zero unsafe, zero verifier-caused heading
   vetoes, role exact ≥9/11. **Confirmed** (10/11).
4. `[H]` Text-only 07 predictions match Part-13 marked. **Confirmed**
   (4/4; ablation also 4/4).
5. `[H]` Simpler verifier at least as good on development gates.
   **Confirmed** (identical).
6. `[H]` No images, crops, vision training, larger model, new rule,
   or extra data. **Confirmed** as constraints held.
7. `[H]` Holdout 2 sealed. **Confirmed.**

### Stop — Outcome D

On every development row that both adapters scored, the text-only
verifier and the marked verifier are identical. The image-bearing
training path is functionally redundant on all available development
evidence.

Prefer:

source type + ancestry → role QLoRA → R2 → selective text-only
eligibility QLoRA → deterministic action

Do not keep the image path because it might help later. YAGNI. The
marked verifier remains experimental evidence, not architecture.
`--eval-verify-marked` stays a measured switch. `out/adapter-verify-marked`
and its SFT stay on disk for reproducibility. They are not the
proposed next component.

Do not run spent Holdout 1 in this spike. The next cheaper experiment,
if any, is that spent-14 diagnostic against this frozen text-only
adapter. Do not run Holdout 2. Do not enable `--train-vision`. Do not
crop. Do not add epochs or examples.

`out/adapter-role` is unchanged.

---

## Part 15 — spent Holdout-1 diagnostic of the frozen text-only verifier

**Date:** 2026-09-11. Same branch. No training. No images. No crop.
No prompt change. No new examples. No Holdout 2. `out/adapter-role`,
`out/adapter-verify-text`, and `out/adapter-verify-marked` are not
modified and are not retrained. Frozen Holdout-1 role predictions
are not regenerated. No production `src/` wiring.

Part 14 Outcome D: the marked-page verifier and a text-only verifier
trained on the same 31 development rows are identical on every
available development evaluation row. The proposed architecture is
now:

1. source-type eligibility;
2. Table/Figure ancestry;
3. text-only `out/adapter-role`;
4. R2;
5. only when the resulting mutation would promote to H1–H6 or change
   an H* level:
6. selective text-only eligibility QLoRA (`out/adapter-verify-text`);
7. deterministic action.

The one question: does that frozen verifier remove the known
post-structure unsafe heading mutations on the exact spent Holdout-1
candidate surface without blocking genuine headings?

This is a spent diagnostic, not a new generalization claim. Holdout 1
is spent.

### Exact comparison surface (14 Part-10 architecture candidates)

Label-independent: after source-type, ancestry, and R2, the frozen
role adapter proposed a non-heading→H* promotion or an H* level
change. Do not recompute selection from GT. Do not add or remove.

| locator | text | GT heading? |
|---|---|---|
| h01-big-text-not-heading:4 | Standard rates | yes |
| h01-big-text-not-heading:11 | Exclusions | yes |
| h02-headings-look-like-body:0 | BERTH ALLOCATION PROCEDURE | yes |
| h06-mixed-table-borders:2 | Fully ruled | yes |
| h06-mixed-table-borders:13 | Horizontal rules only | yes |
| h06-mixed-table-borders:14 | Depot Staff Vehicles | no |
| h09-three-column:8 | spanning banner | no |
| h11-chart-labels-as-headings:4 | Berth Occupancy by Month | no |
| h11-chart-labels-as-headings:7 | Month of year | no |
| h12-visible-title-no-metadata:5 | Recommendation | yes |
| h13-first-big-text-not-title:1 | COMMERCIAL IN CONFIDENCE | no |
| h16-inconsistent-hierarchy:4 | Discrepancies | yes |
| h16-inconsistent-hierarchy:6 | STORAGE | yes |
| h16-inconsistent-hierarchy:10 | Dispatch | yes |

Nine GT headings. Five GT non-headings.

Fail-closed: verifier true → preserve frozen `model_role`; verifier
false → block the proposed heading mutation (keep existing tag; do
not convert an existing H* to P). Parse failure is
`verification_failure`, not a correct non-heading classification.

Reference before verifier (Part 9 Arm B): unsafe **5**, heading exact
**43/51**, detection **47/51**, demotions **0**.

### Registered predictions (frozen before the verifier pass)

1. `[H]` The text-only verifier parses all 14 candidates.
2. `[H]` It accepts all 9 genuine headings.
3. `[H]` It rejects the five known non-heading eligibility cases
   strongly enough that final unsafe falls 5 → 0.
4. `[H]` Heading exact remains 43/51 and detection 47/51 because no
   genuine heading mutation is blocked.
5. `[H]` The text-only verifier succeeds on the residual surface
   without images, confirming Part 14’s simplification.
6. `[H]` No retraining, image path, crop, new heuristic, or larger
   model is required.
7. `[H]` Holdout 2 remains sealed.

### Stop rule

* **A** — zero unsafe, zero genuine-heading vetoes, usefulness
  unchanged. Architecture frozen strongly enough to earn one later
  blind Holdout-2 evaluation. Do not run Holdout 2 in this spike.
  Do not make another training pass before Holdout 2.
* **B** — any genuine heading vetoed. STOP. Do not tune on the spent
  row. Do not restore the image path automatically. Do not run
  Holdout 2.
* **C** — genuine headings preserved but one or more unsafe residuals
  remain. STOP. Do not add examples or a semantic rule from Holdout 1.
  Do not run Holdout 2.
* **D** — parse/reproduction failure. STOP as experiment plumbing.
  Do not reinterpret it as model performance.

Do not run Holdout 2.

### Gate A — execution

`--list-mutations` on frozen Part-9 Arm B `out/h1-scope/rescored-armB.jsonl`
reproduced the exact 14 Part-10 locators, in order. No dump re-filter.
No 444-row role regeneration. `--verify-text-binary` called
`out/adapter-verify-text` with the Part-14 prompt, temperature 0,
thinking disabled, max-tokens 256, no `--image`.

Verifier calls **14**. Role-model calls avoided by structural scope
**320 / 444**, unchanged. `qwen_called` **124**. Parse **14/14**.
`verification_failure` **0**. `verify_input` `text-binary` on all 14.

`[V]` **pass.** Not Outcome D plumbing.

### Gate B — genuine-heading preservation `[V]` **fail**

Nine GT-heading rows. Verifier false on four of them. Hard requirement
was zero vetoes.

| locator | GT | exist | frozen model_role | verifier | applied? | final | veto? |
|---|---|---|---|---|---|---|---|
| h01:4 Standard rates | yes | P | H2 | true | yes | H2 | no |
| h01:11 Exclusions | yes | H3 | H2 | true | yes | H2 | no |
| h02:0 BERTH ALLOCATION PROCEDURE | yes | P | H2 | **false** | yes | P (keep) | **yes** |
| h06:2 Fully ruled | yes | P | H2 | true | yes | H2 | no |
| h06:13 Horizontal rules only | yes | P | H2 | **false** | yes | P (keep) | **yes** |
| h12:5 Recommendation | yes | H1 | H2 | true | yes | H2 | no |
| h16:4 Discrepancies | yes | H3 | H2 | **false** | yes | H3 (keep) | **yes** |
| h16:6 STORAGE | yes | H4 | H2 | **false** | yes | H4 (keep) | **yes** |
| h16:10 Dispatch | yes | H1 | H2 | true | yes | H2 | no |

Verifier-caused true-heading vetoes **4**. Two of those (`h02:0`,
`h06:13`) are promotions blocked back to existing `P` (scorer
demotions). Two (`h16:4`, `h16:6`) fail-close to the existing heading
tag, so they stay headings and are not demotions.

STOP Gate B. Do not adjust the prompt, epochs, threshold, or training
data. Do not restore the image path automatically. Do not run Holdout 2.

Gate C and Gate D are reported below as the spent record, not as a
rescue.

### Gate C — known unsafe residuals (reported; not a passing rung)

Five GT non-headings. Verifier eligibility vs final architecture
safety are not the same number.

| locator | verifier | existing | frozen model_role | final | action | unsafe retag? |
|---|---|---|---|---|---|---|
| h06:14 Depot Staff Vehicles | false | P | H2 | P | keep | no |
| h09:8 spanning banner | false | P | H2 | P | keep | no |
| h11:4 Berth Occupancy by Month | **true** | H1 | H2 | H2 | retag | **yes** |
| h11:7 Month of year | false | P | H2 | P | keep | no |
| h13:1 COMMERCIAL IN CONFIDENCE | **true** | H2 | H1 | H1 | retag | **yes** |

Verifier eligibility on these five: **3/5** (TN `h06:14`, `h09:8`,
`h11:7`; FP `h11:4`, `h13:1`). Final unsafe retags **2 / 5**, not 0/5.
The FPs are both existing `H*` whose proposed level change the
verifier allowed. Fail-close did not apply because the verifier said
true.

### Gate D — full spent-H1 architecture rescore

Frozen Part-9 Arm B jsonl, verifier substituted only on the 14. No
Qwen pass over 444 cards.

| | Part 9 Arm B | Part 15 |
|---|---|---|
| final unsafe promotions | 5 | **2** (`h11:4`, `h13:1`) |
| heading exact / 51 | 43 | **42** |
| heading detection / 51 | 47 | **45** |
| heading demotions | 0 | **2** (`h02:0`, `h06:13`) |
| verifier-caused heading vetoes | — | **4** |
| parse / verification failures | 444/444 | 444/444; verifier 14/14 |
| verifier calls | 0 | 14 |
| role-model calls avoided by structural scope | 320/444 | **320/444** unchanged |

Hard targets all missed: unsafe 0, exact ≥43, detection ≥47, demotions
0, vetoes 0.

Do not claim Holdout-1 generalization. Holdout 1 is spent.

### Comparison (already-recorded Part 10/11/12; Part 13 marked not run)

| row | GT heading? | frozen model_role | Part 10 full-page binary | Part 11 marked binary | Part 12 marked role eligibility | Part 15 text verifier | final |
|---|---|---|---|---|---|---|---|
| h01:4 Standard rates | yes | H2 | true | false | true | true | H2 |
| h01:11 Exclusions | yes | H3→H2 | true | false | true | true | H2 |
| h02:0 BERTH ALLOCATION PROCEDURE | yes | H2 | true | true | true | **false** | P |
| h06:2 Fully ruled | yes | H2 | true | true | true | true | H2 |
| h06:13 Horizontal rules only | yes | H2 | true | false | true | **false** | P |
| h06:14 Depot Staff Vehicles | no | H2 | true | false | false | false | P |
| h09:8 spanning banner | no | H2 | false | false | false | false | P |
| h11:4 Berth Occupancy by Month | no | H1→H2 | true | false | true | true | H2 |
| h11:7 Month of year | no | H2 | false | false | false | false | P |
| h12:5 Recommendation | yes | H1→H2 | true | true | true | true | H2 |
| h13:1 COMMERCIAL IN CONFIDENCE | no | H2→H1 | false | false | true | true | H1 |
| h16:4 Discrepancies | yes | H3→H2 | true | true | true | **false** | H3 |
| h16:6 STORAGE | yes | H4→H2 | true | false | true | **false** | H4 |
| h16:10 Dispatch | yes | H1→H2 | true | true | true | true | H2 |

Part 13 marked verifier: **not run** on Holdout 1.

### Predictions scored

1. `[H]` Parses all 14. **Confirmed.**
2. `[H]` Accepts all 9 genuine headings. **Falsified** (4 vetoes).
3. `[H]` Final unsafe 5 → 0. **Falsified** (2 remain).
4. `[H]` Exact 43/51 and detection 47/51. **Falsified** (42 / 45;
   two demotions).
5. `[H]` Succeeds without images, confirming Part 14. **Falsified**
   as a residual-surface win. Part 14’s development identity still
   stands; it does not clear this spent failure surface.
6. `[H]` No retraining, image path, crop, new heuristic, or larger
   model. **Confirmed** as constraints held.
7. `[H]` Holdout 2 sealed. **Confirmed.**

### Stop — Outcome B

The frozen text-only eligibility verifier is not safe enough to sit
in front of heading mutation. It vetoed genuine headings on the spent
14-row surface.

Do not tune it on the spent row. Do not add examples or a semantic
rule from Holdout 1. Do not restore the image path automatically —
Part 14 already showed marked and text-only identical on development,
and this spike did not re-measure Part 13 on Holdout 1.

Do not run Holdout 2. Do not freeze adapters as a Holdout-2 object.
The architecture is not earned for a blind evaluation.

`out/adapter-role` and `out/adapter-verify-text` are unchanged.
Logs: `out/h1-layout/rescored-armB-text-binary.jsonl`,
`out/h1-layout/score-armB-text-binary.json`.

---

## Part 16 — marked vs text-only on the spent 14-row surface

**Date:** 2026-09-11. Same branch. Inference only. No training. No
crop. No prompt edit. No `--train-vision`. No larger model. No new
examples. Holdout 2 remains sealed. Frozen Holdout-1 role predictions
are not regenerated. `out/adapter-role`, `out/adapter-verify-text`,
and `out/adapter-verify-marked` are not modified and are not
retrained.

Part 15 killed the text-only eligibility verifier as an architecture
component: 4/9 genuine headings vetoed, 2/5 unsafe residuals left,
exact 43→42/51, detection 47→45/51, demotions 0→2.

Part 14 established marked == text-only on development. It did not
establish equivalence on this spent Holdout-1 surface.

The one cheaper unresolved comparison: does the already-trained
Part-13 marked-page eligibility verifier behave differently from the
text-only verifier on the exact same 14 Part-10 mutation candidates?

This is spent diagnostic evidence, not generalization evidence.

### Exact surface (unchanged from Part 15)

The 14 Part-10 architecture candidates, same order. Do not recompute
from GT. Existing Part-11 marked full-page PNGs in
`out/h1-layout/pages/marked/` (14/14 present). Do not redraw unless
a file is mechanically missing.

Nine GT headings: `h01:4`, `h01:11`, `h02:0`, `h06:2`, `h06:13`,
`h12:5`, `h16:4`, `h16:6`, `h16:10`.

Five GT non-headings: `h06:14`, `h09:8`, `h11:4`, `h11:7`, `h13:1`.

Part 15 text-verifier failures of diagnostic interest (report-only,
no special-case): `h02:0`, `h06:13`, `h16:4`, `h16:6`, and the two
unsafe survivors `h11:4`, `h13:1`.

### Invocation (existing path)

`--rescore` of frozen Part-9 Arm B with `--verify-marked-binary` and
`out/adapter-verify-marked`. That is the Part-13 contract: marked
page, `MARKED_ELIGIBILITY_STEM`, Element/Font/Weight/Previous/Next,
no existing tag, temperature 0, thinking disabled, max-tokens 256.
`--eval-verify-marked` is not used here because it would re-call the
role adapter from PDF dumps.

Fail-closed semantics unchanged. Verifier never chooses heading
level. Do not rerun `out/adapter-role`.

### Registered predictions (frozen before the 14 calls)

1. `[H]` The frozen marked verifier parses all 14.
2. `[H]` Its predictions differ from the text-only verifier on at
   least one spent-H1 candidate despite their development
   equivalence.
3. `[H]` Visual localization restores eligibility for the genuine
   headings the text verifier vetoed.
4. `[H]` It rejects `h11:4` and `h13:1` strongly enough to reduce
   final unsafe to zero.
5. `[H]` Spent-H1 heading exact remains at least 43/51, detection at
   least 47/51, and demotions remain zero.
6. `[H]` No retraining, crop, prompt tuning, semantic heuristic, or
   larger model is required.
7. `[H]` Holdout 2 remains sealed.

### Stop rule

* **A** — true-heading vetoes 0, final unsafe 0, exact ≥43/51,
  detection ≥47/51, demotions 0, no verification failure. Visual
  input is load-bearing on the spent failure surface. Overturn
  Part 14 YAGNI. Freeze hashes. Do not run Holdout 2 in this spike.
* **B** — marked and text-only effectively identical. Visual path
  redundant on development and the spent surface. Do not train
  vision, crop, or run Holdout 2.
* **C** — marked differs but still vetoes any genuine heading. Not
  safe for mutation gating. Do not tune on spent rows. Do not run
  Holdout 2.
* **D** — genuine headings preserved but an unsafe residual remains.
  Insufficient specificity. Do not add a Holdout-1 example, regex,
  prompt clause, or crop. Do not run Holdout 2.
* **E** — reproduction / parse failure. STOP as plumbing.

Do not run Holdout 2.

### Gate A — execution

Exact 14 locators from `out/h1-layout/part10-candidates.json`, identical
to Part 15. All 14 Part-11 marked PNGs present under
`out/h1-layout/pages/marked/`. mtimes unchanged after the run (0
redraws). `--verify-marked-binary` on frozen Part-9 Arm B
`out/h1-scope/rescored-armB.jsonl`, adapter
`out/adapter-verify-marked`, boxes from `out/h1-layout/blocks.json`
(already-recorded Part-11 coordinates). `--eval-verify-marked` was
not used: it would re-call the role adapter.

Verifier calls **14**. Role-model calls avoided by structural scope
**320 / 444**, unchanged. `qwen_called` **124**. Parse **14/14**.
`verification_failure` **0**. `verify_input` `marked-binary` on all
14. Markers not regenerated.

`[V]` **pass.** Not Outcome E.

### Gate B — genuine-heading preservation `[V]` **pass**

Zero of nine GT headings received `heading:false`.

| locator | GT | exist | frozen model_role | Part 15 text | Part 16 marked | final | veto? |
|---|---|---|---|---|---|---|---|
| h01:4 Standard rates | yes | P | H2 | true | true | H2 | no |
| h01:11 Exclusions | yes | H3 | H2 | true | true | H2 | no |
| h02:0 BERTH ALLOCATION PROCEDURE | yes | P | H2 | false | **true** | H2 | no |
| h06:2 Fully ruled | yes | P | H2 | true | true | H2 | no |
| h06:13 Horizontal rules only | yes | P | H2 | false | **true** | H2 | no |
| h12:5 Recommendation | yes | H1 | H2 | true | true | H2 | no |
| h16:4 Discrepancies | yes | H3 | H2 | false | **true** | H2 | no |
| h16:6 STORAGE | yes | H4 | H2 | false | **true** | H2 | no |
| h16:10 Dispatch | yes | H1 | H2 | true | true | H2 | no |

The four Part-15 vetoes are heading-eligible again. No special-case.

### Gate C — unsafe residual rejection `[V]` **pass**

Raw marked-verifier eligibility on the five GT non-headings: **5/5**
(`heading:false` on all five). False-positive non-headings: **0**.

| locator | marked verifier | existing | frozen model_role | final | action | unsafe retag? |
|---|---|---|---|---|---|---|
| h06:14 Depot Staff Vehicles | false | P | H2 | P | keep | no |
| h09:8 spanning banner | false | P | H2 | P | keep | no |
| h11:4 Berth Occupancy by Month | **false** | H1 | H2 | H1 | keep | no |
| h11:7 Month of year | false | P | H2 | P | keep | no |
| h13:1 COMMERCIAL IN CONFIDENCE | **false** | H2 | H1 | H2 | keep | no |

Final unsafe retags **0 / 5**.

`h11:4` and `h13:1` do **not** remain eligible. The verifier said
false. Fail-close keeps the existing `H1` / `H2`; that is not scored
as an unsafe retag (`derived_action = keep`). The document still
carries those existing heading tags. The architecture did not apply
the role adapter’s proposed mutation.

### Gate D — spent-H1 architecture rescore `[V]` **pass**

Frozen Part-9 Arm B jsonl, marked verifier substituted only on the
14. No model call on the remaining 430 rows.

| | Part 9 Arm B | Part 15 text | Part 16 marked |
|---|---|---|---|
| final unsafe promotions | 5 | 2 | **0** |
| heading exact / 51 | 43 | 42 | **43** |
| heading detection / 51 | 47 | 45 | **47** |
| heading demotions | 0 | 2 | **0** |
| verifier-caused heading vetoes | — | 4 | **0** |
| verification failures | — | 0 | **0** |
| verifier calls | 0 | 14 | 14 |
| role-model calls avoided | 320/444 | 320/444 | **320/444** |

Hard targets all met. Do not claim Holdout-1 generalization. Holdout
1 is spent. This is the diagnostic that Part 14’s development
identity was a development-set artifact.

### Direct comparison

| locator | GT heading? | existing | frozen model_role | Part 15 text | Part 16 marked | disagreement | final |
|---|---|---|---|---|---|---|---|
| h01:4 Standard rates | yes | P | H2 | true | true | no | H2 |
| h01:11 Exclusions | yes | H3 | H2 | true | true | no | H2 |
| h02:0 BERTH ALLOCATION PROCEDURE | yes | P | H2 | false | true | yes | H2 |
| h06:2 Fully ruled | yes | P | H2 | true | true | no | H2 |
| h06:13 Horizontal rules only | yes | P | H2 | false | true | yes | H2 |
| h06:14 Depot Staff Vehicles | no | P | H2 | false | false | no | P |
| h09:8 spanning banner | no | P | H2 | false | false | no | P |
| h11:4 Berth Occupancy by Month | no | H1 | H2 | true | false | yes | H1 keep |
| h11:7 Month of year | no | P | H2 | false | false | no | P |
| h12:5 Recommendation | yes | H1 | H2 | true | true | no | H2 |
| h13:1 COMMERCIAL IN CONFIDENCE | no | H2 | H1 | true | false | yes | H2 keep |
| h16:4 Discrepancies | yes | H3 | H2 | false | true | yes | H2 |
| h16:6 STORAGE | yes | H4 | H2 | false | true | yes | H2 |
| h16:10 Dispatch | yes | H1 | H2 | true | true | no | H2 |

Disagreements **6 / 14**, all beneficial (text wrong → marked
correct). Harmful flips **0**. Unchanged correct **8**. Unchanged
wrong **0**.

The disagreements produce a safe architecture: they restore the four
genuine-heading mutations and block the two remaining unsafe retags.

### Predictions scored

1. `[H]` Parses all 14. **Confirmed.**
2. `[H]` Differs from text-only on at least one spent-H1 candidate.
   **Confirmed** (6).
3. `[H]` Restores eligibility for the genuine headings the text
   verifier vetoed. **Confirmed** (all four).
4. `[H]` Rejects `h11:4` and `h13:1`; final unsafe 0. **Confirmed.**
5. `[H]` Exact ≥43/51, detection ≥47/51, demotions 0. **Confirmed**
   (43 / 47 / 0).
6. `[H]` No retraining, crop, prompt tuning, heuristic, or larger
   model. **Confirmed** as constraints held.
7. `[H]` Holdout 2 sealed. **Confirmed.**

### Stop — Outcome A

The visual input is functionally redundant on the existing
development set but becomes load-bearing on the spent Holdout-1
failure surface. Part 14’s YAGNI conclusion is overturned on that
evidence.

Proposed architecture:

source-type eligibility → Table/Figure ancestry → role-only QLoRA →
R2 → selective **marked** eligibility QLoRA → deterministic action

`out/adapter-verify-text` remains experimental evidence that this
surface is not learnable from the same 31 rows without the page.
It is not the architecture component.

Do not run Holdout 2 in this spike. Do not train. Do not crop. The
next spike, if any, is one blind Holdout-2 evaluation of the frozen
object below.

### Architecture freeze (Outcome A)

SHA-256 recorded before Holdout 2. No model, data, prompt, or
architecture change after the freeze commit and before that
evaluation, except mechanical code required to execute this exact
object, which must be recorded first.

| object | SHA-256 |
|---|---|
| base | `mlx-community/Qwen3.5-4B-MLX-4bit` (4-bit MLX; LoRA rank 8, alpha 16, language-side only) |
| `out/adapter-role/adapters.safetensors` | `8178c345f9f195d93fc3f099a22809ac0145a03915b96d6cbeb9dd02fe68dfdb` |
| `out/adapter-verify-marked/adapters.safetensors` | `7cecddda6e546dfcc4366daf2ab920a299dd14731d4d8b239afa8d043c0824a8` |
| both `adapter_config.json` | `51518b19e2a1ec53f75a40c119de15da988dca39344e05b7e917ecacc6d31d82` |
| `ROLE_ONLY_STEM` | `5aed45055e21db61a3209d9ad38483f59e1be519f459f06630b373754e5518df` |
| `MARKED_ELIGIBILITY_STEM` | `e5f8d312b57c3c9a7b9a4ab0b30269bcfd009d4ce7d216c2dcd2176b09f39902` |
| architecture order string | `6ef2ef08c847227f6a58d8bbd4ee1f71fae244f384412039046d92696a4e2705` |
| `experiments/qwen-role-decisions/run.py` (R2, structural scope, scoring, eval) | `096f83e1dbab8b411ebfeb7401a7f11164e65fbc01116fca903721a027c71934` |
| `experiments/qwen-role-decisions/Mark.java` | `6ed6bea4f3d49cb8e7170b7b61abad655a4ded21076ddba7e76a31538379a650` |
| `experiments/qwen-role-decisions/Cards.java` | `31a268d67e9dc374ae129564a3e95e8e4011f2faf0aee73e0005acc456efa29b` |
| `src/integrations/documents/java/Preview.java` | `1d6b11023107a1683dd842c9cde6918486c4240ea2be0ff62ea2b1a89916b348` |

Architecture order: source-type → Table/Figure ancestry → role-only
QLoRA → R2 → selective marked eligibility QLoRA → deterministic
action.

Freeze commit: `fc50a3c` (records the hash table above; this
pointer is documentation only).

Logs: `out/h1-layout/rescored-armB-marked-binary.jsonl`,
`out/h1-layout/score-armB-marked-binary.json`.

---

## Part 17 — Blind Holdout 2 of the frozen Part-16 architecture

**Date:** 2026-09-11. Same branch. No training. No prompt edit. No crop.
No threshold. No semantic rule. No model sweep. No extra development
examples. No Holdout-1-derived correction. No production integration.
Holdout-2 labels are closed until the prediction artifact is frozen and
hashed. Part 16 is spent diagnostic evidence and is not independent
validation.

### The one question

> Does the completely frozen Part-16 architecture remain safe and useful
> on untouched Holdout 2 when executed through the real PDF bridge?

Frozen order: source-type eligibility → Table/Figure ancestry →
role-only QLoRA → R2 → selective marked eligibility QLoRA →
deterministic action.

### Gate 0 — freeze verification (before any Holdout-2 file is opened)

Disk SHA-256 vs Part 16 table. All eleven required objects **match**.
No unexpected difference. Holdout 2 may open at the PDF-bridge layer
only.

| object | Part 16 | disk | match |
|---|---|---|---|
| `out/adapter-role/adapters.safetensors` | `8178c345…fe68dfdb` | same | yes |
| `out/adapter-role/adapter_config.json` | `51518b19…6d31d82` | same | yes |
| `out/adapter-verify-marked/adapters.safetensors` | `7cecddda…c0824a8` | same | yes |
| `out/adapter-verify-marked/adapter_config.json` | `51518b19…6d31d82` | same | yes |
| `ROLE_ONLY_STEM` | `5aed4505…5518df` | same | yes |
| `MARKED_ELIGIBILITY_STEM` | `e5f8d312…39902` | same | yes |
| architecture order string | `6ef2ef08…a4e2705` | same | yes |
| `experiments/qwen-role-decisions/run.py` | `096f83e1…27c71934` | same | yes |
| `experiments/qwen-role-decisions/Mark.java` | `6ed6bea4…a31538379a650` | same | yes |
| `experiments/qwen-role-decisions/Cards.java` | `31a268d6…efa29b` | same | yes |
| `src/integrations/documents/java/Preview.java` | `1d6b1102…a89916b348` | same | yes |

Base checkpoint files already recorded earlier in this experiment at
`out/base-checkpoint.sha256`. Same local snapshot
`mlx-community/Qwen3.5-4B-MLX-4bit` /
`32f3e8ecf65426fc3306969496342d504bfa13f3`. Not downloaded. Not
refreshed.

| object | SHA-256 |
|---|---|
| `model.safetensors` | `5fb9acd0246866381cf8c5c354c6db1019f6498eec4ccb4f5edcc71ffeacb2db` |
| `config.json` | `f3efc81b2ea8d96a45301037d3ccccbcccdef44a961845c87f286aaddbc6eaaa` |

These are the same two files already hashed in `out/base-checkpoint.sha256`.

Evaluation commit after this mechanical freeze check: recorded in the
commit that adds this section.

### Blindness

Before predictions: do not open Holdout-2 ground truth, do not inspect
per-document expected headings, do not hand-author cards, do not select
candidates using GT, do not retune structural scope, do not inspect
model failures to decide whether to continue. The bridge may
mechanically process the PDFs. Labels stay closed until
`predictions.frozen.jsonl` is hashed.

### Existing execution path (no new inference implementation)

Same real-PDF bridge as Part 8, then the Part-16 marked-verifier rescore
over **all** architecture mutations, not the spent 14-row locator list.

1. `generate-holdout.mjs holdout2 out/holdout2`
2. `run-opendataloader.mjs out/holdout2 out/holdout2-tagged`
3. `run.py --dump-dir <tagged> --out-dir out/h2 --predict --offline --role-only --r2-veto --adapter-path out/adapter-role --arm B`
4. `run.py --rescore out/h2/predictions.jsonl --arm B --from-blocks out/h2/blocks.json --list-mutations` (label-independent)
5. `run.py --rescore out/h2/predictions.jsonl --arm B --verify-marked-binary --adapter-path out/adapter-verify-marked --from-blocks out/h2/blocks.json --pdf-dir <tagged> --verify-locators <mutations> --out-dir out/h2`

`--verify-locators` is required so `--verify-marked-binary` does not
default to the spent Part-10 14-row list. The locator list is
`mutation_locators` output: post-structure / post-R2 heading mutations
only. No GT.

Settings unchanged: temperature 0, thinking disabled, max-tokens 256,
role-only stem, marked eligibility stem, no existing tag in either
prompt, no crop, no role adapter on the verifier call.

### Registered predictions (frozen before labels)

1. `[H]` The frozen architecture executes Holdout 2 without bridge or
   parse failure that prevents scoring.
2. `[H]` Structural scope again removes a substantial portion of
   obviously ineligible heading candidates before Qwen.
3. `[H]` Final unsafe retags on Holdout 2 are zero.
4. `[H]` The marked verifier vetoes zero genuine headings.
5. `[H]` Exact heading-level accuracy remains ≥80%.
6. `[H]` R2 has zero true-heading collisions.
7. `[H]` The marked verifier makes at least one safety-relevant
   decision that would differ from accepting the role-model mutation
   blindly. Informative, not required for the win.
8. `[H]` No retraining, prompt change, crop, semantic heuristic, or
   larger model is needed.

### Stop rule

* **A** — final unsafe retags 0, verifier heading demotions 0, R2
  heading collisions 0, heading exact ≥80%, execution complete, freeze
  intact. Load-bearing enough to earn a later production-integration
  experiment. Do not integrate here. Do not retrain.
* **B** — any final unsafe retag. STOP. Classify mechanism only after
  scoring. Do not patch. Holdout 2 is spent. No second “blind” run.
* **C** — verifier harms a true heading. STOP. Do not tune marker or
  prompt against Holdout 2.
* **D** — safety holds but exact heading accuracy <80% or detection
  collapses. STOP. Do not add epochs or restore `existing_tag`.
* **E** — bridge / extraction prevents meaningful scoring. STOP as
  bridge evidence.
* **F** — mutation safety and usefulness pass, but some GT non-headings
  entered as existing H* and stayed H* with `action=keep`. Report
  `pre-existing_bad_heading_kept`. Do not fail the registered
  mutation-safety gate solely for those. Distinguish mutation safety
  from end-state semantic correctness.

One frozen architecture. One blind prediction artifact. One score.
No Part 17B.

### Scoring (frozen definitions; labels still closed)

Unsafe retag = GT non-heading whose `final_role` is H1–H6 **and**
`derived_action` is `retag`. Same as Part 8. Do not move that
goalpost.

Usefulness: exact heading-level accuracy ≥80% over
`headingHierarchy`, unmatched GT headings from bridge/segmentation
reported separately. Safety must not be achieved by collapse-to-
nonheading.

After labels, also report (not a new gate): role-model-only unsafe,
unsafe after source/ancestry, unsafe after R2, unsafe after marked
verifier, verifier invocation vs GT, verifier-caused genuine-heading
demotions, H→H level changes blocked by the verifier, and
`pre-existing_bad_heading_kept`.

### Freeze check commit

`3d95427` — Part 17 predictions registered; Gate 0 matched; base
checkpoint hashes recorded. Labels still closed.

### Prediction freeze (before labels)

Predictions frozen. Do not regenerate. Labels not yet opened.

| | |
|---|---|
| freeze-check commit | `3d95427` |
| path | gitignored `experiments/qwen-role-decisions/out/h2/predictions.frozen.jsonl` |
| predictions SHA-256 | `75cf5222f8716af5293bddae5f09bfcb23d713cfd9a0265406ff6e460bee7bc9` |
| PDFs | 16/16 ODL-tagged |
| evaluable BLOCK candidates | 534 |
| parsed | **534/534** |
| bridge failures | **3**, all `empty_text` (`k11:0`, `k11:4`, `k11:7`) |
| role-model invocations | **108** |
| structural skips | **426/534** (ancestry 376, source_type 50) |
| R2 matches | **0** |
| marked-verifier invocations | **18** (all mutation locators from `mutation_locators`; not the spent Part-10 list) |
| marked PNGs | 18 |
| role parse | **108/108** |
| verifier parse | **18/18** (`verification_failure` 0) |
| verifier `heading:true` / `false` | 12 / 6 (GT still closed) |
| no GT fields in artifact | confirmed |

Commands:

```
node generate-holdout.mjs holdout2 out/holdout2
node run-opendataloader.mjs out/holdout2 out/holdout2-tagged
HF_HUB_OFFLINE=1 python run.py \
  --dump-dir ../document-remediation/out/holdout2-tagged \
  --out-dir out/h2 --predict --offline --role-only --r2-veto \
  --adapter-path out/adapter-role --arm B
python run.py --rescore out/h2/predictions.jsonl --arm B \
  --from-blocks out/h2/blocks.json --list-mutations
python run.py --rescore out/h2/predictions.jsonl --arm B \
  --verify-marked-binary --adapter-path out/adapter-verify-marked \
  --from-blocks out/h2/blocks.json \
  --pdf-dir ../document-remediation/out/holdout2-tagged \
  --verify-locators out/h2/mutations.json --out-dir out/h2
```

Frozen-object hashes unchanged from Gate 0 / Part 16. `run.py`
`096f83e1…`. Adapters untouched.

Every evaluable candidate received an architectural decision. Labels
were still closed at freeze commit `7427413`. SHA-256 re-checked
immediately before scoring: still `75cf5222…`. Predictions were not
regenerated.

### Labels opened — scoring

`--score-holdout out/h2/predictions.frozen.jsonl --gt-dir holdout2`.
Same Part-8 definitions. `run.py` not modified.

#### Execution `[V]` pass

Every evaluable candidate received a decision. Role parse 108/108.
Verifier parse 18/18. Bridge failures 3 empty-text figures, reported
separately, not as model abstentions. Scoring is possible. Not
Outcome E.

#### Safety — **fail** (hard gate) → Outcome B

Final unsafe retags: **3**.

| stage | unsafe retags |
|---|---|
| role-model-only | 7 |
| after source-type / ancestry | 7 |
| after R2 | 7 (R2 never matched on this corpus) |
| after marked verifier (final) | **3** |

The marked verifier blocked 4 of the 7 role-model mutations. It does
not get credit for the 3 it allowed. Structural scope did not remove
any of these 7. R2 did not remove any.

| locator | text | exist | model | verify | final | mechanism |
|---|---|---|---|---|---|---|
| k07:0 | `VaccineStSoIhcnikfnMlPgaunlteeernusizmxao` | H1 | H2 | true | H2 retag | bridge / segmentation: rotated column headers collapsed into one glyph-soup block that ODL already tagged H1; verifier false-positive |
| k07:21 | `tSoIhcnikfnMlPgaunlteeernus` | P | H1 | true | H1 retag | same rotated-header collapse; a leftover fragment promoted; verifier false-positive |
| k16:43 | Episode | H1 | H2 | true | H2 retag | role classification: glossary term, not in `headingHierarchy`; verifier false-positive |

k07’s GT heading `Vaccine Stock Matrix` is unmatched (below): one
extraction failure produces both an unmatched heading and two unsafe
retags. Do not patch. Do not re-run.

#### Verifier vs revealed GT

18 invocations. `verification_failure` 0.

| | n | `heading:true` | `heading:false` |
|---|---|---|---|
| GT-heading verifier calls | 11 | 9 | **2** |
| GT-nonheading verifier calls | 7 | 3 FP | 4 TN |

Verifier-caused genuine-heading vetoes: **2**. Hard architecture
requirement was 0. Outcome C also fails.

* `k14:3` `backlog.` — GT heading `Backlog` (H2). Existing P, model H3,
  verifier false, final P keep. **Detection demotion.**
* `k16:6` `Position at year end` — GT H3. Existing H1, model H2,
  verifier false, final H1 keep. H→H level change blocked; still
  detected as a heading (H1 vs wanted H3).

The four true-negative blocks (not counted as unsafe): `k01:7` Ward
(kept existing H3), `k07:19` and `k07:20` rotated-header debris
(kept P), `k13:3` Low (kept P). Prediction 7 is confirmed: the
verifier made safety-relevant blocks. It also harmed true headings.

#### Usefulness — **fail** → Outcome D also

GT headings **28/40** exact (70%, bar was ≥80%). Detection **36/40**.
Demotions **3**. Hierarchy confusion **8**. Unmatched **1**.

| want \ got | H1 | H2 | H3 | P | LI |
|---|---|---|---|---|---|
| H1 | 15 |  |  |  |  |
| H2 | 3 | 13 |  | 2 | 1 |
| H3 | 1 | 3 |  |  |  |
| H4 |  | 1 |  |  |  |

Demotions: `k11:9` Lighting (existing LI, source-type skip), `k11:11`
The mark itself (existing P, role kept P), `k14:3` Backlog (verifier
veto). Unmatched: k07 `Vaccine Stock Matrix` (rotated-header
extraction; no card text matched).

Predicting-no-headings did not occur: 36/40 still detected.

#### Pre-existing bad headings kept (not unsafe retags)

**4.** Mutation-safety goalpost unchanged.

| locator | text | exist | action |
|---|---|---|---|
| k01:4 | Uptake by Ward, 2026 | H2 | keep |
| k01:7 | Ward | H3 | keep (verifier blocked H2) |
| k12:2 | Episode | H2 | keep |
| k12:6 | Breach | H2 | keep |

These are upstream tagger headings the architecture declined to
mutate. They are not the registered unsafe-retag failures.

#### R2

Matches **0**. True-heading collisions **0**. No letters-without-letters
ornaments in this corpus. Gate holds; R2 contributed nothing to safety
here.

### Predictions scored

1. `[H]` Executes without a bridge/parse failure that prevents scoring.
   **Confirmed.**
2. `[H]` Structural scope removes a substantial ineligible share.
   **Confirmed** (426/534).
3. `[H]` Final unsafe retags are zero. **Miss** (3).
4. `[H]` Marked verifier vetoes zero genuine headings. **Miss** (2).
5. `[H]` Exact heading-level accuracy ≥80%. **Miss** (28/40).
6. `[H]` R2 has zero true-heading collisions. **Confirmed.**
7. `[H]` Marked verifier makes at least one safety-relevant decision.
   **Confirmed** (4 of 7 model-unsafe blocked). Informative only.
8. `[H]` No retraining, prompt change, crop, heuristic, or larger
   model. **Confirmed.**

### Stop — Outcome B

Any final unsafe retag. Holdout 2 is spent. The frozen Qwen3.5-4B
hybrid did **not** remain safe on an untouched second holdout through
the real PDF bridge.

Outcome C also holds (verifier harmed two genuine headings) and
Outcome D also holds (28/40 exact). They are reported, not used to
open a second run. No Part 17B. No patch. No prompt/marker/crop.
No text-verifier fallback. No production integration.

Part 16 remains spent diagnostic evidence. It is not independent
validation. This Holdout-2 evaluation is.

---

## Part 18 — is role-training coverage the bottleneck?

**Date:** 2026-09-11. Same branch. Part 17 is not rescued. Holdout-1
and Holdout-2 strings, locators, cards, images, and GT rows stay out
of training. `out/adapter-role` is not modified.
`out/adapter-verify-marked` is not used to decide this spike.
No production integration.

### The one question

> Can the same Qwen3.5-4B role-only QLoRA architecture, trained on a
> broader but still development-only role corpus, remove the
> shallow-hierarchy / unsafe-role failure pattern without changing
> model size, inference features, structural rules, or the marked
> verifier?

This is a role-adapter data-coverage experiment, not a Holdout-2
repair. The marked verifier remains frozen and unread for pass/fail.

### Registered predictions (frozen before any new adapter training)

1. `[H]` The development corpus / existing generator can provide
   materially broader hierarchy coverage than the original 43-card
   role set without using spent holdouts.
2. `[H]` The old role adapter reproduces hierarchy weakness on the new
   whole-document validation set.
3. `[H]` Expanded development-only role training reduces H-level
   confusion.
4. `[H]` Expanded training also reduces unsafe non-heading→H*
   proposals rather than merely changing heading levels.
5. `[H]` The new adapter reaches zero model-only unsafe and ≥80%
   exact heading level on the frozen validation documents.
6. `[H]` No image input, verifier change, larger model, or new
   structural rule is required for this role-layer improvement.
7. `[H]` Holdout-1 and Holdout-2 examples remain absent from SFT.

### Gate 0 — development inventory (no SFT rows authored)

Sources inspected: corpus docs 01–12 HTML + `headingHierarchy`;
`train.json` (43 cards, docs 02/04/05/06/10/12); `valid-07.json`;
`probes.json`; `generate-corpus.mjs` (renders existing HTML to PDF);
existing `out/bridge-dev` dump; a fresh real-PDF dump of ODL-tagged
development PDFs into `out/dev-corpus/` (Cards.java, same bridge as
inference). Holdout 1 and Holdout 2 were not searched.

#### 1. True heading counts already in development GT

| level | corpus `headingHierarchy` | original `train.json` |
|---|---|---|
| H1 | 12 | 6 |
| H2 | 21 | 15 |
| H3 | **2** | **1** |
| H4+ | **0** | **0** |
| total | 35 | 22 heading rows of 43 |

The two H3 texts are `Regional detail` (01) and `Northern apron` (12).
There is no H4, H5, or H6 anywhere in development GT. Doc 09 is a
scan; its H1 has no text layer.

#### 2. Representable as real-PDF BLOCK cards

12/12 development PDFs tagged. Evaluable BLOCK cards **199**.
Bridge failures **6**, all `empty_text` (figures / scan).

GT headings matched to a card: **33 / 35**. Unmatched: 09 scan H1;
12 `Northern apron` (the second H3 — no card text matched).

Matched by true level: H1 11, H2 21, H3 **1**, H4+ **0**.

After frozen source-type / ancestry scope, **30** of those matched
headings remain in-scope. The surviving true H3 is still only
`Regional detail`. Expanding to whole-document cards does not create
a second H3 example the bridge can see.

ODL emitted one in-scope `H4` (`12:41` `Quarterly trend by depot`).
That string is **not** in `headingHierarchy`. It is a chart title.
Using it as an H4 target would be relabeling furniture as deeper
hierarchy, which this spike forbids.

#### 3. Heading-like non-headings after frozen scope

In-scope non-GT-heading cards: **88** (plus 30 in-scope true
headings → 118 in-scope / 199).

#### 4. Categories that exist naturally in development

Present:

* ordinary paragraphs (majority of the 88)
* prominent non-headings (02 callout; 08 kicker; 12 cover subtitle /
  option lines; train.json already had 6 of this class)
* table / group labels (03 table caption tagged H2; 04 header-row
  fragments as P)
* chart labels (07 axis ticks and legend; 07/12 chart titles tagged
  H2/H4 by ODL, not GT headings)
* banners / status furniture (08 `Board discussion · not for
  circulation`; 08 numerals `1`/`2`/`3` tagged H1)
* running furniture (01 header/footer; 02 footer tagged H3; 05 page
  labels)
* body-sized true heading: one (`Regional detail`, italic ~12pt)

Absent from development (not recovered from holdouts; just not here):

* glossary / term-like labels as a labeled class
* rotated text
* any true H4–H6

#### 5. Existing generator for deeper hierarchy?

`generate-corpus.mjs` only prints the twelve existing HTML fixtures
to PDF. `generate-holdout.mjs` is the holdout renderer and is not a
development template. There is no seed/template in-repo that emits
new labeled H3/H4 documents without authoring new HTML or copying
spent holdout wording.

### Stop — existing development corpus cannot test the hypothesis

The original 43-card set was already 6 H1 / 15 H2 / 1 H3 / 0 H4+.
Whole-document real-PDF cards add many P/Artifact/table/chart rows.
They add **zero** true H4+ and they add **zero** additional
bridge-visible H3 (the second GT H3 does not appear as a card).

The validation split is equally blocked. A disjoint whole-document
val set that has several H1, several H2, and at least two deeper
headings cannot be cut from this corpus: only two GT H3 exist, only
one is a card, and putting that one in validation leaves training
with no H3. Scoring train as validation is forbidden. Doc 07 is 1 H1
+ chart furniture — Part-5 “1/1 H1” theater.

H4+ remains zero and H3 remains effectively one example.
**STOP before training.**

role-data coverage is the next bottleneck, but the existing
development corpus cannot test it honestly.

Do not fabricate H4 cards by relabeling chart titles. Do not turn
Holdout 2 into training data. Do not author new hierarchy HTML in
this spike. Do not run `out/adapter-role-expanded`. Do not touch
`out/adapter-role`. Do not involve the marked verifier. Do not
production-integrate.

### Predictions scored

1. `[H]` Materially broader hierarchy coverage without spent
   holdouts. **Miss.** Broader *candidate* coverage, not deeper
   hierarchy.
2–6. Not tested. No adapter was trained.
7. `[H]` Holdout examples absent from SFT. **Confirmed** (no SFT
   written).

### Ponytail

Gate 0 inventory, then stop. One dump of the development PDFs for
counts. No expanded dataset. No QLoRA. No verifier. No holdout
rescue.

---

## Part 19 — build the missing development evidence before retraining

**Date:** 2026-09-11. Same branch. Data construction only. No QLoRA.
No inference comparison. No marked verifier. No Holdout-1 or
Holdout-2 rows. No production integration. `out/adapter-role` is not
modified.

Part 18 stopped correctly: the existing 01–12 corpus cannot test the
role-data coverage hypothesis. This spike asks whether the missing
evidence can be constructed and survive the real PDF bridge.

### The one question

> Can we create a small, holdout-independent development extension
> that supplies enough bridge-visible H3/H4 hierarchy and hard
> non-heading examples to test the role-data coverage hypothesis
> honestly?

If this passes, it earns exactly one expanded role-QLoRA experiment
in the next Part. That run is not this spike.

### Registered predictions (frozen before authoring)

1. `[H]` Six small development fixtures can supply at least 12 true
   H3 and 12 true H4 examples without using spent holdout content.
2. `[H]` The existing PDF → ODL → Cards bridge preserves all new
   H3/H4 headings as standalone evaluable cards.
3. `[H]` Source-type / ancestry scope collides with zero new true
   headings.
4. `[H]` The four training documents provide at least 8
   bridge-visible H3 and 8 bridge-visible H4 examples.
5. `[H]` The two validation documents provide at least 4 H3 and 4 H4
   examples, enough that deeper hierarchy is no longer a one-card
   anecdote.
6. `[H]` The same fixtures provide enough heading-like non-headings
   to prevent the next training experiment from being hierarchy-only.
7. `[H]` No Holdout-1 / Holdout-2 row, string-derived imitation,
   image, or GT record is needed.
8. `[H]` No model execution or production architecture is required
   in this Part.

### Fixture path (traced, not rewritten)

* HTML + GT live in `experiments/document-remediation/corpus/`.
* `generate-corpus.mjs` renders every `corpus/*.html` through
  Chromium `page.pdf()`.
* `run-opendataloader.mjs` tags those PDFs (defaults).
* `run.py --dump-dir` / Cards.java emits BLOCK cards with text,
  font_pt, weight, ancestors, locator `{stem}:{i}`.
* GT matching is `text_norm` against `headingHierarchy[].text`
  (`score_holdout` / Part 18 inventory).

New fixtures continue the 01–12 numbering. Split frozen before any
model sees it:

* train: 13, 14, 15, 16
* validation: 17, 18

Hard negatives recorded on each GT as `nonHeadings` (experiment-local
field; comparator does not require it). Semantic expected role is
authored, never inferred from ODL.

No `src/` changes. No Cards.java / ODL special cases.

### Frozen split (do not reshuffle)

* train: `13-workshop-induction`, `14-pump-overhaul`,
  `15-archive-transfer`, `16-shift-handover`
* validation: `17-visitor-brief`, `18-sample-receipt`

Style families (not one CSS template with swapped text):

* 13 Georgia, conventional decreasing sizes
* 14 system-ui, H3/H4 near body size, distinguished by weight
* 15 Palatino, italic H3, lighter H4
* 16 Avenir Next, H2/H3 share size
* 17 Helvetica (validation), quiet H4 against a louder callout
* 18 Times (validation), H2/H3 share size, small-caps H3

### Gate A — authored corpus sanity (before PDF)

`validate-fixtures.mjs` well-formed. Mechanical counts:

| | H1 | H2 | H3 | H4 | H5 | H6 |
|---|---:|---:|---:|---:|---:|---:|
| 13 (train) | 1 | 2 | 3 | 4 | 0 | 0 |
| 14 (train) | 1 | 2 | 3 | 4 | 0 | 0 |
| 15 (train) | 1 | 2 | 3 | 4 | 0 | 0 |
| 16 (train) | 1 | 2 | 3 | 4 | 0 | 0 |
| 17 (val) | 1 | 2 | 3 | 4 | 0 | 0 |
| 18 (val) | 1 | 2 | 3 | 4 | 0 | 0 |
| **total** | **6** | **12** | **18** | **24** | **0** | **0** |

Authored hard negatives: train 12 across nine categories
(running-header, status-line, callout, running-footer, group-label,
table-title, definition-term, body-label, decorative-numeral);
validation 6 across six categories (running-header, callout,
running-footer, body-label, chart-title, status-line).

Validation stems are absent from the training-document list.
No H5/H6 was authored. No banned holdout literal or locator in the
new HTML/GT.

**Gate A: PASS.**

### Gate B — real PDF bridge fidelity

Path used (same tools as Parts 5/18, new stems only):

`corpus/*.html` → `generate-corpus.mjs` (Chromium `page.pdf()`) →
`run-opendataloader.mjs` defaults → `run.py --dump-dir` / Cards.java.

No `--predict`. No adapter. No Qwen.

148 evaluable BLOCK cards, 0 `empty_text` / `missing_font` failures.

GT matching is existing `text_norm` against `headingHierarchy[].text`.

| | authored | standalone BLOCK | in-scope after source-type / ancestry |
|---|---:|---:|---:|
| H1 | 6 | 6 | 6 |
| H2 | 12 | 12 | 12 |
| H3 | 18 | 18 | 18 |
| H4 | 24 | 24 | 24 |
| **total** | **60** | **60** | **60** |

All 42 new H3/H4 headings are their own evaluable cards. None contains
its following body sentence. Font, weight, previous, and next are
present on every matched heading. Source-type / Table-Figure ancestry
removed **zero** true headings. Validation documents remain disjoint.

H1/H2: 18/18 standalone and in-scope. No mechanical miss to record.

ODL's own tags are often wrong (expected): 16's decorative `3` is
`H1`; 17's quiet H4s are `P`; 18's H3s dump as `H1`/`H2`. GT hierarchy
is the authored outline, not ODL.

Mechanical fixture corrections before freeze (same semantic documents;
wording and levels unchanged):

1. Doc 14 H3/H4 at exact body size with 2pt gaps merged heading+body
   into one text run. Increased heading/body gap and a 0.5–1pt size
   delta so H3/H4 stay near body size but are distinct line boxes.
2. Chromium emitted `fi`/`fl` ligatures (`Staffing`, `Workshop floor`),
   which `text_norm` strips, so the existing matcher missed standalone
   cards. `letter-spacing: 0.02–0.03em` plus `"liga" 0` on the six
   fixtures. No Cards.java / ODL change.
3. Doc 14's group-label and table-title clustered into one card.
   A body sentence between them, and a 1pt size difference, split
   them. Headings untouched.

**Gate B: PASS.** 42/42 new headings as standalone real-PDF cards.

### Gate C — post-scope data sufficiency

Cards that would actually reach the role model (in-scope BLOCKS):

| | H1 | H2 | H3 | H4 | P/non-heading from every train doc | authored hard negatives |
|---|---:|---:|---:|---:|---|---:|
| train 13–16 | 4 | 8 | 12 | 16 | yes (14 / 14 / 13 / 13) | 12, nine categories |
| val 17–18 | 2 | 4 | 6 | 8 | — | 6, six categories |

Required floors: train ≥4/8/8/8 and ≥12 negatives across ≥3
categories; val ≥2/4/4/4 and ≥6 negatives across ≥2 categories.

**Gate C: PASS.** No duplicated cards. No H3/H4 oversampled.

### Gate D — frozen card surfaces

Emitted through the same real-PDF bridge. No model prediction was
generated before these files and the document split were frozen.

`experiments/qwen-role-decisions/role-expanded/role-expanded-new-train.json`

* documents: 13, 14, 15, 16 only
* 94 in-scope cards: 40 true H1–H4, 42 ordinary paragraphs,
  12 authored hard negatives
* expect roles: H1 4 / H2 8 / H3 12 / H4 16 / P 54
* SHA-256 `abb2bc78f915ea6c657b699d39c1d6a43bda9455dc532df497b5987c389359df`

`experiments/qwen-role-decisions/role-expanded/role-expanded-valid.json`

* documents: 17, 18 only (whole-document in-scope surface)
* 47 cards: 20 true headings, 21 ordinary paragraphs,
  6 authored hard negatives
* expect roles: H1 2 / H2 4 / H3 6 / H4 8 / P 27
* SHA-256 `207d77b3421438f673de188e88d3168328ef533139cefe51477c88b31c4df07f`

`split.json` SHA-256
`87dc5e69c85fc5ddd9458e96a2847c49c2f47a7609b65f2d82d94119b667d1f9`

Fixture SHA-256 (HTML / GT):

| file | SHA-256 |
|---|---|
| 13-workshop-induction.html | `61db700ba563fa2ea19f7169ff6363e8e188502324db0ce28ccba4fb944ddf82` |
| 13-workshop-induction.ground-truth.json | `b3ff6e83bacd96944db8f97064bc2f6c11fd93eee380fd7c197c637faf3b8237` |
| 14-pump-overhaul.html | `b307dda2c08ee72815bbded39d75dd88cb1503376ab8cb40881e79a9b77102d4` |
| 14-pump-overhaul.ground-truth.json | `41d3e27ea03abced86231e0b78cd38e074e0745b85c26569fe5608e166c28f5d` |
| 15-archive-transfer.html | `2727daf5f455e772cd5a38e17ba3478980942134bd7e1a9aa33ffaebd6be3514` |
| 15-archive-transfer.ground-truth.json | `d9d4245a42b74e3218be39c614efde57f9f5a2f179b381af992404d7b98855a7` |
| 16-shift-handover.html | `d2233e1af0caccaf659d4cc11b71304bab780c41438e76baa5cda5b44c9da688` |
| 16-shift-handover.ground-truth.json | `3c9cd1d3b24af59a9dfc7064f87a315a4f508afd501f16af2629c32b537620a3` |
| 17-visitor-brief.html | `3da381bfc3b5d878bcdb12a877a9f0488295429f00530d5577703ef91f05e355` |
| 17-visitor-brief.ground-truth.json | `298f8ae362c62377dbf78e9d0871502ac66bc668d098d6816e464b6077e81a83` |
| 18-sample-receipt.html | `50c8499ac50a70121da54e8eb580a0033577331f6104936e04dc17a221040248` |
| 18-sample-receipt.ground-truth.json | `68cc418b338ef243dc18caedaf5db59c742e60afe2b8cea1bfc888c6d89bf04b` |

Earlier 43 `train.json` cards are untouched.

### Counts for a later Part 20 mixture decision (not taken here)

1. Original role-training (`train.json`, docs 02/04/05/06/10/12):
   43 cards — H1 6 / H2 15 / H3 1 / H4 0 / P 17 / Artifact 4
2. New training documents (13–16):
   94 cards — H1 4 / H2 8 / H3 12 / H4 16 / P 54
3. If the next spike simply concatenated (1)+(2):
   137 cards — H1 10 / H2 23 / H3 13 / H4 16 / P 71 / Artifact 4
4. New untouched validation (17–18):
   47 cards — H1 2 / H2 4 / H3 6 / H4 8 / P 27

No oversampling. No duplicated hierarchy cards.

### Predictions vs evidence

1. `[H]` Six fixtures can supply ≥12 H3 and ≥12 H4 without spent
   holdout content. **HIT.** Authored H3 18 / H4 24.
2. `[H]` The existing PDF → ODL → Cards bridge preserves all new
   H3/H4 as standalone evaluable cards. **HIT.** 18/18 and 24/24.
3. `[H]` Source-type / ancestry scope collides with zero new true
   headings. **HIT.**
4. `[H]` Four training documents provide ≥8 bridge-visible H3 and
   ≥8 H4. **HIT.** 12 and 16.
5. `[H]` Two validation documents provide ≥4 H3 and ≥4 H4. **HIT.**
   6 and 8.
6. `[H]` Same fixtures provide enough heading-like non-headings.
   **HIT.** Train 12 across nine categories; val 6 across six.
7. `[H]` No Holdout-1 / Holdout-2 row, string-derived imitation,
   image, or GT record is needed. **HIT.**
8. `[H]` No model execution or production architecture is required.
   **HIT.**

### Outcome

**PASS.** Six whole development documents exist. Split frozen
4 train / 2 validation. Hierarchy counts meet the registered
minimums. All H3/H4 survive as standalone real-PDF cards.
Structural scope collides with zero true headings. Hard-negative
minimums are met. No holdout material entered the corpus. Card
surfaces are frozen and hashed.

Then STOP.

The development corpus now has enough bridge-visible H3/H4 and
hard-negative coverage to test whether role-training coverage was
the bottleneck. One expanded role-only QLoRA run is earned next.

Do not train it in Part 19.

---

## Part 20 — does deeper development coverage improve the role adapter?

**Date:** 2026-09-11. Same branch. Role-layer experiment. No fixture
edits. No Holdout-1 / Holdout-2. No marked verifier. No image input.
No structural-rule change. No production integration.
`out/adapter-role` is the frozen reference and is never overwritten.

Part 19 passed: the development corpus now has enough bridge-visible
H3/H4 and hard-negative evidence to test the Part-18 hypothesis.

### The one question

> Does expanding the development-only role-training corpus with the
> frozen Part-19 H3/H4 and hard-negative documents materially improve
> the Qwen3.5-4B role classifier’s hierarchy accuracy and semantic
> heading safety on untouched whole-document development validation?

Score semantic role, not merely mutation safety. A GT non-heading
whose `model_role` is H1–H6 is a false-heading prediction even if the
existing PDF tag is already H* and derived action would be `keep`.

### Registered predictions (frozen before Gate 1 inference)

1. `[H]` The frozen old `out/adapter-role` reproduces the shallow
   hierarchy weakness on the new whole-document validation set.
2. `[H]` Its largest heading errors are concentrated in H3/H4 rather
   than H1.
3. `[H]` The expanded 137-card development-only training population
   materially improves deeper heading-level accuracy.
4. `[H]` Expanded training also reduces false non-heading→H*
   role predictions rather than only moving headings between levels.
5. `[H]` The expanded adapter reaches zero false-heading predictions
   and ≥80% exact heading-level accuracy on docs 17/18.
6. `[H]` H3/H4 no longer behave as a one-example class:
   H3+H4 exact reaches at least 11/14 and detection does not collapse.
7. `[H]` Previously passing development behavior does not materially
   regress.
8. `[H]` No vision, verifier change, larger model, structural-rule
   change, holdout example, or production integration is required.

### Frozen data (verified before any model call)

| file | expected SHA-256 | verified |
|---|---|---|
| `train.json` | *(recorded now)* `1097a038bc0145092c51572e77c8fed3405773418fd1ab60a9011ddfb2fede14` | 43 cards, H1 6 / H2 15 / H3 1 / H4 0 / P 17 / Artifact 4, docs 02/04/05/06/10/12. Not edited. |
| `role-expanded-new-train.json` | `abb2bc78f915ea6c657b699d39c1d6a43bda9455dc532df497b5987c389359df` | match. 94 cards, H1 4 / H2 8 / H3 12 / H4 16 / P 54, docs 13–16 only. |
| `role-expanded-valid.json` | `207d77b3421438f673de188e88d3168328ef533139cefe51477c88b31c4df07f` | match. 47 cards, H1 2 / H2 4 / H3 6 / H4 8 / P 27, docs 17–18 only. |
| `split.json` | `87dc5e69c85fc5ddd9458e96a2847c49c2f47a7609b65f2d82d94119b667d1f9` | match. Train 13–16. Validation 17–18. |

`ROLE_ONLY_STEM` SHA-256
`5aed45055e21db61a3209d9ad38483f59e1be519f459f06630b373754e5518df`
(same as Part 16 freeze).

Frozen `out/adapter-role` (not overwritten this Part):

* `adapters.safetensors` `8178c345f9f195d93fc3f099a22809ac0145a03915b96d6cbeb9dd02fe68dfdb`
* `adapter_config.json` `51518b19e2a1ec53f75a40c119de15da988dca39344e05b7e917ecacc6d31d82`

Base checkpoint hashes unchanged vs Part 16
(`model.safetensors` `5fb9acd0…acb2db`, `config.json` `f3efc81b…c6eaaa`).

### Gate 0 — 137-row training population

Concatenation of the two frozen semantic card sets. No oversampling.
No duplicate H3/H4 rows. No validation row. No Holdout-1 or Holdout-2
row.

`experiments/qwen-role-decisions/role-expanded/role-expanded-train.json`

| role | n |
|---|---:|
| H1 | 10 |
| H2 | 23 |
| H3 | 13 |
| H4 | 16 |
| P | 71 |
| Artifact | 4 |
| **total** | **137** |

SHA-256 `638f83ac7114590e889a813918c213b9d2d29d4750193e7964b8ee61b321390c`

**Gate 0: PASS.** Dataset reproduced. No model call yet.

### Gate 1 — frozen `out/adapter-role` on docs 17/18

Command (role-only; no `--r2-veto`; validation already in-scope so
source-type / ancestry skipped 0 cards; `qwen_called` 47/47):

```
python run.py \
  --offline \
  --role-only \
  --path role-expanded/role-expanded-valid.json \
  --adapter-path out/adapter-role
```

The frozen validation file has no `model` key. An eval copy under
gitignored `out/part20/valid.json` added only
`model: mlx-community/Qwen3.5-4B-MLX-4bit`. The hashed file was not
edited.

`model_role` is the parsed `role` (R2 not applied). Semantic scoring
does not treat an already-bad ODL `H*` tag as a correct classifier.

| metric | old `out/adapter-role` |
|---|---|
| parse | **47/47** |
| exact role /47 | 31/47 |
| heading exact /20 | **6/20** |
| heading detection /20 | 18/20 |
| H1 /2 | **2/2** |
| H2 /4 | **4/4** |
| H3 /6 | **0/6** |
| H4 /8 | **0/8** |
| H3+H4 /14 | **0/14** |
| false-heading predictions /27 | **2/27** |
| unsafe_retag (informational) | 1 |
| heading demotions | 2 |
| derived-action accuracy | 31/47 |

Heading confusion (GT → pred): H1→H1 2; H2→H2 4; H3→H1 1; H3→H2 5;
H4→H2 6; H4→P 2. P→pred: P 25, H2 2.

False-heading predictions:

* `17-visitor-brief:3` callout “Do not enter the machine hall
  unescorted.” GT P, `model_role` H2, existing ODL tag H2, action
  `keep`. Mutation safety would hide this. Semantic role does not.
* `18-sample-receipt:21` chart-title “Receipts by hour.” GT P,
  `model_role` H2, existing H1, action `retag`. This is also
  `unsafe_retag`.

H4 demotions to P: `17-visitor-brief:8` Badges; `:20` Forms. H3 did
not collapse to P (all six detected as H1/H2). H4 did not collapse as
a class (6/8 still detected as some H*). Exact deeper hierarchy is
zero.

Baseline stop required parse 47/47, false-heading 0, heading exact
≥16/20, H3+H4 ≥11/14, detection ≥19/20, no systematic H3 or H4
collapse-to-P. Missed on false-heading, heading exact, H3+H4, and
detection.

**Gate 1: old adapter does not already pass. The single expanded
QLoRA run is earned.**

SFT emitted via existing `card_prompt(ROLE_ONLY_STEM, …,
hide_existing_tag=True)` from the frozen 137 cards. Completions
`{"role":"<gt>"}` only. Artifact retained (4 rows). No existing tag,
page, y-band, bbox, ancestors, image, confidence, or action in the
prompt.

`out/gen-sft-role-expanded/train.json` SHA-256
`8cfa9e1c60c314a8a8318bb347ec8907b0c5fb47bba5e4a2f0e1c7a3a8035d88`
(gitignored). Recorded before training.

### Training health (one run, configuration held with Part 6)

```
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset out/gen-sft-role-expanded \
  --split train \
  --batch-size 1 \
  --lora-rank 8 \
  --epochs 6 \
  --steps-per-report 10 \
  --steps-per-save 1000 \
  --train-on-completions \
  --output-path out/adapter-role-expanded
```

`[V]` `TRAIN_EXIT:0`. Iterations **822** (137 × 6). Learning rate
`2.000e-05`. `#trainable params: 16.232448 M || all params: 4539.264 M
|| trainable%: 0.358%`. Language-side LoRA, rank 8, no vision. Loss
0.257 (iter 10) → **0.000015** (iter 822). No NaN, no crash. Peak mem
9.707 GB. Adapter 62 MiB. `out/adapter-role` hash unchanged
(`8178c345…8dfdb`). Base checkpoint hashes unchanged.

| artifact | SHA-256 |
|---|---|
| `out/adapter-role-expanded/adapters.safetensors` | `a4b7460e6464c8149b10483d00f49b088eb825983a4ba38f188b2116d6d7567a` |
| `out/adapter-role-expanded/adapter_config.json` | `51518b19e2a1ec53f75a40c119de15da988dca39344e05b7e917ecacc6d31d82` |

Loss is not a gate. The training set was not scored as evidence of
generalization.

### Gate 2 — expanded adapter on frozen docs 17/18

Same role-only invocation as Gate 1.
`--adapter-path out/adapter-role-expanded`. `qwen_skipped` 0.
R2 / source-type / ancestry / marked verifier not applied.

| metric | old role adapter | expanded role adapter |
|---|---|---|
| parse | 47/47 | 47/47 |
| exact role /47 | 31/47 | 33/47 |
| heading exact /20 | 6/20 | **9/20** |
| heading detection /20 | 18/20 | **20/20** |
| H1 /2 | 2/2 | 2/2 |
| H2 /4 | 4/4 | 4/4 |
| H3 /6 | 0/6 | **1/6** |
| H4 /8 | 0/8 | **2/8** |
| H3+H4 /14 | 0/14 | **3/14** |
| false-heading predictions /27 | 2/27 | **3/27** |
| heading demotions | 2 | 0 |
| unsafe_retag (informational) | 1 | 2 |
| derived-action accuracy | 31/47 | 33/47 |

Expanded heading confusion (GT → pred): H1→H1 2; H2→H2 4; H3→H3 1;
H3→H2 5; H4→H4 2; H4→H3 6. P→pred: P 24, H2 2, H4 1.

H3/H4 did not collapse to P (detection 6/6 and 8/8). Exact deeper
levels remain far below the gate (3/14, need ≥11/14). Heading exact
9/20, need ≥16/20.

False-heading predictions on the expanded adapter:

1. `17-visitor-brief:3` callout “Do not enter the machine hall
   unescorted.” GT P → H2. Existing ODL tag H2, action `keep`.
   **Represented category** (train 13 callout; original 02-callout).
   Failed. Same error as the old adapter.
2. `17-visitor-brief:22` running-footer “Host copy — not for
   visitors.” GT P → H4, action `retag`. **Represented category**
   (train 13 and 14 running-footers; original furniture). Failed.
   **New** vs the old adapter, which predicted P.
3. `18-sample-receipt:21` chart-title “Receipts by hour.” GT P → H2.
   Existing H1, action `retag`. **Represented category** (original
   `train.json` 12-chart-title). Failed. Same error as the old adapter.

None is an unrepresented development category. None is a bridge
ligature/merge. Ordinary represented hard-negatives that simply
failed.

Changed predictions (old → expanded):

| id | GT | old | expanded |
|---|---|---|---|
| `17-visitor-brief:6` Reception | H3 | H2 | H3 |
| `17-visitor-brief:8` Badges | H4 | P | H3 |
| `17-visitor-brief:10` Cloakroom | H4 | H2 | H3 |
| `17-visitor-brief:14` Workshop floor | H4 | H2 | H3 |
| `17-visitor-brief:20` Forms | H4 | P | H3 |
| `17-visitor-brief:22` Host copy — not for visitors | P | P | **H4** |
| `18-sample-receipt:4` Paper forms | H3 | H1 | H2 |
| `18-sample-receipt:6` Batch numbers | H4 | H2 | H4 |
| `18-sample-receipt:8` Time of receipt | H4 | H2 | H4 |
| `18-sample-receipt:12` Unique ids | H4 | H2 | H3 |
| `18-sample-receipt:18` Shelf map | H4 | H2 | H3 |

Deeper headings moved closer (P/H2 → H3/H4) but overshot a
represented footer into H4. Validation differences were not used to
retrain.

**Gate 2: FAIL.** Parse complete. False-heading predictions **3/27**,
not 0. Heading exact 9/20 (<16). H3+H4 3/14 (<11). Detection 20/20
clears that one sub-gate and H3/H4 do not collapse to P.

Gate 3 was not run. Known-development regression is only asked if
primary validation passes.

### Predictions vs evidence

1. `[H]` Old adapter reproduces shallow hierarchy on 17/18. **HIT.**
   H3+H4 exact 0/14; H1 2/2.
2. `[H]` Largest heading errors in H3/H4 rather than H1. **HIT.**
3. `[H]` Expanded 137-card set materially improves deeper
   heading-level accuracy. **MISS** against the registered bar.
   H3+H4 exact 0→3/14; heading exact 6→9/20. Directionally up, not
   to ≥11/14 or ≥16/20.
4. `[H]` Expanded training also reduces false non-heading→H*.
   **MISS.** 2→3. A new running-footer false heading appeared.
5. `[H]` Zero false-heading predictions and ≥80% heading exact.
   **MISS.** 3 false headings; 9/20 = 45%.
6. `[H]` H3+H4 exact ≥11/14 and detection does not collapse. **MISS**
   on exact (3/14). Detection 20/20, no collapse-to-P.
7. `[H]` Previously passing development behavior does not regress.
   **Not evaluated.** Gate 3 is gated on Gate 2.
8. `[H]` No vision, verifier, larger model, structural-rule change,
   holdout, or production integration. **HIT.**

### Outcome

**Outcome C — expanded adapter still produces a false heading.**

STOP.

Training-data expansion alone did not solve role safety. The three
false headings are represented hard-negative categories that simply
failed (callout, running-footer, chart-title). One of them is new
relative to the old adapter.

Hierarchy also remains below Gate 2 even after setting safety aside
(9/20 exact, 3/14 H3+H4). That is additional evidence, not a second
run. Do not add epochs. Do not oversample H4. Do not add the failing
row and retrain. Do not blend adapters.

`out/adapter-role` was not replaced. The marked verifier was not
combined with this adapter. Holdout 1 / Holdout 2 were not scored.

The next earned step is not a holdout evaluation and not a second
QLoRA under this configuration. Role-training coverage moved H3/H4
detection and some exact levels, and it did not buy semantic heading
safety on two untouched development documents.

## Part 21 — can the existing marked verifier cleanly own heading eligibility?

**Date:** 2026-09-11. Same branch. Inference only. No QLoRA. No
fixture edits. No new examples. No prompt change. No crop. No
`--train-vision`. No larger model. No Holdout-1 / Holdout-2. No
production integration. Neither role adapter is invoked.

Part 20: joint role coverage improved detection and did not solve
semantic safety or hierarchy. This Part isolates eligibility from
level on the same untouched docs 17/18 surface.

### The one question

> Can the already-trained marked-page eligibility verifier cleanly
> separate document headings from non-headings on the untouched
> Part-19 validation documents, independent of heading-level
> classification?

Score the verifier itself on all 47 frozen cards. Direct binary
semantic scoring: `gt_heading = expect.role in H1..H6` against
`verify_heading = parsed["heading"]`. An already-bad ODL tag gives
no credit. No role adapter, R2, source-type, ancestry, or selective
invocation.

### Registered predictions (frozen before the 47 verifier calls)

1. `[H]` The frozen marked verifier executes and parses all 47 rows
   without retraining or source modification.
2. `[H]` It accepts all 20 genuine headings, including all 14 H3/H4
   headings.
3. `[H]` It rejects all 27 GT non-headings.
4. `[H]` It rejects the three represented hard-negative classes the
   expanded role adapter promoted: callout, running footer, and chart
   title.
5. `[H]` Its heading/non-heading boundary is materially cleaner than
   either role adapter’s joint role boundary on this validation set.
6. `[H]` No role-model invocation, R2, structural gate, crop,
   retraining, or larger model is required to answer this question.
7. `[H]` Holdout 1 and Holdout 2 are not run.

### Frozen objects (verified before inference)

| file | expected SHA-256 | verified |
|---|---|---|
| `role-expanded-valid.json` | `207d77b3421438f673de188e88d3168328ef533139cefe51477c88b31c4df07f` | match. 47 cards, docs 17/18 only, H1 2 / H2 4 / H3 6 / H4 8 / P 27. 20 GT headings, 27 GT non-headings. No box fields (role-layer freeze). |
| `out/adapter-verify-marked/adapters.safetensors` | `7cecddda6e546dfcc4366daf2ab920a299dd14731d4d8b239afa8d043c0824a8` | match. |
| `out/adapter-verify-marked/adapter_config.json` | `51518b19e2a1ec53f75a40c119de15da988dca39344e05b7e917ecacc6d31d82` | match. |
| `MARKED_ELIGIBILITY_STEM` | `e5f8d312b57c3c9a7b9a4ab0b30269bcfd009d4ce7d216c2dcd2176b09f39902` | match. |
| `Mark.java` | `6ed6bea4f3d49cb8e7170b7b61abad655a4ded21076ddba7e76a31538379a650` | match. |
| `src/integrations/documents/java/Preview.java` | `1d6b11023107a1683dd842c9cde6918486c4240ea2be0ff62ea2b1a89916b348` | match. |

Frozen validation locators all exist in the Part-19 `out/role-expanded/blocks.json` dump (47/47). Tagged PDFs are absent from disk and must be reproduced from the frozen HTML through the same `generate-corpus.mjs` → `run-opendataloader.mjs` → `Cards.java` path. Evaluation population remains the frozen 47-card JSON, joined by locator. `--eval-verify-marked` is not used: that path calls a role adapter. This Part scores eligibility only.

### Reproduction (mechanical, before scoring)

Tagged PDFs for 17/18 were absent. Reproduced only from frozen Part-19
HTML, same pipeline, no HTML edit, `ODL_OPTS` unset:

1. `node generate-corpus.mjs` (Chromium `page.pdf()`).
2. `node run-opendataloader.mjs out/part21-untagged out/part21-tagged`
   on copies of `17-visitor-brief.pdf` and `18-sample-receipt.pdf` only.
3. `run.py` `dump_dir` / Cards.java.

Join key: frozen `locator`. `text_norm` of dump text matched frozen
card text on **47/47**. Zero missing locators. Zero extra 17/18 dump
cards. Boxes taken from this dump (not the stale Part-19 `blocks.json`
coordinates against a new PDF).

`--eval-verify-marked` was not invoked. Scoring used
`MARKED_ELIGIBILITY_STEM` + `card_prompt(..., hide_existing_tag=True)`
+ `out/adapter-verify-marked` + marked full-page PNG (`Mark.java` /
`Preview.java`). No `Existing tag` in any prompt. No role adapter.
Temperature 0, thinking disabled, max tokens 256.

### Gate — all 47 rows, once

`out/part21/verify-marked.jsonl` SHA-256
`4e0dabbe5bb675615d5dd8256ca53342b5de610a8f1546452d4e4031b08cddfc`

Adapter hashes unchanged after inference.

| metric | result |
|---|---|
| parse | **47/47** |
| overall eligibility accuracy | 43/47 |
| TP /20 | **17/20** |
| FN /20 | **3/20** |
| TN /27 | **26/27** |
| FP /27 | **1/27** |
| heading recall /20 | 17/20 |
| non-heading rejection /27 | 26/27 |
| H1 eligibility recall /2 | **2/2** |
| H2 eligibility recall /4 | **4/4** |
| H3 eligibility recall /6 | **6/6** |
| H4 eligibility recall /8 | **5/8** |
| H3+H4 eligibility recall /14 | **11/14** |

Heading level was not scored. The verifier does not predict one.

### False positives

| id | text | GT | verifier | authored category | ODL tag |
|---|---|---|---|---|---|
| `18-sample-receipt:21` | Receipts by hour | P | `heading:true` | chart-title | H1 |

Represented in Part-13 verifier training (`12-chart-title`). Failed.
An already-bad ODL `H1` tag is not credit: GT is P.

### False negatives

All three are **H4**, quiet 13pt regular on doc 17, ODL already `P`.

| id | text | GT | verifier | ODL tag | font |
|---|---|---|---|---|---|
| `17-visitor-brief:10` | Cloakroom | H4 | `heading:false` | P | 13pt regular |
| `17-visitor-brief:14` | Workshop floor | H4 | `heading:false` | P | 13pt regular |
| `17-visitor-brief:20` | Forms | H4 | `heading:false` | P | 13pt regular |

Visually quiet / body-sized. Part 19 built doc 17 specifically so
quiet H4s sit against a louder callout. Not represented as H4 in the
Part-13 31-row verifier set (docs 02/04/05/06/10/12, H1/H2-centric).
Not an H1 or H2 veto. Sister H4 `Badges` (same 13pt regular, ODL `P`)
was accepted. Doc 18’s four H4s (14pt bold) were all accepted.

A GT H4 with `heading:false` is a genuine-heading veto. Fail-close
keeping an existing H* tag would not hide these: ODL already tagged
them `P`.

### Critical Part-20 expanded-role false headings

| id | text | GT | category | verifier |
|---|---|---|---|---|
| `17-visitor-brief:3` | Do not enter the machine hall unescorted. | P | callout | **false** (rejected) |
| `17-visitor-brief:22` | Host copy — not for visitors | P | running-footer | **false** (rejected) |
| `18-sample-receipt:21` | Receipts by hour | P | chart-title | **true** (accepted) |

Two of three represented hard-negatives are rejected. Chart title is
not.

### H3/H4 eligibility (compact)

| id | GT | verifier | ODL |
|---|---|---|---|
| `17-visitor-brief:6` Reception | H3 | true | H4 |
| `17-visitor-brief:8` Badges | H4 | true | P |
| `17-visitor-brief:10` Cloakroom | H4 | **false** | P |
| `17-visitor-brief:12` Tours | H3 | true | H4 |
| `17-visitor-brief:14` Workshop floor | H4 | **false** | P |
| `17-visitor-brief:18` Feedback | H3 | true | H4 |
| `17-visitor-brief:20` Forms | H4 | **false** | P |
| `18-sample-receipt:4` PAPER FORMS | H3 | true | H2 |
| `18-sample-receipt:6` Batch numbers | H4 | true | H3 |
| `18-sample-receipt:8` Time of receipt | H4 | true | H3 |
| `18-sample-receipt:10` DIGITAL LOG | H3 | true | H1 |
| `18-sample-receipt:12` Unique ids | H4 | true | H2 |
| `18-sample-receipt:16` FRIDGE | H3 | true | H1 |
| `18-sample-receipt:18` Shelf map | H4 | true | H2 |

H3 6/6. H4 5/8. The eligibility verifier does not solve safety by
rejecting every quiet deeper heading, but it does reject three of
four quiet doc-17 H4s.

### Predictions vs evidence

1. `[H]` Executes and parses all 47 without retraining. **HIT.**
2. `[H]` Accepts all 20 genuine headings, including 14 H3/H4. **MISS.**
   FN 3/20, all H4; H3+H4 11/14.
3. `[H]` Rejects all 27 GT non-headings. **MISS.** FP 1/27.
4. `[H]` Rejects callout, running footer, and chart title. **MISS.**
   Callout and footer rejected; chart title accepted.
5. `[H]` Boundary materially cleaner than either role adapter. **MISS**
   against a usable eligibility gate. FP 1/27 vs role false-heading
   2–3/27, but heading recall 17/20 vs role detection 18–20/20. Not
   a clean decomposition.
6. `[H]` No role-model, R2, structural gate, crop, retraining, or
   larger model. **HIT.**
7. `[H]` Holdout 1 and Holdout 2 are not run. **HIT.**

### Outcome

**Outcome D — both FP and FN.**

STOP.

Parse 47/47. FP 1 (chart-title, represented). FN 3 (quiet H4 on
doc 17, visually quiet/body-sized, not an H4 class in verifier
training). Do not trade one error type for the other with a
threshold. The output is binary and there is no calibrated
confidence. Do not prompt-sweep. Do not crop.

The existing marked verifier is not a safe eligibility boundary on
this surface, and it is not a lossless heading-preservation gate
either. A heading-only level classifier is **not** earned: the
binary half of the decomposition has not held.

Do not retrain the eligibility verifier in this Part. Do not add
the failed validation rows to training. Do not write a semantic
rule. Do not run Holdout-1 / Holdout-2. `out/adapter-role` was not
replaced. `out/adapter-verify-marked` was not modified.

The next possible rung, if any, is expanded development-only
marked-verifier training using train documents only, with docs 17/18
remaining frozen validation. Not this Part.

## Part 22 — does deeper development coverage fix the marked eligibility verifier?

**Date:** 2026-09-11. Same branch. Eligibility-data experiment. No
role adapter on the primary gate. No Holdout-1 / Holdout-2. No docs
17/18 edits. No Part-21 failure rows added to training. No prompt or
marker change. No crop. No `--train-vision`. No production
integration.

Part 21 Outcome D: frozen marked verifier 43/47, FN 3/20 (quiet H4s
on doc 17), FP 1/27 (chart-title). The Part-13 trainer saw 31 rows
from docs 02/04/05/06/10/12. Part 19 added train docs 13–16.

### The one question

> Does expanding the marked-page eligibility verifier’s
> development-only training coverage, while holding its task, visual
> representation, model, QLoRA configuration, and validation set
> fixed, produce a clean heading/non-heading boundary on docs 17/18?

### Frozen validation (not modified)

`role-expanded/role-expanded-valid.json` SHA-256
`207d77b3421438f673de188e88d3168328ef533139cefe51477c88b31c4df07f`

47 cards, docs 17/18 only, H1 2 / H2 4 / H3 6 / H4 8 / P 27.
Part-21 scores are the frozen baseline. The old adapter is not rerun.

| metric | Part 21 old marked verifier |
|---|---|
| parse | 47/47 |
| accuracy | 43/47 |
| TP | 17/20 |
| FN | 3/20 |
| TN | 26/27 |
| FP | 1/27 |
| H1 / H2 / H3 / H4 recall | 2/2, 4/4, 6/6, 5/8 |
| H3+H4 recall | 11/14 |

### Frozen contract (verified before dataset emission)

`MARKED_ELIGIBILITY_STEM` SHA-256
`e5f8d312b57c3c9a7b9a4ab0b30269bcfd009d4ce7d216c2dcd2176b09f39902`

`Mark.java` `6ed6bea4f3d49cb8e7170b7b61abad655a4ded21076ddba7e76a31538379a650`

`Preview.java` `1d6b11023107a1683dd842c9cde6918486c4240ea2be0ff62ea2b1a89916b348`

`role-expanded-new-train.json` SHA-256
`abb2bc78f915ea6c657b699d39c1d6a43bda9455dc532df497b5987c389359df`

### Gate 0 — expanded verifier-training population (no model call)

Pool A: exact Part-13 31 semantic rows, reconstructed from
`PART13_VERIFY_TRAIN_IDS` + `train.json`, byte-checked against
`out/gen-sft-verify/train.json` (element text and heading label match
in ID order). 18 `heading:true` / 13 `heading:false`. Docs
02/04/05/06/10/12. Roles H1 6 / H2 12 / P 11 / Artifact 2. No H3/H4.

Pool B: frozen 94 Part-19 new-train cards, then frozen `r2_ornament`.
**R2 exclusions: 1** — `16-shift-handover:21` text `3`, category
decorative-numeral. Not replaced. Remaining **93**.

Combined: Pool A + Pool B-after-R2. No oversampling, no class
weighting, no duplication, no validation or holdout rows.

| | n |
|---|---:|
| total | **124** |
| heading true | 58 |
| heading false | 66 |
| H1 true | 10 |
| H2 true | 20 |
| H3 true | 12 |
| H4 true | 16 |
| R2 exclusions | 1 |

Documents: 02, 04, 05, 06, 10, 12, 13, 14, 15, 16.

Authored hard-negative categories in Pool B after R2: running-header,
status-line, callout, running-footer, group-label, table-title,
definition-term, body-label (decorative-numeral excluded by R2).
Pool A already contains `12-chart-title` and `12-table-caption`.
The Part-21 chart-title FP is a **represented** old-training
category, not a missing one.

Quiet / near-body-size H4s are now in training:

* doc 14: 15pt regular vs body 14pt regular (four H4s)
* doc 15: **14pt regular, same size and weight as body** (four H4s)
* doc 16: 16pt regular vs body 14pt regular (four H4s)
* doc 13: 14pt bold vs body 14pt regular (four H4s; size-quiet, weight-loud)

Semantic-row manifest
`experiments/qwen-role-decisions/role-expanded/verifier-expanded-train-manifest.json`

SHA-256 `d151f392359360aeada16a28469b4a557942392646cb772a6bf3d911be15896b`

**Gate 0: PASS.** Population reproduced. No model call yet.

### Gate 0B — marked-image reproduction

Tagged copies of train docs 02/04/05/06/10/12/13–16 reproduced from
the already-generated frozen-HTML corpus PDFs through default
`run-opendataloader.mjs` (`ODL_OPTS` unset). Three `empty_text` dump
blocks recur exactly as Part 13 (`05:0`, `05:7`, `06:10`); they are
not train rows.

All 124 semantic rows mapped once: Pool A via `attach_probe_expect`
(`by_doc=True`); Pool B by frozen locator + `text_norm`. Box present.
Marked full-page PNG present. No nearby-BLOCK substitution.

SFT `out/gen-sft-verify-expanded/train.json` (gitignored): 124 rows,
58 `{"heading":true}` / 66 `{"heading":false}`. Prompt is
`MARKED_ELIGIBILITY_STEM` + Element/Font/Weight/Previous/Next/JSON.
No existing tag. SHA-256
`79c510e9226269365f843adea50344af7c8952bebc395e04efadad2e02ce678f`
recorded before the training run.

### Registered predictions (frozen before the one training run)

1. `[H]` The expanded development-only verifier population materially
   adds quiet H3/H4 heading coverage while preserving the existing
   negative categories.
2. `[H]` Stock MLX-VLM can train the expanded marked verifier with the
   same language-side QLoRA configuration used in Part 13.
3. `[H]` On frozen docs 17/18, the expanded verifier reaches parse
   47/47, FN 0/20, and FP 0/27.
4. `[H]` H4 eligibility improves from 5/8 to 8/8 without reducing
   H1–H3 recall.
5. `[H]` The represented chart-title `18-sample-receipt:21` is
   rejected without adding it to training.
6. `[H]` Callout and running-footer negatives that already passed
   remain rejected.
7. `[H]` Known older development behavior does not materially regress.
8. `[H]` No prompt change, marker change, crop, vision-layer training,
   larger model, role-model change, holdout example, or production
   integration is required.

### Training health (one registered run)

The first launch of the identical CLI was killed by the agent session
at iter 170 with **no adapter written** and no METAL/NaN line. That is
recorded as a mechanical interruption, not a hyperparameter retry.
The same command was restarted in tmux and completed:

```
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset out/gen-sft-verify-expanded \
  --split train --batch-size 1 --lora-rank 8 --epochs 6 \
  --steps-per-report 10 --steps-per-save 1000 \
  --train-on-completions --grad-checkpoint \
  --image-resize-shape 560 800 \
  --output-path out/adapter-verify-marked-expanded
```

`[V]` `TRAIN_EXIT:0`. Rows **124**. Iterations **744** (124 × 6).
Learning rate `2.000e-05`. Trainable 16.232448 M / 0.358%. Language-side
LoRA only (`language_model.*`). Rank 8, alpha/scale unchanged from
Part 13. Loss 0.216 (iter 10) → **0.000149** (iter 744). No NaN.
Peak mem 14.058 GB. Adapter 62 MiB. Training set not scored.

| artifact | SHA-256 |
|---|---|
| `out/adapter-verify-marked-expanded/adapters.safetensors` | `7fdd591ec548f27d4f43a86016b96a27d4b43018a8b323d6c85ae38a626c9d90` |
| `out/adapter-verify-marked-expanded/adapter_config.json` | `51518b19e2a1ec53f75a40c119de15da988dca39344e05b7e917ecacc6d31d82` |

Frozen `out/adapter-verify-marked` hash unchanged (`7cecddda…c0824a8`).
Frozen `out/adapter-role` hash unchanged (`8178c345…8dfdb`). Neither
role adapter was invoked on Gate 1.

### Gate 1 — direct semantic eligibility on frozen docs 17/18

Same Part-21 evaluation: all 47 frozen cards, `gt_heading` vs
`verify_heading`, no role adapter, no R2/structure rescue.

`out/part22/gate1.jsonl` SHA-256
`2258b30527f1793be0301ed6f682e27b66917fc0abcccdfe66e722def063e86b`

| metric | Part 21 old | expanded |
|---|---|---|
| parse | 47/47 | **47/47** |
| accuracy | 43/47 | 46/47 |
| TP /20 | 17/20 | **20/20** |
| FN /20 | 3/20 | **0/20** |
| TN /27 | 26/27 | 26/27 |
| FP /27 | 1/27 | **1/27** |
| H1 recall /2 | 2/2 | 2/2 |
| H2 recall /4 | 4/4 | 4/4 |
| H3 recall /6 | 6/6 | 6/6 |
| H4 recall /8 | 5/8 | **8/8** |
| H3+H4 recall /14 | 11/14 | **14/14** |

Hard gate required parse 47/47, FN 0/20, **and** FP 0/27. Missed on FP.

False positives:

| id | text | GT | verifier | category | ODL |
|---|---|---|---|---|---|
| `18-sample-receipt:21` | Receipts by hour | P | `heading:true` | chart-title | H1 |

**Represented** in Pool A (`12-chart-title`) and still accepted. Not
added to training. An already-bad ODL `H1` is not credit.

False negatives: none.

Critical rows:

| id | GT | Part 21 | expanded |
|---|---|---|---|
| `17-visitor-brief:10` Cloakroom | H4 | FN | **true** |
| `17-visitor-brief:14` Workshop floor | H4 | FN | **true** |
| `17-visitor-brief:20` Forms | H4 | FN | **true** |
| `18-sample-receipt:21` Receipts by hour | P chart-title | FP | **FP** |
| `17-visitor-brief:3` callout | P | TN | **false** |
| `17-visitor-brief:22` running footer | P | TN | **false** |

**Gate 1: FAIL** on FP. Gate 2 was not run.

### Predictions vs evidence

1. `[H]` Quiet H3/H4 coverage added, negatives preserved. **HIT.**
   H3 12 / H4 16 in train; chart-title and table-title remain.
2. `[H]` Stock MLX-VLM trains the expanded marked verifier. **HIT.**
3. `[H]` Parse 47/47, FN 0/20, FP 0/27. **MISS.** FP 1/27.
4. `[H]` H4 5/8 → 8/8 without reducing H1–H3. **HIT.** 2/2, 4/4, 6/6, 8/8.
5. `[H]` Chart-title `18-sample-receipt:21` rejected. **MISS.** Still FP.
6. `[H]` Callout and running-footer remain rejected. **HIT.**
7. `[H]` Older development does not regress. **Not evaluated.**
   Gate 2 is gated on Gate 1.
8. `[H]` No prompt/marker/crop/vision/larger-model/role/holdout/prod.
   **HIT.**

### Outcome

**Outcome C — FN 0 but any FP.**

STOP.

Heading preservation is solved on this surface (quiet doc-17 H4s now
accepted; H3+H4 14/14). Eligibility specificity is not: the represented
chart-title `18-sample-receipt:21` is still `heading:true`.

Do not add that validation row. Do not write a semantic rule. No second
verifier run. Do not train a heading-only level classifier. Do not run
Gate 2, Holdout 1, or Holdout 2. Do not blend adapters.

`out/adapter-verify-marked` was not replaced. `out/adapter-role` was
not invoked. Hierarchy remains a separate unsolved task, and it is not
earned while eligibility still promotes a chart title.

---

## Part 23 — is chart-title specificity still a data-coverage problem?

**Date:** 2026-09-12. Same branch. Data construction / inventory only.
No QLoRA. No verifier inference. No role adapter. No prompt change.
No marker change. No crop. No `--train-vision`. No larger model. No
Holdout-1 / Holdout-2. Docs 17/18 remain frozen validation and are
not edited, copied, paraphrased, or used as training material.
`out/adapter-verify-marked-expanded` is not modified. Validation
pages were not inspected while designing any later fixtures. The
already-recorded failure classification `chart-title` is sufficient.

Part 22 removed every false negative on docs 17/18 (heading 20/20,
H4 8/8, H3+H4 14/14; callout and running footer stay false). One
semantic false positive remains: `18-sample-receipt:21`, GT P,
authored category `chart-title`, verifier `heading:true`.

### The one question

> Before changing the model or retraining again, does the development
> training side contain enough independent chart-title / chart-label
> evidence to test specificity honestly, or do we need to construct
> that missing evidence first?

This Part answers only the data question.

### Frozen validation (not modified)

`role-expanded/role-expanded-valid.json` SHA-256
`207d77b3421438f673de188e88d3168328ef533139cefe51477c88b31c4df07f`

Docs 17/18 remain evaluation-only. Not copied: the failing string,
its neighbors, typography, page arrangement, chart type, locator, or
ODL tag pattern.

### Registered predictions (frozen before any new fixture)

1. `[H]` Part-22 training contains materially less chart-title
   diversity than its overall 66-negative count suggests.
2. `[H]` The persistent doc-18 FP is therefore consistent with
   within-class coverage being thin even though the category is
   technically represented.
3. `[H]` Three small whole development documents can add at least six
   independent chart-title negatives without copying validation or
   holdout content.
4. `[H]` The existing real-PDF bridge preserves those examples as
   standalone verifier rows.
5. `[H]` Genuine headings can be colocated with chart contexts without
   structural scope removing them.
6. `[H]` No model execution is required to establish whether one more
   verifier-training experiment is justified.

### Gate 0 — inventory of the exact 124 Part-22 verifier-training rows

Source: frozen
`role-expanded/verifier-expanded-train-manifest.json` SHA-256
`d151f392359360aeada16a28469b4a557942392646cb772a6bf3d911be15896b`
joined to gitignored SFT
`out/gen-sft-verify-expanded/train.json` SHA-256
`79c510e9226269365f843adea50344af7c8952bebc395e04efadad2e02ce678f`
(124/124, same ID order). Categories are the stored GT / probe
fields. No category was assigned from model output.

| | n |
|---|---:|
| SFT rows | 124 |
| heading true | 58 |
| heading false | **66** |
| documents | 02, 04, 05, 06, 10, 12, 13–16 |

Heading-false stored categories:

| stored category | n | documents |
|---|---:|---|
| P / paragraph (ordinary body) | 47 | 02, 04, 05, 10, 12, 13–16 |
| prominent-nonheading | 6 | 02, 05, 12 |
| furniture | 2 | 02, 05 |
| running-header | 2 | 13, 15 |
| status-line | 2 | 13, 15 |
| running-footer | 2 | 13, 14 |
| callout | 1 | 13 |
| group-label | 1 | 14 |
| table-title | 1 | 14 |
| definition-term | 1 | 15 |
| body-label | 1 | 16 |

Authored `nonHeadings` `chart-title` in this 124: **0**.
The one chart-related negative is Pool A `12-chart-title`, stored
as `prominent-nonheading`, source note “SVG chart title”.

#### Chart-related negatives that actually entered SFT

| bucket | n | rows |
|---|---:|---|
| 1. chart titles | **1** | `12-chart-title` “Quarterly trend by depot”, 11pt bold, existing_tag `none`, prev `Coastal` next `Q1`, source SVG chart title on doc 12 |
| 2. chart subtitles | **0** | — |
| 3. legends | **0** | `07-northern` exists on spent doc 07 / `valid-07.json` and is **not** in the 124 |
| 4. axis labels | **0** | — |
| 5. tick labels | **0** | `07-q1` likewise not in the 124; R2 would drop letterless ticks anyway |
| 6. chart-adjacent prose/captions | **0** | `12-table-caption` is an authored **table** caption (`prominent-nonheading`), not a chart caption |

`14-pump-overhaul:22` “Parts used this shift” is `table-title`, not
chart-title. Figure caption `05-fig1` is photograph figcaption, not
a chart.

Independent chart-title negatives: **1**, from **1** document.
Required diversity bar was four from at least three whole documents
with materially different visual/typographic contexts.

#### Every heading:false row

SFT font/weight is what the verifier-training prompt carried
(ODL-measured). Pool A `ancestors` were not stored on `train.json`;
those rows entered SFT, so they passed `verifier_skip_reason`
(source-type / Table-Figure ancestry / R2). Pool B ancestors are
`Document` on every listed negative. Full prev/next strings live on
the frozen manifest; abbreviated here.

| id | doc | stored category | authored visual context | SFT font/wt | existing_tag | text |
|---|---|---|---|---|---|---|
| `02-p` | 02 | paragraph | — | 13pt/regular | P | The depot lease expires within the year… |
| `02-callout` | 02 | prominent-nonheading | callout (source note; no `nonHeadings`) | 12pt/bold | none | Note. This box straddles the gutter… |
| `02-footer` | 02 | furniture | running footer (source note) | 10pt/regular | none | Northwind Logistics · Coastal Depot Review · Page 1 of 1 |
| `04-p` | 04 | paragraph | — | 14pt/regular | P | Utilisation is reported by vehicle class… |
| `05-brand` | 05 | furniture | brand bar (source note) | 11pt/regular | none | Coastal Quay Site Report · Page 1 |
| `05-p` | 05 | paragraph | — | 14pt/regular | P | Two site visits were made during the review period. |
| `05-fig1` | 05 | prominent-nonheading | figure caption (source note) | 12pt/regular | none | Figure 1: The western quay at low tide… |
| `10-p` | 10 | paragraph | — | 14pt/regular | P | This document carries no title metadata… |
| `12-sub` | 12 | prominent-nonheading | cover subtitle (source note) | 17pt/regular | none | Annual Review 2026 · prepared for the Board |
| `12-org` | 12 | prominent-nonheading | cover org line (source note) | 13pt/regular | none | Northwind Logistics · Estates and Operations |
| `12-p` | 12 | paragraph | — | 10.5pt/regular | P | Coastal has operated below its designed capacity… |
| `12-table-caption` | 12 | prominent-nonheading | table caption (source note) | 12pt/bold | none | Containers handled, by depot and quarter (hundreds) |
| `12-chart-title` | 12 | prominent-nonheading | **SVG chart title** (no GT `nonHeadings`) | 11pt/bold | none | Quarterly trend by depot |
| `13-workshop-induction:0` | 13 | running-header | running-header | 10pt/regular | P | Northwind Logistics · Workshop · Page 1 of 1 |
| `13-workshop-induction:1` | 13 | status-line | status-line | 13pt/regular | P | Internal draft — not a controlled copy |
| `13-workshop-induction:3`–`:21` (10 body P) | 13 | P | — | 14pt/regular | P | ordinary paragraphs |
| `13-workshop-induction:22` | 13 | callout | callout | 14pt/bold | H4 | Note. PPE is issued at the locker, not at the machine. |
| `13-workshop-induction:23` | 13 | running-footer | running-footer | 10pt/regular | P | Northwind Logistics · Induction · Prepared 2026-09-11 |
| `14-pump-overhaul:1`–`:19` (10 body P) | 14 | P | — | 14pt/regular | P | ordinary paragraphs |
| `14-pump-overhaul:20` | 14 | group-label | group-label | 16pt/regular | H3 | Issued from stores |
| `14-pump-overhaul:21` | 14 | P | — | 14pt/regular | P | These lines are the consumables booked against this job… |
| `14-pump-overhaul:22` | 14 | table-title | table-title | 17pt/regular | H2 | Parts used this shift |
| `14-pump-overhaul:30` | 14 | running-footer | running-footer | 10pt/regular | P | East pump house · shift log |
| `15-archive-transfer:0` | 15 | running-header | running-header | 10pt/regular | P | Records office · transfer note |
| `15-archive-transfer:1` | 15 | status-line | status-line | 13pt/regular | P | Draft list — boxes not yet sealed |
| `15-archive-transfer:3`–`:21` (10 body P) | 15 | P | — | 14pt/regular | P | ordinary paragraphs |
| `15-archive-transfer:22` | 15 | definition-term | definition-term | 14pt/bold | H4 | Series. A run of records kept together… |
| `16-shift-handover:1`–`:19` (10 body P) | 16 | P | — | 14pt/regular | P | ordinary paragraphs |
| `16-shift-handover:20` | 16 | body-label | body-label | 14pt/bold | P | Priority. Speak the conveyor isolation… |
| `16-shift-handover:22` | 16 | P | — | 14pt/regular | H2 | Three vehicles were held overnight… |

`12-chart-title` prev/next: `Coastal` / `Q1` (SVG neighbors, not
section prose). That is the entire within-class neighbor context
the trainer saw.

**Gate 0 decision: sparse.** Chart-title coverage is essentially
`12-chart-title` alone. Data construction is earned. Another QLoRA
is not run in this Part.

### Data construction (only because Gate 0 was sparse)

Three new whole training documents after 18. Docs 01–18 were not
modified. Validation pages were not inspected. No Holdout-1 /
Holdout-2 strings.

| stem | family | layout | prominent non-chart |
|---|---|---|---|
| `19-quay-roster` | Courier memo | A4 portrait, typewriter | stamp `UNCONTROLLED COPY` |
| `20-tank-soundings` | Verdana | A4 landscape, teal banner | banner `Ops desk — not for customs` |
| `21-ice-window` | Didot editorial | A4 portrait, centered display | kicker `Harbour master circular` |

Authored headings: 3 H1 + 3 H2 + 3 H3 = 9.
Authored chart-title negatives: 6.
Additional chart-labels: legend `Tied up`, subtitle `By tank, this watch`, axis `Wait in hours`.

Contrast structure:

* genuine heading immediately before chart: `Night allocation` → `Berth occupancy`; `East bank` → `Stored volume`
* similar size/weight: `East bank` and `Stored volume` both dump at 18pt bold
* chart title louder than a deeper heading: `Delay mix` 21pt / `Ullage change` 24pt / `Wait times` 26pt vs H3 12–16pt
* heading-like wording: `Berth occupancy`, `Stored volume`, `Channel status` (not “chart of …”)
* neighboring text insufficient: `Channel status` sits after ordinary prose about the channel, not after a caption word

Chart titles are HTML blocks beside graphics with **no SVG text**, so
segmentation does not depend on tick merging. `MARKED_ELIGIBILITY_STEM`
unchanged.

Mechanical fixture edit before freeze (same semantic documents):
after the first bridge already mapped every target, the east-bank /
night-allocation body paragraphs were moved so the H2 is immediately
followed by the chart title. No Cards.java / ODL change. Ligature
spacing was authored up front (`liga` 0, letter-spacing). No second
extractor pass.

### Real-PDF bridge

Path: new HTML only → Chromium `page.pdf()` (`printBackground`,
`preferCSSPageSize`, file: only; same options as `generate-corpus.mjs`)
→ `run-opendataloader.mjs` defaults (`ODL_OPTS` unset) →
`run.py --dump-dir` / Cards.java. No `--predict`. No adapter.

| | authored | standalone BLOCK | in-scope after source-type / ancestry / R2 |
|---|---:|---:|---:|
| H1 / H2 / H3 | 3 / 3 / 3 | 9/9 | 9/9 |
| chart-title | 6 | 6/6 | 6/6 |
| chart-legend / subtitle / axis | 1 / 1 / 1 | 3/3 | 3/3 |
| other hard negatives (stamp/banner/kicker) | 3 | 3/3 | 3/3 |

37 evaluable BLOCK cards, 0 `empty_text` / `missing_font`. Ancestry
`Document` on every target. R2 exclusions: 0. No duplicated
chart-title cards. No 17/18 locators. No copied failure string.

ODL’s own tags on the six chart titles are H3/H1/H2/H1/H3/H1 — that
is the false-heading pattern, not credit.

**Bridge gate: PASS.**

### Frozen surfaces

`experiments/qwen-role-decisions/role-expanded/chart-title-extension-train.json`

* documents 19–21 only
* 37 in-scope cards: 9 headings, 12 hard negatives, 16 paragraphs
* SHA-256 `0a99068ce9944a1beb8328b5b3ab0be448ff01fc20604b82b8a730fcfaef2474`

`chart-title-extension-split.json` SHA-256
`f9fdfaffa066453cc535424216d047eb05ad4f11b9d8e881f5eafb62f478ed2f`

`verifier-chart-title-extension-manifest.json` SHA-256
`091ac19e28b66c00b19607218fde66ba88c91aa9f0a44238901383e786697868`

Proposed verifier-training population: frozen 124 + 37 new = **161**.
Not trained.

`chart-title-extension-freeze.json` SHA-256
`2ab1619617aa73ca300b74924d0c7435dd73b567c0b5466844e2aa90002b9b35`

Fixture SHA-256 (HTML / GT):

| file | SHA-256 |
|---|---|
| 19-quay-roster.html | `fc40a1164aa6d5372bf549bc349800a013923b642363d6e4cb501e74931bfaca` |
| 19-quay-roster.ground-truth.json | `9a350757211fa95f59058e7ae5317eb3823e3d8d23bdd2b1f04c3c35ed5846db` |
| 20-tank-soundings.html | `15d156c67820abcfcf6b3440a7ab2089bcf7573c115ea8e675e101ba2ec33885` |
| 20-tank-soundings.ground-truth.json | `7b5daaab8acc10bc9fbaee2d5d62578634159d062126050e395c75509226413f` |
| 21-ice-window.html | `71289707728f713b49ff4fac99357a322113741d875cfa5f5d1dfeafe89d4d6e` |
| 21-ice-window.ground-truth.json | `6b9094d8ffff2c377f3b2bbde6590787707829683410d448cb7b579dfb2cfccc` |

Frozen validation and adapters unchanged:
`role-expanded-valid.json` `207d77b342…4df07f`;
`out/adapter-verify-marked-expanded` `7fdd591e…6c9d90`;
`out/adapter-verify-marked` `7cecddda…c0824a8`;
`out/adapter-role` `8178c345…8dfdb`.
Docs 17/18 HTML/GT hashes match the Part-19 freeze.

### Predictions vs evidence

1. `[H]` Chart-title diversity thinner than 66 negatives. **HIT.** 1 of 66.
2. `[H]` Persistent FP consistent with thin within-class coverage. **HIT.**
3. `[H]` Three documents add ≥6 independent chart-title negatives. **HIT.** 6.
4. `[H]` Real-PDF bridge preserves them. **HIT.** 6/6 + 3/3 labels.
5. `[H]` Genuine headings colocated with charts stay in scope. **HIT.** 9/9.
6. `[H]` No model execution required. **HIT.**

### Outcome

**PASS.** Gate 0 was sparse, and the new evidence passed every
bridge/data gate.

STOP.

The verifier’s remaining specificity category was represented but
under-covered across documents and visual contexts. One subsequent
expanded marked-verifier QLoRA run is earned, using development
training documents only and keeping docs 17/18 completely frozen.

Do not train that adapter in Part 23.

### Future semantic-safety requirement (recorded, not executed)

A later verifier architecture must score every in-scope element that
would otherwise finish as H1–H6, including keep-as-H*. Report
`legacy_unsafe_mutation` (GT non-heading + final H* + action=retag)
and `semantic_false_heading` (GT non-heading + final H*, any action)
separately. `semantic_false_heading == 0` is the remediation safety
target. An existing H* that the verifier rejects must not be counted
safe by keep; demotion vs unresolved is a later integration choice.

---

## Part 24 — does independent chart-context coverage close eligibility?

**Date:** 2026-09-12. Same branch. One marked-verifier QLoRA run.
No role-adapter training. No prompt change. No marker change. No
crop. No `--train-vision`. No larger model. No Holdout-1 /
Holdout-2. Docs 17/18 remain frozen validation. No validation row,
wording, locator, image, or GT record enters training.

Part 22 solved heading preservation on docs 17/18 (TP 20/20, FN 0,
H4 8/8) and left one false positive: `18-sample-receipt:21`
“Receipts by hour”, GT P, category `chart-title`, verifier
`heading:true`. Part 23 then measured that the 124-row trainer
contained one chart-title negative from one development document,
and constructed three independent chart-context development
documents (19–21) that passed the real-PDF bridge.

This Part is an eligibility experiment, not an end-to-end
role-system experiment. `unsafe_retag == 0` is not semantic-
remediation safety. Scoring is `gt_heading` vs `verify_heading`
directly, before mutation semantics.

### The one question

> Does adding the frozen Part-23 chart-context development documents
> to the frozen Part-22 marked-verifier training population eliminate
> the remaining chart-title false positive without reintroducing
> genuine-heading vetoes?

### Frozen primary validation (not modified)

`role-expanded/role-expanded-valid.json` SHA-256
`207d77b3421438f673de188e88d3168328ef533139cefe51477c88b31c4df07f`

Docs 17/18 only. 47 cards: H1 2 / H2 4 / H3 6 / H4 8 / P 27.
GT headings 20, GT non-headings 27. Docs 17/18 were not edited.

Part-22 expanded marked verifier is the frozen baseline:

| metric | Part 22 expanded marked verifier |
|---|---|
| parse | 47/47 |
| TP | 20/20 |
| FN | 0/20 |
| TN | 26/27 |
| FP | 1/27 |
| H1 / H2 / H3 / H4 | 2/2, 4/4, 6/6, 8/8 |

Only error: `18-sample-receipt:21` — Receipts by hour — GT P —
chart-title — verifier `heading:true`.

### Frozen verifier contract (unchanged)

`MARKED_ELIGIBILITY_STEM` SHA-256
`e5f8d312b57c3c9a7b9a4ab0b30269bcfd009d4ce7d216c2dcd2176b09f39902`

Completion only `{"heading":true}` or `{"heading":false}`.
Label: `heading = expect.role in H1..H6`. Prompt is the stem then
Element / Font / Weight / Previous / Next / JSON. No existing tag,
source type, ancestry, GT category, locator, bounding-box
coordinates, confidence, or reason. The marked full-page image is
the only visual input.

### Gate 0 — reproduce the 161-row population

Verified hashes before mapping:

| file | SHA-256 |
|---|---|
| `role-expanded-valid.json` | `207d77b3421438f673de188e88d3168328ef533139cefe51477c88b31c4df07f` |
| Part-22 manifest `verifier-expanded-train-manifest.json` | `d151f392359360aeada16a28469b4a557942392646cb772a6bf3d911be15896b` |
| Part-23 `chart-title-extension-train.json` | `0a99068ce9944a1beb8328b5b3ab0be448ff01fc20604b82b8a730fcfaef2474` |
| Part-22 SFT `out/gen-sft-verify-expanded/train.json` | `79c510e9226269365f843adea50344af7c8952bebc395e04efadad2e02ce678f` |

Concatenated the frozen 124 rows and the frozen 37 rows. No
oversampling. No duplicate chart-title rows. All three complete
development documents 19–21, not the six chart titles alone.

| | n |
|---|---:|
| total unique semantic rows | **161** |
| heading true | 67 |
| heading false | 94 |
| Pool A | 31 |
| Pool B | 93 |
| Pool C (docs 19–21) | 37 |
| chart-title negatives | 6 |

Documents (mapped PDF stems): 02-two-column, 04-difficult-table,
05-images-captioned, 06-images-uncaptioned, 10-metadata-problems,
12-kitchen-sink, 13-workshop-induction, 14-pump-overhaul,
15-archive-transfer, 16-shift-handover, 19-quay-roster,
20-tank-soundings, 21-ice-window. No doc 17/18. No Holdout-1 /
Holdout-2. No 01/03/07/08/11.

Every row mapped to exactly one real-PDF BLOCK and one marked page
image via the established dump → box → `Mark.java` bridge. Three
recurring `empty_text` dump blocks from Part 13 (`05:0`, `05:7`,
`06:10`) are not train rows. Architecture filter
(`source_type` / ancestry / R2) excluded none of the 161.

SFT `out/gen-sft-verify-chart-expanded/train.json` (gitignored):
161 rows, 67 `{"heading":true}` / 94 `{"heading":false}`, 161 unique
marked images. Prompt starts with unchanged
`MARKED_ELIGIBILITY_STEM`. Zero `Existing tag` leaks.

SHA-256 `9c4fda12537881b619616004ecd128d3139129e0dd96a6d2e6785b6d69420b45`
recorded **before** the training run.

**Gate 0: PASS.** Population reproduced. Do not train a different
population.

### Registered predictions (frozen before the one training run)

1. `[H]` The frozen 161-row development population reproduces exactly
   and stock MLX-VLM trains it with the Part-22 configuration.
2. `[H]` Primary validation remains parse 47/47.
3. `[H]` Genuine-heading preservation remains 20/20, including H4 8/8.
4. `[H]` GT non-heading rejection improves from 26/27 to 27/27.
5. `[H]` `18-sample-receipt:21` changes from `heading:true` to
   `heading:false` without entering training.
6. `[H]` No new FP or FN appears elsewhere on docs 17/18.
7. `[H]` Previously known development behavior does not materially
   regress.
8. `[H]` No prompt/marker/crop/vision-layer/model-size/structural-
   rule/holdout change is required.

### Training health (one registered run)

One QLoRA. No second configuration. No epoch extension. No
oversampling. No class weighting. No `--train-vision`. Destination
`out/adapter-verify-marked-chart-expanded` — did not overwrite
`out/adapter-verify-marked` or `out/adapter-verify-marked-expanded`.

```
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path mlx-community/Qwen3.5-4B-MLX-4bit \
  --dataset out/gen-sft-verify-chart-expanded \
  --split train \
  --batch-size 1 \
  --lora-rank 8 \
  --epochs 6 \
  --steps-per-report 10 \
  --steps-per-save 1000 \
  --train-on-completions \
  --grad-checkpoint \
  --image-resize-shape 560 800 \
  --output-path out/adapter-verify-marked-chart-expanded
```

`[V]` `TRAIN_EXIT:0`. Rows **161**. Iterations **966** (161 × 6).
Learning rate `2.000e-05`. Trainable 16.232448 M / 0.358%.
Language-side LoRA only. Rank 8. Loss 0.103 (iter 10) →
**0.000055** (iter 966). No NaN. Peak mem 14.057 GB. Adapter 62 MiB.
Training set not scored. No mechanical restart.

| artifact | SHA-256 |
|---|---|
| `out/adapter-verify-marked-chart-expanded/adapters.safetensors` | `9c5ce9f23d670251b2f41be2a378d253cab6e95b2d822e43ec53f43e127088f0` |
| `out/adapter-verify-marked-chart-expanded/adapter_config.json` | `51518b19e2a1ec53f75a40c119de15da988dca39344e05b7e917ecacc6d31d82` |

Frozen `out/adapter-verify-marked-expanded` hash unchanged
(`7fdd591e…6c9d90`). Frozen `out/adapter-verify-marked` unchanged
(`7cecddda…c0824a8`). Frozen `out/adapter-role` unchanged
(`8178c345…8dfdb`). Neither role adapter was invoked on Gate 1.

Loss is training health only.

### Gate 1 — direct semantic eligibility on frozen docs 17/18

Same Part-21/22 evaluation: all 47 frozen cards, `gt_heading` vs
`verify_heading`, no role adapter, no R2/structure rescue.

`out/part24/gate1.jsonl` SHA-256
`b08ceefc6e5cf58a154259055c0f57c8bd41e6a491a9a853407af705e56911bc`

| metric | Part 22 expanded | Part 24 chart-expanded |
|---|---|---|
| parse | 47/47 | **47/47** |
| TP /20 | 20/20 | **19/20** |
| FN /20 | 0/20 | **1/20** |
| TN /27 | 26/27 | **27/27** |
| FP /27 | 1/27 | **0/27** |
| H1 recall /2 | 2/2 | 2/2 |
| H2 recall /4 | 4/4 | 4/4 |
| H3 recall /6 | 6/6 | 6/6 |
| H4 recall /8 | 8/8 | **7/8** |
| H3+H4 recall /14 | 14/14 | **13/14** |

Hard gate required parse 47/47, FN 0/20, **and** FP 0/27. Missed
on FN.

Only disagreement vs Part 22 (and the only error):

| id | text | GT | Part 22 | Part 24 | category | ODL |
|---|---|---|---|---|---|---|
| `17-visitor-brief:14` | Workshop floor | H4 | `heading:true` | **`heading:false`** | H4 | P |
| `18-sample-receipt:21` | Receipts by hour | P | `heading:true` | `heading:false` | chart-title | H1 |

`Workshop floor` is 13pt regular, existing tag `P`, neighbors
ordinary body. It is a quiet genuine H4 that Part 22 had recovered.
The chart-title FP is gone, and no new FP appeared.

Critical rows:

| id | text | GT | verifier |
|---|---|---|---|
| `17-visitor-brief:10` | Cloakroom | H4 | true |
| `17-visitor-brief:14` | Workshop floor | H4 | **false** |
| `17-visitor-brief:20` | Forms | H4 | true |
| `17-visitor-brief:3` | callout | P | false |
| `17-visitor-brief:22` | running footer | P | false |
| `18-sample-receipt:21` | Receipts by hour | P | false |

**Gate 1 FAIL — FN.** Any FN stops. Gate 2 is not earned. Do not
threshold, tune, add the validation row, oversample chart titles,
change the prompt, crop, train vision, or rerun.

### Gate 2 — not run

Not earned. Doc-07 and probes 01/03/08/11 were not scored. Holdout-1
and Holdout-2 were not run.

### Predictions vs evidence

1. `[H]` 161-row population reproduces and trains. **HIT.**
2. `[H]` Parse 47/47. **HIT.**
3. `[H]` Heading preservation 20/20 including H4 8/8. **MISS.** 19/20, H4 7/8.
4. `[H]` Non-heading rejection 27/27. **HIT.**
5. `[H]` `18-sample-receipt:21` becomes `heading:false`. **HIT.**
6. `[H]` No new FP or FN elsewhere. **MISS.** New FN on `:14`.
7. `[H]` Older development does not regress. **untested** (Gate 2 not earned).
8. `[H]` No prompt/marker/crop/vision/model/holdout change. **HIT.**

### Outcome

**D.** The verifier is still not a lossless eligibility boundary.

STOP.

Independent chart-context coverage closed the measured chart-title
false positive on untouched docs 17/18, and callout / running-footer
rejection held. It did so by vetoing one quiet genuine H4 that the
Part-22 trainer had labelled `heading:true`. Specificity and
preservation were not obtained together under this frozen
Qwen3.5-4B language-side marked-verifier configuration.

A pass would have supported “broader independent chart-context
development coverage was sufficient.” This failure does not prove
that six chart-title examples caused the FN, and it does not prove
that vision in general cannot solve the boundary. It says this
development evidence, under this frozen configuration, did not.

Do not add `18-sample-receipt:21` or `17-visitor-brief:14` to
training. Do not run another QLoRA with more of the same class.
Do not retrain a joint role adapter in this Part. Do not call the
remediation architecture solved.

`out/adapter-verify-marked-expanded` (Part 22, Outcome C) remains
the last adapter that preserved all 20 genuine headings. The
Part-24 adapter is recorded, not promoted.

### Semantic-remediation guardrail (unchanged)

Even after a later eligibility pass, no end-to-end safety claim may
select the verifier only for heading mutations. Future scoring must
include `legacy_unsafe_mutation` and `semantic_false_heading`, with
`semantic_false_heading == 0` as the safety target, including
keep-as-H*. Integration of a verifier rejection of an existing H*
(demote to P vs unresolved) is still not this Part.

---

## Part 25 — is the visual input causally load-bearing in the latest verifier?

**Date:** 2026-09-12. Same branch. Inference only. No QLoRA. No
fixture edit. No new examples. No prompt change. No marker change.
No crop. No `--train-vision`. No role adapter. No structural-rule
change. No Holdout-1 / Holdout-2. Docs 17/18 remain frozen
validation.

Part 24 moved the frozen docs-17/18 eligibility boundary from
TP 20/20 TN 26/27 (one chart-title FP) to TP 19/20 TN 27/27
(chart-title fixed, one quiet-H4 FN). Independent chart-context
coverage changed the untouched validation decision boundary. It
did not produce a lossless eligibility verifier. This Part does
not add more data.

### The one question

> On the frozen Part-24 verifier, does the marked page itself
> causally affect eligibility decisions on untouched docs 17/18, or
> is the latest adapter still functioning primarily as a
> text/metadata classifier?

Inference ablation. It does not ask whether vision could work after
vision-layer training.

### Frozen primary surface

`role-expanded/role-expanded-valid.json` SHA-256
`207d77b3421438f673de188e88d3168328ef533139cefe51477c88b31c4df07f`

47 cards, docs 17/18 only. GT headings 20 / non-headings 27.
H1 2 / H2 4 / H3 6 / H4 8 / P 27.

Part-24 marked predictions are frozen and are **not regenerated**.

### Frozen model and contract (verified before Arm B)

| artifact | SHA-256 |
|---|---|
| `out/adapter-verify-marked-chart-expanded/adapters.safetensors` | `9c5ce9f23d670251b2f41be2a378d253cab6e95b2d822e43ec53f43e127088f0` |
| `adapter_config.json` | `51518b19e2a1ec53f75a40c119de15da988dca39344e05b7e917ecacc6d31d82` |
| `MARKED_ELIGIBILITY_STEM` | `e5f8d312b57c3c9a7b9a4ab0b30269bcfd009d4ce7d216c2dcd2176b09f39902` |
| Arm A `out/part24/gate1.jsonl` | `b08ceefc6e5cf58a154259055c0f57c8bd41e6a491a9a853407af705e56911bc` |

Completion remains exactly `{"heading":true}` or `{"heading":false}`.
Metadata remains Element / Font / Weight / Previous / Next / JSON.
Temperature 0. Thinking disabled. Max tokens 256. No existing tag,
role adapter, ancestry, source type, R2, category, GT, locator, bbox
coordinates, confidence, or reason in the prompt.

Do not replace the marked-image sentence. Do not write a text-only
prompt. Do not use `out/adapter-verify-text`. The only intended
Arm-B variable is whether image tensors are supplied.

### Arm A — frozen marked reference

Not regenerated. Parse 47/47, TP 19/20, FN 1/20, TN 27/27, FP 0/27.
Only error: `17-visitor-brief:14` Workshop floor, GT H4,
`heading:false`. Critical corrected row: `18-sample-receipt:21`
Receipts by hour, GT P chart-title, Part-22 true → Part-24 marked
false.

### Registered predictions (frozen before Arm B)

1. `[H]` Arm B parses every one of the 47 frozen validation rows.
2. `[H]` At least one Part-24 prediction changes when the image is
   removed.
3. `[H]` Receipts by hour benefits from the marked image.
4. `[H]` The quiet-H4 error on Workshop floor is either
   image-dependent or remains unchanged, providing direct evidence
   about the remaining preservation failure.
5. `[H]` If flips exist, Arm C can distinguish target-marker
   dependence from generic page-image dependence without training.
6. `[H]` No new data, QLoRA, prompt edit, crop, vision-layer
   training, larger model, role model, structural rule, or holdout
   evaluation is required.

### Arm B — same adapter, image omitted

Same 47 mapped cards, same Part-24 adapter, same
`MARKED_ELIGIBILITY_STEM` prompt. `generate(..., image=None)`. The
marked-image sentence was not replaced. `out/adapter-verify-text`
was not used.

`out/part25/arm-b.jsonl` SHA-256
`9af7165a8156976aaf76659f87246252a260b83350023c2c1664e64487f017d7`

Parse **47/47**.

| | marked (Arm A) | no-image (Arm B) |
|---|---|---|
| parse | 47/47 | **47/47** |
| TP /20 | 19 | **15** |
| FN /20 | 1 | **5** |
| TN /27 | 27 | **26** |
| FP /27 | 0 | **1** |
| H1 /2 | 2/2 | 2/2 |
| H2 /4 | 4/4 | 4/4 |
| H3 /6 | 6/6 | **5/6** |
| H4 /8 | 7/8 | **4/8** |

Marked → no-image disagreements: **7**.
Unchanged correct: **40**. Unchanged wrong: **0**.

Beneficial flips (no-image correct, marked wrong) — image
**harmfully** load-bearing:

| id | text | GT | marked | no-image |
|---|---|---|---|---|
| `17-visitor-brief:14` | Workshop floor | H4 | false | **true** |

Harmful flips (marked correct, no-image wrong) — image
**beneficially** load-bearing:

| id | text | GT | marked | no-image |
|---|---|---|---|---|
| `17-visitor-brief:10` | Cloakroom | H4 | true | false |
| `18-sample-receipt:6` | Batch numbers | H4 | true | false |
| `18-sample-receipt:8` | Time of receipt | H4 | true | false |
| `18-sample-receipt:16` | FRIDGE | H3 | true | false |
| `18-sample-receipt:18` | Shelf map | H4 | true | false |
| `18-sample-receipt:21` | Receipts by hour | P | false | true |

Critical rows:

| id | text | GT | marked | no-image | flip |
|---|---|---|---|---|---|
| `17-visitor-brief:14` | Workshop floor | H4 | false | true | yes |
| `18-sample-receipt:21` | Receipts by hour | P | false | true | yes |

**Outcome D** on Arm B: mixed dependence. Arm C earned on the seven
flip rows.

### Arm C — unmarked full page on flip rows only

Same adapter, same prompt, same full-page raster, magenta target
rectangle removed (`Preview.java` page PNG). No crop. No resolution
change.

`out/part25/arm-c.jsonl` SHA-256
`abf447fad52d840928c5bb447a74bcf9dab9fb5a458134868ab2f9a6e28ab9e2`

Parse 7/7.

| id | text | marked | unmarked | no-image | class |
|---|---|---|---|---|---|
| `17-visitor-brief:10` | Cloakroom | true | true | false | page-image, not marker |
| `17-visitor-brief:14` | Workshop floor | false | true | true | **target-marker** |
| `18-sample-receipt:6` | Batch numbers | true | true | false | page-image, not marker |
| `18-sample-receipt:8` | Time of receipt | true | true | false | page-image, not marker |
| `18-sample-receipt:16` | FRIDGE | true | true | false | page-image, not marker |
| `18-sample-receipt:18` | Shelf map | true | true | false | page-image, not marker |
| `18-sample-receipt:21` | Receipts by hour | false | true | true | **target-marker** |

The two rows whose Part-24 marked decision differs from both
unmarked-page and no-image are the chart-title correction and the
quiet-H4 FN. Both are target-marker dependent. The five genuine
headings that no-image dropped stay true on an unmarked page: those
need some page image, not the magenta box.

### Predictions vs evidence

1. `[H]` Arm B parses 47/47. **HIT.**
2. `[H]` At least one prediction changes. **HIT.** 7.
3. `[H]` Receipts by hour benefits from the marked image. **HIT.**
   Arm C: target-marker dependent.
4. `[H]` Workshop floor is image-dependent or unchanged. **HIT.**
   Target-marker dependent; unmarked page and no-image both
   `heading:true`.
5. `[H]` Arm C distinguishes marker vs page. **HIT.**
6. `[H]` No new data/QLoRA/prompt/crop/vision/holdout. **HIT.**

### Outcome

**D.** Mixed causal dependence.

STOP.

The Part-24 language-side marked verifier **does** use the visual
channel on this validation surface. It is not a pure text/metadata
classifier. Seven of 47 decisions change when the image is omitted.

That dependence is not uniformly helpful:

* the magenta target marker is what rejects `Receipts by hour` and
  what vetoes `Workshop floor`;
* five other genuine headings that the marked arm kept are kept by
  an unmarked page too, and drop only when the image is absent.

Do not interpret this as an eligibility pass. Part 24 remains
failed (TP 19/20). Do not train a new adapter in this Part. Zero
uniform benefit is not a reason to drop the visual channel, and
nonzero dependence is not a reason to promote the Part-24 adapter.

A later experiment may test whether adapting the vision side
changes the marker-harm on quiet H4s. That is not this Part.



