# Heading structure without a reader: the staged-autonomy roadmap

**Date:** 2026-09-13. **Status:** roadmap — each stage gets its own executable
plan when the previous stage's gate is met. Stage 0's plan is
`2026-09-13-key-dataset-pass.md` (the manual labelling plan,
`2026-09-13-heading-labelling-pass.md`, survives as the audit tool for the
Stage 2→3 gate). **Definition:**
`docs/research/document-remediation/heading-definition-2026-09-13.md` (frozen).
**Instrument:** `experiments/qwen-role-decisions/eligibility_eval.py`.

## The goal, restated

A remediation firm pays a person to decide what every block on every page is.
This roadmap replaces that person with a small model that runs locally at no
per-document cost, cites the WCAG/ISO rule behind every decision, and is
**measured** to a standard before each step of human work is removed. The
product's claim stays a firm's claim — *delivered conformant, verified,
statement attached* — and the model's accuracy is how much of the firm's labour
has been removed, never the promise on the invoice.

Humans remain at exactly two points, each measured in hours rather than
per document: one blind audit on real untagged documents at the Stage 2→3
gate, and sampling shipped output afterwards. The training labels come from
keys — documents whose authors declared the structure — not from a person.

## The arithmetic that shapes every stage

Per-card accuracy is not per-document accuracy. A real document carries
~150 candidate blocks (median 54; thirteen corpus documents hit the 150 cap).

| per-card accuracy | P(document has zero errors), 150 cards | 54 cards |
|---:|---:|---:|
| 99.0 % | 22 % | 58 % |
| 99.5 % | 47 % | 76 % |
| 99.9 % | 86 % | 95 % |

Two consequences. **A model that decides every card at 99 % ships an error in
most long documents**, so "human-free" needs either ~99.9 % on decided cards or
an **abstention channel** that routes the uncertain few to a person. And the
per-document clean rate — not per-card accuracy — is the number that unlocks
the last stage, because it is the number a plaintiff's expert measures.

Proving a rate needs labels: the 95 % one-sided bound on a 1 % rate needs
≥ 299 zero-error cards (473 with one error, 628 with two — computed by the
evaluator). Every gate below inherits that.

## Model design, fixed across stages

- **Small, local, fine-tuned.** Qwen3.5-4B via upstream `mlx_vlm.lora`, QLoRA
  rank 8, 408-token marked-page input (Part 28's mechanically proven contract).
  No frontier model at inference; a hosted model is a policy exception for
  privacy or a measured failure, never the default.
- **Output is the type and the rule, never a bit.** `{"type": "Caption",
  "rule": 3}` over the vocabulary `H, P, Artifact, Caption, TH, TOCI, Lbl,
  BlockQuote` with `rule ∈ {1,2,3,4}` from definition §4, plus the
  ISO 32000 type name it maps to. Rationale distillation: the citation is both
  the audit trail a reviewer reads and the thing that makes a small model
  learn the distinction the standard draws.
- **Abstain is an output.** `{"type": "Unsure"}` is trained from the human
  `Unsure` rows and is the channel Stage 2 routes to a person. Its rate is a
  reported metric, never dropped from the denominator.
- **Two prompts, in order.** Eligibility from the marked page, text, prev/next
  and deterministic facts (repeats-on-pages, in-table); then **level** from
  the approved prior stack in reading order. The stack is made of decisions
  already approved (by a person in Stage 1, by the model's own accepted
  decisions from Stage 2), never of source tags (Part 28: 3/20 correct).
- **Rules in front.** No letters → Lbl; page markers → Artifact; inside a
  table box → not H; caption prefix → Caption. Deterministic, from the
  definition; the model decides only what the rules cannot, and the
  evaluator reports the two populations separately.
- **Deployment is a batch worker** (container, the adapter on disk), never a
  Vercel function. A 150-candidate document is minutes.
- **Both lanes.** PDF: the tagger's tree gives the candidates and the model
  decides types; delivery applies the approved structure through a declared
  change channel that `contentChanges` records rather than refuses. Word: an
  approved heading becomes `w:outlineLvl` in the source and re-converts — no
  PDF surgery, and the converter's measured 148/148 heading fidelity carries it.

## Stage 0 — the labels come from keys, not from a person

**The answers already exist for any document whose author declared its
structure.** So the training and validation sets are built from documents
with a known key, and no card is labelled by hand:

1. **Tagged real PDFs, stripped.** Copy the file, remove `/StructTreeRoot`
   and `/MarkInfo` (bytes otherwise identical), run the tagger and candidate
   builder on the *stripped* copy, and score every candidate against the
   original tree. Real layouts, real producers, real templates; the key is
   the author's own structure. 44 of the 52 corpus PDFs qualify today; the
   harvester can supply hundreds.
2. **Word documents, converted.** A heading in Word is an outline level, and
   the product's converter carries headings 148/148. Convert with the same
   tagged-export filter the product uses, then treat the result exactly as
   source 1. The 26 corpus `.docx` files come free; public `.docx` files are
   unlimited.
3. **Planted documents.** The blind-corpus generator already builds
   documents with keys; they enter the same way.

**Key hygiene, because authors are wrong sometimes and a key inherits it.**
A document's key is used only if the original passes veraPDF's UA-1 checks
for `7.1-3` (all content tagged — otherwise "no element here" cannot mean
Artifact), `7.4.2` and `7.4.4` (no level skips, one structure paradigm), and
its headings' sentence share is under 30 % (the 2.4.6 measurement; the r34
shape). Every exclusion is counted in the record. Four corpus campaigns found
keys wrong more often than the product — this is where that lesson lands.

**What a key cannot give:** the population the product targets — untagged
documents in the wild — has no author structure by definition. Stripping
tagged PDFs simulates it but skews toward better producers (Arm B: 23/28
green on generated, 2/28 on real). So Stage 0 proves the model *recovers
keys*; whether it transfers to the wild is the Stage 2→3 audit — ~400 blind
cards on real untagged documents, once, about an hour. That is the only
human labelling on this roadmap, and the labelling tool built for the
manual pass is kept for exactly that.

**Planted depth cohort (rung 2 of the ladder, added 2026-09-14).** The
blind-corpus generator (`docx-builders.mjs`: `heading(level, text)`, direct
`w:outlineLvl`, `basedOn` inheritance, the level-9 body override, image-only
headings, bold-but-not-heading paragraphs) already builds Word documents with
perfect keys and controllable depth. Round 2 measured the training gap as
depth (25 H3 / 1 H4), so the next data comes from there — converted through
the product's own exporter, `label_source: "planted"` — before any further
real harvest. Validation stays real, so synthetic-green/real-red is measured
(Arm B's lesson), not assumed. Bare numerals: the front rule asserts only
"not a heading"; its ISO type is not scored (rule rows are binary-only in the
evaluator). Real untagged PDFs harvested but not keys (cohort 3: 522) are the
Stage 2→3 audit population — kept, not waste.

**Human hours:** 0 in Stage 0.
**Gate to Stage 1:** ≥ 20,000 key-labelled cards from ≥ 60 hosts after
hygiene, match rate (candidate ↔ key element) ≥ 95 % with unmatched
candidates reported by cause, split by host, `test.spent` absent.
**Kill:** TRUST exclusions — `7.1-3`, `7.4.2`/`7.4.4`, prose headings,
checker-failed — exceed half the tagged pool: the keys are not trustworthy at
scale and a human-audited subset has to anchor them before training. YIELD
exclusions (a key with no headings) are a cost, reported beside it, never a
kill. (Ruled 2026-09-14: the ≥ 1-H rule was added after this kill was
written and tripped it on yield alone — combined pool trust 37 %, yield 66 %.
The rule stays; its ceiling: it drops every headingless key, and the upgrade
path is a per-row rule keeping their non-short rows once a measurement shows
those rows are clean.)

## Stage 1 — the model exists and is measured (a person verifies everything)

**What:**
1. Fine-tune round 1 on the train split with the type+rule target; register
   the run before launch (population, prompt SHA, config, adapter SHA).
2. Evaluate on **validation only**: accuracy, FP rate with bounds, FN rate,
   parse failures, abstention rate, level exactness on accepted headings,
   errors **by rule** and **by type confusion**, rule-decided vs model-decided
   populations separately.
3. Error analysis by rule decides the next round: a definition gap → §5
   ruling; a data gap → more examples of that shape (Stage 3's harvest loop
   supplies them); a facts gap → a new deterministic card fact.
4. Surface the suggestions in the workbench beside each heading ask, with the
   rule citation, the type, and `Unsure` where the model abstains. **A person
   verifies every suggestion**; every verification is a new label row with
   provenance (`answer_id`, actor, bytes) — the production learning loop.

**Human hours:** per document, the reviewer accepts/overrides ~150
suggestions (≈ 3–5 min/doc, down from a firm's ~30–60 min/doc for step 1).
**Gate to Stage 2 (validation split, decided cards only):** accuracy ≥ 99 %
with 95 % lower bound ≥ 99 %; FP rate ≤ 1 % with 95 % upper bound ≤ 1 %;
abstention rate reported and ≤ 10 %; level exactness ≥ 95 %; zero parse
failures. Then **one** test-split evaluation, which must hold the same bar.
**Kill for this design:** after three rounds with error analysis applied,
validation accuracy is flat below 97 % — the model family is the limit.
Re-plan (larger local model, or crops) with a new registration; do not tune.

## Stage 2 — the person sees only what the model abstains on

**What:** decided cards are applied without review; `Unsure` cards go to the
reviewer. The delivered PDF carries the model's decisions through the
declared-change channel, is read back, and passes veraPDF like any delivery.
The report discloses "structure decided by model, N of M blocks reviewed by
a person."

Add the second instrument: a **per-document clean rate**. On every reviewed
document (Stage 1 rows keep arriving from the abstention channel and from
spot checks), count documents with zero model errors among decided cards.

**Human hours:** the abstention share of cards — at 5 % abstention on a
150-card document, ~8 cards, under a minute.
**Gate to Stage 3:** over ≥ 100 documents from ≥ 20 hosts with full human
verification (a held-back verification stream, 1 in 10 documents fully
reviewed), the per-document clean rate on decided cards is ≥ 90 % with the
95 % bound ≥ 85 %, and no false heading reached a delivered file's structure
(the readback gate holds).
**Kill:** a false heading reaches a delivered file undetected by readback —
the declared-change channel is not tight enough; return to Stage 1 for
delivery until it is.

## Stage 3 — human-free at inference, humans audit samples

**What:** nobody reads documents. A random sample of shipped documents
(1 in 20, stratified by host and by whether the tagger or the source supplied
the tree) is fully reviewed by a person each week; every correction is a
training row; retraining is a scheduled round with a registered evaluation on
a fresh validation split (new hosts only). The product's conformance
statement names the model version, the audited clean rate and its bound, and
the audit sample size — the firm's QA statement, in numbers.

**Growing the dataset by an order of magnitude** happens here and does not
scale human hours with documents: harvest public documents (the corpus
harvester already refuses training-set domains and byte duplicates) → the
model drafts every card with its rule citation → a person audits ~400 blind,
stratified cards → the round is accepted as training data only if the audit
bound holds (≤ 1 % FP, 95 %), else the errors-by-rule say what to fix first.
Each round is an afternoon of human time for thousands of documents.

**Human hours:** the weekly sample plus one afternoon per data round.
**Steady-state gate (never spent):** the audited per-document clean rate stays
≥ 95 % and the FP bound ≤ 1 % on every audit; two consecutive misses drop the
product back to Stage 2 until a retraining round restores it.

## What is deliberately not on this roadmap

- A frontier model at inference. Cost scales with documents; the whole point
  of the small model is that it does not.
- A human deciding blocks in production beyond Stage 1. A firm's per-block
  human is labour that measurement replaces, not a legal requirement.
- Any claim from the development cards or spent holdouts, any reopening of
  either holdout, any test-split evaluation before a validation-driven
  candidate exists, any lowering of the per-card bar to make a stage gate.
- Reading order, tables, lists and figures as model outputs. They stay with
  the tagger (measured, disclosed) and the punch list; the loop hardens the
  piece with the worst error rate first. Each of the others gets this same
  roadmap when headings clear Stage 2 — same definition-first discipline,
  same evaluator, its own labels.

## What changes in the labelling plan now

Nothing is added to `2026-09-13-heading-labelling-pass.md`; its Tasks 0–8
stand (manifest, staging, candidate cards, images, the labelling tool) and
are reused by the key-dataset plan. Its Task 9 — a person labelling every
card — is retired; the tool is kept for the ~400-card audit at the Stage 2→3
gate.
