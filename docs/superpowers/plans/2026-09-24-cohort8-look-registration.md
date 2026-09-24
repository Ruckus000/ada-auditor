# Cohort 8: one look at r13 with the rule guards (registration, 2026-09-24, before any document is run)

**Why.** The r13 confirmation batch failed. Its documents are now spent:
- the rule guards (32465aa) were designed on its errors
- the tie-break adjudication re-labelled some of its cards

On that spent data, r13 plus the guards plus adjudicated labels comes to 14
errors on 2,872 covered cards. That estimate is seen data. Cohort 8 is fresh,
never looked at, and host-disjoint, and it is the test. **One look.**

## Population (fixed now; no re-draw, no extension)

- **Pool:** every cohort-8 document that is untagged, with
  1 ≤ blocks_total ≤ 600, from `out/cohort8/_census/census.json`.
  - That is **104 documents, 79 hosts, 10,934 blocks**.
- **How cohort 8 was sourced:** mechanically, with no document content read.
  - The sweep rule is in `out/cohort8/sweep-rules.txt`, written before any
    fetch.
  - The candidate list is lines [2000, 3500) of the CISA City/County .gov list.
    The DocumentCenter View ids were fixed in advance, with at most 3 documents
    per host.
  - The exclusion set covers 448 hosts: every earlier cohort, census, population
    and blind-corpus host. Collisions: 0.
- **The whole pool is the sample.** The user chose "all 104" on 2026-09-24.
  There is no stopping rule and no prefix.
- **Run order:** `random.Random(20260924).shuffle(sorted ids)`. It affects run
  order only.
- **Failures:** a document the tagger can't process is recorded and not
  replaced.
- `out/suggest/cohort8-r13/population.json` is written before the first run.

**Projection:** about 8,400 covered cards (0.77 covered per block, as in the
last batch). At that size the gate allows about 66 errors.
- P(pass) is 1.00 at a 0.49 % error rate, 0.99 at 0.6 %, and 0.84 at 0.7 %.

## Model run (the product path at the branch head)

`labels.suggest --adapter out/overnight/12-train-r13/adapter-r13 --threshold
0.98081102556551 --all-blocks --split-enumerated-heads`, one run per document.

- The code is the branch head (5ee2030 or later with no `labels/` change). That
  includes both rule guards; Tesseract is required.
- The threshold comes from validation. It is never refitted.

## Gate (unchanged)

On covered cards (score ≥ t and a decisive outcome), **both** must hold:
- accuracy exact (Clopper–Pearson) 95 % lower bound ≥ 0.99
- FP rate upper bound ≤ 0.01

Asks are reported, not gated. Per-document clean rate and strata are reported,
not gated.

## Labels

- **Scope:** every covered card, judged blind on page sheets. Asks are not
  judged.
- **Protocol:** `labels/judge/PROTOCOL-sheets.md` **v2.1**. v2.1 adds one
  clause, fixed before any cohort-8 card is judged: a division word plus its
  number alone on its line ("Section 2.") is `H`. The user decided this on
  2026-09-24, after the r13 tie-break adjudication showed judges splitting on
  it.
- **Seat 1:** `claude-opus-5-5`, effort medium, pinned by exact id.
- **Seat 2:** `claude-fable-5-1`, effort medium, pinned by exact id. Kimi is
  not a seat this time; it ran out of usage mid-seat last batch.
- **Tie-break:** on heading-bit disagreements, 3 blind runs of
  `claude-opus-5-5` at effort high, with the majority deciding. This is the
  adjudication procedure, which replaces last batch's single low-effort run.
- **What judges see:** no predictions, no other judges and no labels.
- **Label source:** `opus-fable-consensus+opus55-high-tiebreak`.
- **Training use:** cohort-8 labels are never training data until this result
  is recorded. Using them afterwards retires them as a test.

## Reported, not gating

- The R5b secondary view.
- Single-line vs multi-line strata.
- The colon-shape count.
- The rule-guard release counts: cards where each guard abstained, and their
  fate.
