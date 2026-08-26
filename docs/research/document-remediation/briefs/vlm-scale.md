# Brief B — Is the alt-text wall the model, or what we gave it?

**Read [README.md](README.md) first. It is binding and it is not advisory.**

**Results file:** `docs/research/document-remediation/vlm-scale-results.md`
**Timebox:** one session.

---

## The one question

> **Is the alt-text failure a property of the model, or of the input we gave it?**

Two variables, one question. **Arm 2** changes the model. **Arm 3** changes the
input. Same three images, same scoring, throughout.

## Why this question, and why it is a test of our own conclusion

[picture-description-results.md](../picture-description-results.md) concluded that
alt text is unreachable under zero human input. That conclusion was drawn from
**SmolVLM-256M-Instruct** — a 256-million-parameter model, which is tiny — and it
is the only evidence behind it.

It also stated a mechanism, and the mechanism is the part worth attacking:

> *"No amount of prompt engineering recovers a purpose that is only visible from
> the document's context."*

**The document's context is in the document.** We extract it. `StructText.java`
already reads the text around every figure. We ran a 256M model on bare pixels
with no page text and concluded the purpose was unrecoverable. **That is an
untested claim about our own input, not a finding about alt text.**

This brief is a falsification test of a conclusion this project has already
written down and is currently acting on. Findings that survive an honest attempt
to break them are worth more than findings that were never attacked.

## What "correct" means here — pre-registered, so it is not judged on fluency

`lacity-clerk-misc` page 4 carries photographs that are **proof-of-posting
evidence**: the statutory record that a public hearing notice was physically
displayed, with a dated newspaper to establish when. That evidentiary purpose is
the entire reason the images exist, and it is what WCAG 1.1.1 requires be
conveyed.

**Pre-register the required facts per image before running anything.** From the
recorded observations:

| image | facts a description must convey |
|---|---|
| 1 | it is a **hearing notice**; a **newspaper** is present as date evidence |
| 2 | a **storefront/building**; the **same notice** is displayed at the entrance |
| 3 | determine what it actually is first, then register its facts before scoring |

**Score against that list, as a binary per fact. Not against how the sentence
reads.** The prior model produced fluent, grammatical, confident prose and that
is precisely what made it dangerous — it passes a human skim and it passes
veraPDF, which sees `/Alt` populated and clears 7.3-1.

---

## The arms

**Arm 1 — baseline.** SmolVLM-256M, already recorded. Do not re-run it; quote
the recorded output and score it against the fact list for calibration.

**Arm 2 — a larger local model, bare image.** Same three images, same bare-pixel
prompt, no page text. Isolates model size.

**Arm 3 — the same larger model, with document context.** The same images, with
the surrounding page text included in the prompt. Isolates input.

Run the model **standalone on extracted images**. Do not route through docling's
`--enrich-picture-description`. We already know that path is broken end to end —
descriptions never reach `/Alt`, `alt_source` reports `"missing"` — and fighting
its configuration would measure the plumbing instead of the model. Extract the
three images with the vendored PDFBox 3.0.8 and feed the model directly.

### Choosing the model

**`[R]` Qwen2.5-VL-7B-Instruct is the default suggestion** — strong on document
understanding, Apache-2.0, and runs on Apple Silicon. Prefer a quantized or MLX
build. You may substitute a different local VLM with reasons recorded.

**License is part of the work, not an afterthought.** This is a commercial
product. Llama 3.2 Vision ships under a community licence with restrictions, not
a permissive one. **Record the licence of whatever you run.** This project has
already published one incorrect licence claim and had to withdraw it.

### Before you install anything

- **`df -h` first, and record it.** The volume is 96% full with roughly 36 GB
  free. The last model was estimated at ~1 GB from its model card and measured
  **9.2 GB** with cache. **If the model does not fit, report that and stop.** Do
  not delete anything to make room.
- **Pin the version and the weights.** A model that drifts silently makes every
  number here unreproducible.
- **Verify locality before the first real image.** Set `HF_HUB_OFFLINE=1` and
  confirm the run still completes. That is the method already proven in this
  project and it is what converts `[R]` to `[V]`. Vendor documentation claiming
  local operation is `[R]`.
- **PII is absolute.** These are municipal records with private individuals'
  names and addresses on them. **No cloud API, no hosted inference, no upload,
  for any reason.** If the local path fails, the experiment fails; it does not
  fall back.

### Also record, cheaply, without building anything

`[R]` Docling's `picture_area_threshold` defaults to **0.05**, so every image
under 5% of page area is skipped with no warning — and logos, seals and
signature blocks, which dominate municipal documents, all sit below it. **Confirm
the value is configurable and record it.** Do not implement anything. It is
plumbing, and knowing whether it is a wall or a setting costs one lookup.

---

## Registered prediction

**Commit this to the results file before the first measurement.** Rule 5.

1. `[H]` **Arm 2 names the hearing notice in at least 2 of 3 images.** A 7B
   document-capable VLM should read the words *NOTICE OF PUBLIC HEARING* off the
   placard. **If so, our recorded conclusion is partly wrong and size mattered.**
2. `[H]` **Arm 2 conveys the evidentiary purpose in none of the 3.** Naming the
   notice is not saying the photograph is proof it was posted.
3. `[H]` **Arm 3 conveys the purpose in at least 2 of 3**, because the
   surrounding page text says what the photographs are for.
4. `[H]` **Therefore the stated mechanism — that context is unrecoverable — is
   wrong**, because the context was in the document and we never supplied it.
5. `[H]` **The specifics stay wrong.** Even in Arm 3, an address or a date that
   appears in neither the pixels nor the supplied text will be omitted or
   invented. **Check specifically for invention** — a fluent hallucinated address
   is the worst outcome available and is worse than the 256M failure, not better.
6. `[H]` `picture_area_threshold` is a configurable value, not a limitation.

### Win condition, stated so it can be recognised

**For at least 2 of 3 images, a description that conveys every pre-registered
fact and invents nothing.** Fluency is not evidence. Naming the object is not
conveying the purpose.

### Kill condition

Neither arm names the notice. The recorded conclusion hardens and alt text under
zero human input is a measured boundary rather than a gap.

### The limit on any win — state this in the results regardless of outcome

**A win here does not unblock alt text.** Even a perfect description is an
assertion, and **nothing we have can check it.** That is what makes alt text
different from headings and tables, where ground truth or geometry gives us a
test. This brief can move the question from "can a model do it" to "can we ever
know when it has" — it cannot answer the second. Do not let a good Arm 3 result
be reported as alt text being solved.

---

## Not doing

- **No cloud model, no hosted inference, no upload.** Not once, not for a
  sanity check.
- **No fine-tuning, no LoRA, no training.**
- **No building an alt-text stage**, and no wiring anything into the pipeline.
- **No fixing `alt_source: "missing"`.** It is a bug in someone else's writer,
  it is real, and it is not this question.
- **No docling configuration archaeology** beyond confirming one threshold value.
- **No additional documents or images.** Three images. If the small-image
  threshold looks interesting, it goes on FINDINGS.
- **No prompt-engineering tournament.** One bare prompt, one context prompt. If
  the answer depends on finding the magic wording, the answer is no — a
  technique that needs a human to tune it per document has not solved zero-human.
- **No holdout 2.** Sealed.
- **No product recommendation.** Rule 9.

## Stopping condition

The three arms are scored against the pre-registered fact list and the prediction
is checked line by line → stop. Or the model does not fit on disk → record and
stop. Everything else goes on FINDINGS.
