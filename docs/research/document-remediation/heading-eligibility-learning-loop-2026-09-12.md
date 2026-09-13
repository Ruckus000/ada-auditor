# Heading eligibility from human corrections — the learning loop, 2026-09-12

Continues `qwen35-production-readiness-2026-09-12.md` (Part 28). The question
set for this pass: can real human corrections from the document-remediation
workflow drive heading-eligibility suggestions to **≥99% binary accuracy and
≤1% false-positive rate on a truly held-out, human-labelled, diverse set**,
with the model advisory only?

**Answer on the evidence: not provable, and not trainable, because the
labels do not exist.** Production holds zero heading-eligibility labels, and
the workflow has no question that could produce one. This pass therefore
builds only the offline evaluator and leakage-safe split the claim would have
to pass, registers the thresholds before any label exists, and stops. No
model was trained or run, no product code changed, no PDF was touched, and
neither spent holdout nor the 47-row development set was read.

## 1. The correction flow as it exists (traced, not assumed)

| Step | Where | What it does with headings |
|---|---|---|
| Reading | `Inspect.java` → `DocumentStructure.headings` / `headingTexts` (`domain/document-structure.ts:218-219`) | Lists elements **already tagged** H1–H6 and their text. Nothing proposes a new heading or questions an existing one. |
| Punch list | `domain/document-remediation.ts` (`structure.headings.forEach`, ask `heading:<index>`) | Raises an ask only for a **level skip** or a ladder that does not start at H1 (WCAG 2.4.10). Target is `{ index, from, to }` — no text, no eligibility. |
| Answer | `api/platform/clients/[clientId]/documents/[documentId]/answers/route.ts:64-67`, `ACCEPTS.heading = ['declared','decided']` | `declared` accepts exactly one value, `start-at-h1`; `decided` records a judgement and changes no bytes. |
| Row | `document_answers` (`schema.sql:833`) | Append-only, attributed (`actor`, `operator_id`), keyed to `input_sha256`, with `ask_id`, `kind`, `target`, `disposition`, `value`, `note`. |
| Apply | `integrations/documents/finish.ts:197` → `Finish --renumber-headings` | Re-ranks the existing ladder. The only heading write in the product; it never promotes or demotes an element. |
| Gate | `contentChanges(applyDeclarations(before, answers), after) === []` | Any undeclared structural change refuses the run — the reason eligibility answers could not be applied even if they were collected. |
| Delivery / signoff | derived `documentState`, shared report | Unchanged by anything here. |

### Stored versus missing, for this objective

| Needed for the claim | Stored today? |
|---|---|
| A human decision "this element is / is not a heading" | **No.** No ask asks it. |
| The element it was made about (locator, text, page box) | **No.** A heading ask's target is a ladder index and two levels. |
| The candidate population, including false negatives (text tagged `P` that is a heading) | **No.** Only already-tagged H* reach the punch list. |
| Attribution, time, exact bytes | Yes — `actor`, `operator_id`, `declared_at`, `input_sha256`. |
| Correction-event identity | Yes — `document_answers.id`. |
| Customer | Yes — `client_id`. |
| Template / producer family | **No.** Nothing records it; `input_sha256` identifies bytes, not a template. |
| A model suggestion shown beside the question | No, correctly — no model is integrated (`qwen35-production-readiness`, "no accidental shortcut"). |

### Production census (aggregates only; no value, note, target or text read)

Queried 2026-09-12 against the production Neon database:

| kind | disposition | rows | documents | clients | actors |
|---|---|---:|---:|---:|---:|
| heading | decided | **3** | 1 | 1 | 1 |
| figure | declared | 65 | 9 | 1 | 1 |
| language | declared | 14 | 14 | 2 | 1 |
| every other kind | — | 27 | ≤5 | 1 | 1 |

15 clients, 33 documents in total. The three heading rows are level-skip
decisions from the 2026-09-08 answers pilot (`value` is null on all three).
**Heading-eligibility labels: 0.** Every answer in the table came from one
person.

## 2. Ponytail audit of what this pass could have built

| Candidate | Rung reached | Decision |
|---|---|---|
| Retrain / tune the verifier | 1 — does it need to exist? | **No.** There is no new real data; any run would re-use the development rows the goal forbids claiming from. |
| Export `document_answers` heading rows into a training file | 1 | **No.** The rows answer a different question (ladder level), so an export would manufacture eligibility labels from level decisions. |
| A new eligibility ask in the punch list | 1 — needs a product decision | **Not built; decision requested (§5).** |
| An evaluator that can say "proven" or "not proven" | 1: yes (goal requires it before any training); 2: partly — `run.verifier_gate` counts TP/FP/TN/FN and `run.parse_heading_flag` parses the binary output; 3: stdlib covers exact bounds and hashing | **Built**, reusing `parse_heading_flag`; nothing else from `verifier_gate` survives the provenance, interval and spent-set requirements. |
| A leakage-safe split | 1: yes; 2: no — existing splits are hand-authored stem lists (`role-expanded/split.json`); 3: stdlib | **Built**, ~40 lines inside the evaluator. |
| Database table, service, UI, ML platform, inference runtime | 1 | **No.** |

## 3. The instrument: `experiments/qwen-role-decisions/eligibility_eval.py`

Stdlib Python beside the existing runner; imports only `parse_heading_flag`
from `run.py`. Isolated in `experiments/`, so the production gates are
untouched.

**Labels and predictions are separate files.** A label row is refused unless
it is `label_source: "human-answer"` with an `answer_id`, `actor`,
`client_id`, `template_id`, a 64-hex `document_sha256`, and a boolean
`label.heading` (level 1–6 or null). A label row carrying any model field
(`prediction`, `model`, `model_role`, `heading_flag`, `raw`, `confidence`) is
refused. A `document_stem` matching the development stems (`NN-…`) or the
spent holdouts (`hNN-…`, `kNN-…`) is refused.

**Split.** Rows are unioned into components whenever they share a document,
a template, a client or a correction event; each component is assigned
60/20/20 train/validation/test by a salted SHA-256. Overlap is then checked
independently of the assignment, and any shared key across splits aborts.
Consequence worth stating: **the client is the unit of the split.** A test
set with five clients needs at least that many clients the model never trained
on.

**Evaluation.** Reported separately: TP, FP, TN, FN, abstentions
(`{"abstain": true}`), parse failures (including a missing prediction),
accuracy and its exact lower bound, false-positive rate and its exact upper
bound, false-negative rate, heading-level exactness among true headings the
model accepted, and document / client / template counts. Abstentions and
parse failures count against accuracy — they are never dropped from the
denominator.

**Sealing.** Evaluating `--on test` writes `test.spent` beside the split
manifest, and a second test evaluation of that manifest is refused. Labels
whose hash differs from the one recorded at split time are refused. A new test
set means new labels and a new split.

### Registered thresholds (before any label exists)

`target_met` is true only if **all** hold on the test split:

- accuracy ≥ 0.99 **and** its one-sided 95% Clopper–Pearson lower bound ≥ 0.99;
- false-positive rate ≤ 0.01 **and** its one-sided 95% upper bound ≤ 0.01;
- ≥ 30 documents, ≥ 5 clients, ≥ 10 known templates;
- no row with `template_id: "unknown"` (template leakage cannot otherwise be
  ruled out).

The bounds are what make a point estimate a proof rather than a sample; the
point targets are the goal's own, unchanged. What that costs in labels,
computed with the instrument:

| errors in the set | smallest n whose 95% upper bound ≤ 1% |
|---:|---:|
| 0 | 299 |
| 1 | 473 |
| 2 | 628 |
| 3 | 773 |

So the test split alone needs **at least 299 human-labelled non-headings with
zero false positives** (473 if one is allowed), plus enough headings and errors
budget for the accuracy bound. With a 20% test share and clients as the split
unit, the labelled pool is on the order of **1,500+ non-heading decisions
across 25+ clients** — against 0 today, from 1 reviewer.

### Checks run

```text
python3 -B experiments/qwen-role-decisions/eligibility_eval.py --self-check
# eligibility_eval_self_check_ok
```

The self-check covers label refusals (model source, model fields, spent
stems), a template shared across two clients pulling both into one split under
three salts with 39 components, independent overlap detection, the 299 bound,
the six-way outcome count, level exactness, the unknown-template blocker, a
perfect 1,200-row set passing, and a set that clears accuracy but has too few
negatives blocking **only** on the FPR bound.

Each of five planted defects makes it exit 1: dropping template from the
grouping keys, removing the FPR-bound blocker, accepting `label_source`
other than a human answer, counting abstentions as correct, and allowing an
unknown template.

End to end in a scratch directory (synthetic rows, not a result): `split`
wrote 210/60/30; `evaluate --on test` reported; a second `--on test` was
refused as spent; appending a row to the labels was refused as changed.

## 4. Stop decision

**STOP — blocked on real human labels.** Nothing in the repository or the
production database can be turned into heading-eligibility labels without
inventing them, and a model trained or scored on the existing 47 development
rows would be exactly the claim the goal forbids. No training, prompt,
adapter, crop, or holdout run follows from this pass. The Part 28 outcome (F)
stands and the product's transcription-only repair path is unchanged.

## 5. The decision this needs, and why it is not an engineering default

Collecting eligibility labels inside the approved workflow means the reading
must raise a question the punch list does not raise today. Every way of doing
that changes something a client or the blind corpus sees:

1. **Asks on already-tagged headings** ("is this a heading?", `decided` only).
   Smallest change, but each ask is positionally paired with a client-visible
   `needs` line (`punch()`), it moves every heading-bearing document's punch
   list and every corpus key's `needs` count, and it samples **only** tagged
   H* — false negatives never appear, so the labelled set would be biased
   toward the negative class the FPR claim is about and blind to recall.
2. **Asks on candidates as well** (paragraphs that could be headings). Reaches
   false negatives, but a candidate list has to come from somewhere: a rule
   (the typographic scorer was measured and killed, `heading-promotion-options.md`)
   or a model (not integrated, by decision).
3. **A reviewer-only queue beside the punch list**, off the summary and the
   report. Keeps client surfaces untouched, but it is a second review surface,
   which this goal asked not to build without cause.
4. **Applying an answer** (promote/demote) in any of the above needs a
   declared structural-change channel in `contentChanges` — the same
   architecture that figure artifacting and the empty-row collapse are
   already waiting on — and a human would still approve every change.

Until one of those is chosen, the evaluator is ready and correctly reports
`target_met: false` on every set this repository can produce.

**Decided 2026-09-12 (user): stop here.** No capture is built now. The
evaluator and this record stay; capture is revisited when a client engagement
makes the review work real, and the choice among 1–3 is made then. The
99% objective remains **unproven**, blocked on real human-labelled data that
only reviewer activity can create.
