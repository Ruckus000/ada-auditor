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
(`--temp 0`). Score is exact `role` string match plus the trap rule above.
`HF_HUB_OFFLINE=1` after the first successful download.

---

## Part 2 — Measurements

*Empty until the predictions commit is on the branch.*
