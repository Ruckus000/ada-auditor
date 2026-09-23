# r13 confirmation batch: registration (2026-09-23, before any document is run)

**Why.** r13 passed the wild gate on its one look
(`docs/research/document-remediation/heading-stage2-2026-09-23-merged-heading-results.md`),
but that result can't stand as clean for three reasons:
- the guard was re-registered post-hoc;
- the margin is 4 errors;
- the 30 wild documents have been looked at many times.

This batch is a fresh, untouched sample. It gets exactly one look.

## Population (fixed now; no re-draw)

- **Pool:** unused text-bearing untagged cohort-3 census PDFs
  (`out/suggest/wild/_census/census.json`, 1 ≤ blocks_total ≤ 600). Unused means
  in neither `out/suggest/wild/population.json` nor
  `out/suggest/wild-r3/population.json`. That leaves 71 documents, 6,527 blocks and 36 hosts.
- **Primary batch: every pool document whose host is not a host of the 30
  wild-gate documents.** That is 40 documents, 3,759 blocks and 24 hosts. The wild
  set's errors shaped what we know about r13, so a host we have already studied
  is not an independent test. The whole batch is the sample, so there is no
  stopping rule and no prefix.
- **Pre-registered extension:** the 31 same-host pool documents (2,768 blocks).
  They run only if the primary's covered-accuracy exact 95 % lower bound
  lands in [0.987, 0.99) with FP UB ≤ 0.01. If they run, the pooled 71-document
  result is reported as the extension's verdict and disclosed as conditional.
- **Order:** `random.Random(20260923).shuffle(sorted ids)` within each group.
  This order only affects run order.
- A document the tagger can't process is recorded and not replaced.
- `population.json` is written under `out/suggest/confirm-r13/` before the first run.

**Projection:** about 3,000 covered cards, where the gate allows at most 19
errors. At r13's wild error rate (11 in 2,337 = 0.47 %), P(pass) ≈ 0.92;
at 0.6 %, ≈ 0.65.

## Model run (unchanged product path)

`labels.suggest --adapter out/overnight/12-train-r13/adapter-r13 --threshold
0.98081102556551 --all-blocks --split-enumerated-heads`. Code is the branch
head at run time, with R5 in `labels.rules.decide`. The run-in split stays off
(its default). The threshold comes from validation and is never refitted.

## Labels

- **Scope:** every covered card, meaning score ≥ t_r13 and a decisive outcome, is
  judged blind. Asks are not judged. The gate is on covered cards only.
- **Protocol:** page sheets per `labels/judge/PROTOCOL-sheets.md`: protocol v2,
  and a merged heading+body block is H. The judges get no predictions, no other
  judges and no labels.
- **Judge seats:** chosen and written into this file before the first judge
  runs, because the user decides them at the judging go-ahead. The label
  source is disclosed on every number.
- **Training use:** confirmation labels are never training data until this
  result is recorded. After that they may train a later adapter, and that
  retires them as a test.

## Verdict

- **Pass:** covered-accuracy exact 95 % LB ≥ 0.99 and FP exact 95 % UB ≤ 0.01.
- **Reported, not gating:**
  - asks
  - per-document clean rate
  - the single vs multi-line strata
  - the colon-label shape (`^\S.{0,30}:$`)
  - the letter-fragment shape (below)

## Secondary view R5b (one view; registered now; never decides the verdict)

- **The rule:** extend R5 to an enumerator plus an optional opening quote mark,
  `^(?:[IVX]+|[A-Z]|\d+)\.\s*[“"‘']?$` → `Lbl`. It comes from r13's wild
  errors c3-0722:55 and :57, so it is post-hoc. That is why it can only be a
  second view here.
- **Condition:** it is kept as a view only if, before judging starts, it matches
  0 key-H cards in the train and validation keys (`out/keys-all-9`). Otherwise
  it is dropped and recorded as such.
