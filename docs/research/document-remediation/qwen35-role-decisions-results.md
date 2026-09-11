# Qwen3.5-4B role decisions — is the path even load-bearing?

**Date:** 2026-09-11 · Branch `cursor/qwen35-role-decisions-914b`.
**Status at time of writing this section:** pre-registration. No model has been run.

Ponytail applied to the original six-file trainer plan: this spike is one
question, one results file, hand-authored cards, and `mlx_vlm.generate`. No
element extractor, no schema module, no LoRA wrapper, no `src/` wiring. The
ladder said those exist only after this measurement says they must.

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

