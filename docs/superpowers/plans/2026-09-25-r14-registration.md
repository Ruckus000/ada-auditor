# r14: fold cohort 8, test the run-in split, retrain (registration, 2026-09-25, before any build)

**Why.** The cohort-8 look was NOT MET: 133 errors against 71 allowed
(`heading-stage2-2026-09-24-cohort8-look-results.md`, 7a4e8d5). Its errors sit
on solid labels. The two big classes are:
- run-in headings: 55 FN
- table headers called H: 23 FP

Cohort 8 is now spent for the gate. The user decided on 2026-09-25 to take four
steps in order: fold cohort 8 into the data, measure the run-in split, train
r14, then source cohort 9. Steps 1–3 are registered here. Cohort 9 gets its own
registration before its look.

## Step 1: fold cohort 8 (a data build, no model)

- **Host split, fixed now.** Each cohort-8 host goes to train if
  `sha256("cohort8-r14\0" + host)`, read as a unit fraction (first 15 hex
  digits), is < 0.70, and to validation otherwise. Host is
  `labels.manifest.host_of(url)` from `labels/cohort8-names.txt`. The test split
  is never grown.
- **Rows.** Every labelled cohort-8 card (`out/labels/cohort8-labels.jsonl`,
  8,953 cards: the look's covered cards; asks were never judged) becomes a keys
  row.
  - `client_id` = `template_id` = host.
  - `document_sha256` comes from the PDF bytes.
  - `label_source` is a new source, `opus-fable-consensus`, added to
    `eligibility_eval.LABEL_SOURCES`.
  - The card is the product's own suggest card, unchanged.
- **Ladder.** Each cohort-8 document's `key-headings.json` entry is built from
  its H-labelled cards, in reading order, at their judged levels.
  - Headings that fell among asks are missing from the ladder. This is
    disclosed, not repaired.
- **Base.** The r13 keys overlay (`out/overnight/03-keys-r13-overlay`) and its
  `split.json`. No original row changes.
- **New module:** `labels/cohort_overlay.py`, with tests. It refuses on:
  - an id collision
  - a host already in another split
  - a label row that fails `eligibility_eval.refusals`

## Step 2: run-in split, measured on the cohort-8 validation hosts with r13

- **Run.** Rerun `labels.suggest` on the validation documents with
  `--split-run-in-heads 0.5`; everything else is as in the look. Model: r13 at
  t_r13.
- **Judging.** Every covered card that is new or changed (a new id, or a
  changed text) is judged exactly as in the look: two seats, then the tie-break.
  Unchanged cards keep their look labels.
- **Adopt the split only if both hold** on the validation documents:
  1. covered errors fall
  2. the FP count does not rise

  Asks are reported. If adopted, the flag becomes part of the product path for
  the cohort-9 look. The training data does not change: split heads are short
  heading cards, a shape the model already trains on.

## Step 3: r14

- **Data.** `labels.emit_sft` on the step-1 keys, with the exact r13 flags:
  `--on train --exclude-doc-prefix c5 --oversample-regular-h 2`.
- **Training.** From the base model with the exact r13 recipe (rank 8, batch 1,
  `--train-on-completions --grad-checkpoint`).
- **Iterations: 11,144,** the same as r13, which is about 16 h on this Mac. The
  dataset is larger, so that is fewer than 2 epochs. The budget is the user's
  16 h window; the epoch count is disclosed.
- **Threshold.** Re-derived on the keys validation split with the registered
  r11 operating-point rule, beside r13. r14 must meet r13's guard (covered
  accuracy LB and FP count no worse than r13's) at its own threshold.
- **Secondary check (reported, not gating):** the cohort-8 validation hosts at
  t_r14 against r13 at t_r13, on the same cards.
- **Candidate for the cohort-9 look:** r14 if it meets the guard and makes fewer
  cohort-8 validation errors than r13; otherwise r13. Either way, cohort 9 gets
  one look under its own registration.

## Scope

- **Rules** (`labels/rules.py`) are unchanged.
- **Invisible marks:** a separate session is fixing marks that vanish on large
  pages. That fix changes model inputs, so it does not enter r14's data or any
  look without its own registration.
- **Cohort-8 labels** are training and validation data from now on. They are
  never test data again.
