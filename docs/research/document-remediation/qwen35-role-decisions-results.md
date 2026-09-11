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
