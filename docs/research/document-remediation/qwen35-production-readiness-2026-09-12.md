# Qwen3.5 role-layer: production-readiness continuation — 2026-09-12

This record continues [PR #239](https://github.com/Ruckus000/ada-auditor/pull/239)
at `8979d51`. It is research only: no customer PDF was mutated and no
production code was integrated. The one registered processor probe and one
optimizer-update feasibility probe below are not a quality or delivery claim.

## Decision

**The Part 27 mechanical OOM is no longer a blanket blocker.** The original
`--image-resize-shape` setting was indeed ignored on the native Qwen path, but
the same pinned processor can enforce an existing `max_pixels` control. The
stock trainer cannot forward that control, so the revised baseline materializes
processor-sized copies of the marked input images and then uses the unmodified
upstream trainer. One registered update completed, saved, changed vision
weights, and reloaded through the standard loader.

This does **not** earn another quality run or production integration. It is a
new input contract, not “Part 24 plus vision training”; it has not produced an
eligibility score, a hierarchy score, a fresh-document result, or a deployable
production artifact.

This follows Ponytail's order: no production feature is needed yet; Part 26's
existing policy is reused; the installed/upstream processor capability is
checked before a custom trainer; only then is a new, bounded experiment
considered. The external upstream work is relevant but not a substitute for
the pinned runtime: MLX-VLM documents `--image-resize-shape`, while the
[maintainer discussion of the Qwen image path](https://github.com/Blaizzy/mlx-vlm/issues/1175)
identifies `processor.image_processor.max_pixels` as the existing workaround
when that argument is not forwarded.

## Acceptance measurements are now trustworthy

`experiments/qwen-role-decisions/run.py` now owns the Part 26 final-state
contract used by both current evaluation and the Part 26 audit:

| Situation | Current interpretation | Historical replay |
|---|---|---|
| Non-heading finishes as H1–H6, even unchanged | semantic false heading; unsafe | reported separately |
| Candidate finishes as H1–H6 | eligibility verifier is required | mutation-only selector only |
| Verifier says `false` | final role is `P` | historical keep-existing behavior only |
| Verifier response is absent or invalid | unresolved; it prevents a pass | historical artifact remains unchanged |
| Role output has an invalid enum/type | unparsed | unparsed |

`score_holdout(..., legacy=True)` is the sole legacy interpretation. It labels
its result `legacy_mutation`; default scoring labels results
`semantic_final_state`. This prevents an old green artifact from being
silently recast as a current safety result.

The runner's small self-check now proves the critical counterexample: a real
H1 plus an unchanged false H2 passes the legacy mutation gate but fails the
semantic-final-state gate. It also covers verifier rejection, unresolved
verification, and invalid role output. `part26_semantic.py` reuses the shared
policy and explicitly requests legacy behavior only where it reconstructs
historical measurements.

## Frozen hierarchy diagnosis

The current role prompt supplies one card's text, font, weight, immediately
previous text, and immediately next text. It hides the existing tag and does
not supply the nearest preceding heading, active parent chain, or any prior
role decision. Its validation data demonstrates an input-information limit,
not a claim that the model cannot learn hierarchy:

| Doc 18 card | True level | Font / weight | Why a single card cannot establish depth |
|---|---:|---|---|
| `Logging` | H2 | 17pt bold | It begins a top-level procedure section. |
| `PAPER FORMS` | H3 | 17pt bold | It has exactly the same typographic signals as H2, but is nested under `Logging`. |
| `DIGITAL LOG` | H3 | 17pt bold | Its correct depth also depends on `Logging`, which is not in the card input. |
| `Storage` | H2 | 17pt bold | It returns to top level; the current card does not carry the completed branch. |
| `FRIDGE` | H3 | 17pt bold | It is nested under `Storage`, again outside the prompt. |

The frozen Part 20 result—H1 2/2, H2 4/4, H3/H4 3/14 exact after expanded
training—is consistent with that missing state. The same evidence does **not**
prove that more hierarchy examples, vision training, or a larger model is the
right repair.

`part28_hierarchy_context.py` now tests the tempting smaller shortcut before
it becomes a design: take the PDF's existing H1--H6 tags, update a conventional
heading stack in card order, and give a candidate the resulting prior stack.
It uses no truth to construct that source stack; truth is consulted only to
score it. On the frozen development validation cards, this representation must
be treated as corrupt evidence, not structural context: the source tags include
both wrong levels (`ARRIVAL` is source H3 but true H2; `Reception` is source H4
but true H3) and false headings (the `Reception issues…` paragraph is source
H5). Measured across the 20 expected headings in docs 17/18, only **3/20**
source levels match, only **4/20** cards see the correct prior source stack,
and only **3/20** have the correct stack after their own source tag is applied.
Those mistakes then contaminate later parent chains. A source-tag stack
therefore cannot be the deterministic repair or the model's trusted context.

A future context experiment must instead use independently extracted preceding
heading *candidates*, never the source tag as truth and never ground truth. It
must be registered separately from eligibility training and report its own
stack-level error rather than quietly converting known-bad input into a
deterministic hierarchy claim.

## Processor input contract: measured

The pinned `mlx-vlm==0.7.0` trainer's `VisionDataset` first tries its native
Qwen processor path and never forwards `image_resize_shape` to it. Its fallback
does see that argument, but explicitly refuses to resize a native image
processor. The native `Qwen3VLImageProcessor`, in contrast, accepts per-call
`max_pixels`, and uses that same sizing math for processing and token
estimation.

`part28_processor_probe.py` registers the model package before loading only
the processor; it does not call `mlx_vlm.load` or the trainer. On the generated
marked portrait and landscape pages, it asserts the processed grid, patch count,
and estimated token count agree:

| Marked page | Default grid / tokens | `max_pixels=448000` grid / tokens | Processed size (H×W) |
|---|---:|---:|---:|
| `13-workshop-induction:8` — `Sign-in desk` | `1×100×70` / 1,750 | `1×48×34` / 408 | 768×544 |
| `20-tank-soundings:7` — `West bank` | `1×70×100` / 1,750 | `1×34×48` / 408 | 544×768 |

That is a 76.7% image-token reduction in both orientations. Visual inspection
of the two marked reduced pages retained the outlined target and readable target
text. That is an input-legibility observation, not a prediction-quality result.

The trainer still cannot take this control directly. `part28_resize_sft.py`
therefore uses the same native sizing calculation to create a separate,
ignored 161-image copy of the SFT. It preserves every message and label,
records the source SFT SHA-256 (`388809e5…d6389b0`), and verifies that the
trainer's *default* preprocessing of every stored image yields exactly 408
tokens. This is physical preprocessing at the data edge, not a trainer fork.

## Reproducibility repair

The Part 24 SFT was previously an ignored file with absolute image paths.
`--emit-chart-expanded-verify-sft` now reconstructs it from the tracked Part
22/23 manifest, the three tracked card sources, and the existing PDF/Mark.java
bridge. On this checkout it rebuilt 161 rows (67 true / 94 false), 161 unique
marked images, no missing/excluded rows, and no `Existing tag` leakage.

The JSON hash is `388809e5…d6389b0`, not the historical `9c4f…` hash, because
the latter serializes absolute paths from a different worktree. Membership,
order, labels, bridge checks, and generated image availability are now checked
directly instead of treating a path-dependent JSON hash as portable evidence.

## One registered mechanical probe: passed

The bounded feasibility question was whether the maintained upstream path can
finish one optimizer update once it actually receives 408-token inputs. It used
the frozen 161 development rows and the standard `mlx_vlm.lora` command with
batch size 1, rank 8, `--train-on-completions`, `--grad-checkpoint`, and
`--train-vision`; `--iters 1` bounds this to one update. It did not use the
ignored `--image-resize-shape` argument, alter labels, change the prompt, or
evaluate docs 17/18 or either spent holdout.

| Acceptance condition | Result |
|---|---|
| Optimizer update / finite loss | pass — iteration 1, loss 0.14387904 |
| Memory recorded | pass — peak 9.810 GB |
| Vision weights changed | pass — 297 vision tensors saved; `vision_tower.blocks.0.attn.proj.bias` changed 195/1,024 BF16 entries against base |
| Standard save/reload | pass — 1.4 GiB adapter saved and `mlx_vlm.utils.load(..., adapter_path=...)` returned the normal model and Qwen processor |

The 1.4 GiB adapter is a material deployment question in its own right: it is
full vision-tower state, not a small vision LoRA. No product packaging or Vercel
feasibility is implied by a local reload.

The current production path has no accidental shortcut around that question:
searching `src/`, `scripts/`, `package.json`, and `next.config.mjs` finds no
Qwen, MLX, model-path, or adapter-loading integration. The deployed document
routes remain the existing conversion/transcription and readback-verified
repair path. That is intentional containment, not an omitted wiring task: any
future inference proposal must first supply a separately bounded runtime and
delivery design that preserves the product's no-invention rule.

## Registered revised eligibility run: failed

The single next quality measurement is registered before launch. It asks one
question only: whether full vision-tower training on the **new, processor-sized
408-token input contract** eliminates the frozen docs-17/18 eligibility error
without reintroducing the chart-title error. It is not a comparison to Part 24
as though its physical inputs were unchanged.

- Population: the reconstructed 161 development rows, unchanged labels,
  prompts, target-marker geometry, train/validation split, rank (8), batch
  size (1), learning rate (the upstream default `2e-5`), and six epochs.
  Docs 17/18 remain validation only; neither spent holdout is read.
- Only intended training difference: `--train-vision` on the 408-token image
  copies. The existing native processor and unmodified upstream trainer are
  reused; no resize flag, trainer patch, crop, prompt change, extra example,
  weight, threshold, or model is introduced.
- Output: a new ignored `out/adapter-part29-vision-408` directory. It never
  overwrites a frozen adapter. `--steps-per-save 1000` records only the final
  state for the 966 updates.
- Direct eligibility pass: 47/47 valid JSON results, TP 20/20, TN 27/27, no
  FN or FP; specifically `Workshop floor` must be `heading:true` and
  `Receipts by hour` must remain `heading:false`. Any other outcome stops the
  vision route; there is no tuning or second configuration.
- Even a pass is development-only eligibility evidence. It does not repair
  hierarchy, earn a spent holdout, authorize a customer mutation, or resolve
  the 1.4 GiB deployment gate.

```text
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python -m mlx_vlm.lora \
  --model-path <pinned-local-Qwen3.5-4B-MLX-4bit> \
  --dataset experiments/qwen-role-decisions/out/part28-reduced-sft \
  --split train --batch-size 1 --lora-rank 8 --epochs 6 \
  --steps-per-report 10 --steps-per-save 1000 --train-on-completions \
  --grad-checkpoint --train-vision \
  --output-path experiments/qwen-role-decisions/out/adapter-part29-vision-408
```

The run completed and reloaded. Its final adapter is **698 MiB**
(`adapters.safetensors` SHA-256 `ec3c2711…2730b0e8`; the adapter config is the
same recorded QLoRA config SHA-256 `51518b19…6d31d82`). The direct frozen
eligibility result is 47 parsed decisions: **TP 20/20, TN 26/27, FN 0, FP 1**.
`Workshop floor` changed to `heading:true`, but `Receipts by hour` regressed
to `heading:true`. This is the exact marker-specific tradeoff that the run was
registered to eliminate, so the experiment **fails** its stricter all-or-nothing
gate. The generic `verifier_gate` reports a broad development pass because it
does not require zero FPs; the registered Part 29 gate does, and therefore
governs this decision.

No further configuration, prompt, data, marker, crop, threshold, or holdout
run follows from this result. Full vision training at the reduced physical
input size can recover the quiet H4, but this evidence does not make it a safe
eligibility component, and the absent production runtime plus the hierarchy
failure remain independent reasons not to integrate it.

## Remaining gates

1. **Eligibility remains unearned.** Any multi-update model experiment needs a
   newly registered revised baseline and may evaluate only the development
   material under the shared final-state semantic contract. One update is not
   evidence for Workshop floor, Receipts by hour, false-heading safety, or an
   image-causal decision.
2. **Hierarchy stays independent.** The smallest source-tag stack has been
   falsified as unsafe on frozen development cards. Before changing data or
   model capacity, register one context representation built from independently
   extracted preceding heading candidates. It must be evaluated against the
   shared semantic contract and report level exactness, semantic false headings,
   real headings removed, unmatched headings, unresolved evidence, and
   stack-context error separately.
3. **Production has its own gates.** A candidate must earn eligibility and
   whole-document gates, demonstrate a bounded deployment path for a 1.4 GiB
   full-vision adapter (or reject that approach), and retain readback-verified,
   non-inventive PDF delivery semantics. Neither spent holdout may be reopened.

Neither spent holdout may be reopened, and neither probe authorizes PDF
mutation or delivery. The existing production repair path remains the only
shipping behavior because it transcribes source statements and verifies the
output readback.

## Checks run

```text
python3 -B experiments/qwen-role-decisions/run.py --self-check
python3 -B experiments/qwen-role-decisions/part26_semantic.py --check-only
python3 -B experiments/qwen-role-decisions/part27_score.py
python3 -m py_compile experiments/qwen-role-decisions/run.py \
  experiments/qwen-role-decisions/part26_semantic.py \
  experiments/qwen-role-decisions/part27_score.py \
  experiments/qwen-role-decisions/part28_processor_probe.py \
  experiments/qwen-role-decisions/part28_resize_sft.py \
  experiments/qwen-role-decisions/part28_hierarchy_context.py
git diff --check
```

Those checks passed. The processor probe, reconstructed SFT, reduced-input
materialization, one-update upstream run, tensor-byte comparison, and standard
adapter reload also passed as recorded above. The application-wide checks listed
in `AGENTS.md` were not run: this changes isolated research instruments, not a
product surface, and this record makes no application-CI or deployment claim.
