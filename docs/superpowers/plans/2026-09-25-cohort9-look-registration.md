# Cohort 9: one look (registration, 2026-09-25, before any document is run and before r14 is scored)

**Why.** Cohort 8 is spent: it was looked at, and it is now training and
validation data for r14. Cohort 9 is the next fresh, host-disjoint test.
**One look.**

## Population (fixed now; no re-draw, no extension)

- **Pool:** every cohort-9 document that is untagged, with
  1 ≤ blocks_total ≤ 600, from `out/cohort9/_census/census.json`.
  - That is **73 documents, 55 hosts, 6,927 blocks**.
- **Sourcing:** mechanical, with cohort 8's method verbatim
  (`out/cohort9/sweep-rules.txt`, written before any fetch).
  - Candidates were lines [3500, 5000) of the CISA City/County .gov list.
  - The exclusion set is 598 hosts: every earlier cohort, plus every cohort-8
    host.
  - 0 host collisions, and 0 sha256 overlaps with cohort 8.
  - 251 PDFs from 108 hosts.
- **The whole pool is the sample.**
- **Run order:** `random.Random(20260925).shuffle(sorted ids)`.
- **Failures:** a document the tagger can't process is recorded and not
  replaced.
- `out/suggest/cohort9-look/population.json` is written now.

**Projection:** about 5,640 covered cards, using cohort 8's 0.815 covered per
block. At that size the gate allows about 41 errors.
- P(pass) is 0.90 at a 0.6 % error rate, 0.30 at 0.8 %, 0.02 at 1.0 %, and ≈ 0
  at cohort 8's r13 rate of 1.49 %.

## Model (decided by a rule fixed before r14 is scored)

The candidate rule is from `2026-09-25-r14-registration.md`, step 3. r14 at
t_r14 is used if **both** hold:
1. it meets the r13 guard on keys validation
2. it makes fewer cohort-8 validation errors than r13 at t_r13

Otherwise r13 at t_r13 is used. The choice and both sets of numbers are written
here as an amendment before the first cohort-9 document runs.

**Product flags:** `--all-blocks --split-enumerated-heads`. The run-in split is
off; it was not adopted in r14 step 2. The code is the branch head at the
amendment commit, with no `labels/` change after it.

## Gate, labels, reporting (as cohort 8)

- **Gate:** accuracy exact 95 % LB ≥ 0.99 and FP UB ≤ 0.01, on covered cards.
- **Labels:** every covered card is judged blind on page sheets under protocol
  v2.1.
  - Seat 1 is `claude-opus-5-5` medium; seat 2 is `claude-fable-5-1` medium.
  - The tie-break is 3 blind `claude-opus-5-5`-high runs, with the majority
    deciding. Unsure counts as not-H.
- **Reported, not gating:** the R5b view, errors by decider and resolution, and
  the invisible-mark count.
- **Training use:** cohort-9 labels are never training data until this result
  is recorded.
