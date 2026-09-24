# r13 confirmation batch: results (2026-09-24)

Counts only; no document bytes in this record.

- **Registration:**
  `docs/superpowers/plans/2026-09-23-r13-confirmation-batch-registration.md`
  (5201683), amended before judging (ec944c8).
- **Label source:** `opus-kimi-fable-consensus` (see Labels).
- **Data:** label files are on the data-only branch `kimi-data-run-in-2026-09-21`
  under `experiments/qwen-role-decisions/out/labels/confirm-r13-judges/`.
- The test split was not evaluated.

**Verdict: NOT MET.** r13's pass on the 30 wild documents
(`heading-stage2-2026-09-23-merged-heading-results.md`) does not hold on 40
fresh, host-disjoint documents. This was the batch's only look.

## The look

The batch is r13 at t_r13 = 0.98081102556551, on 40 unused census documents
whose hosts are disjoint from the wild set: 3,763 cards, with product-path
settings `--all-blocks --split-enumerated-heads`.

| | Covered | TP | FP | TN | FN | Errors (allowed) | Accuracy [95 % exact] | FP UB | Clean docs | |
|---|---|---|---|---|---|---|---|---|---|---|
| Wild, 30 docs (already seen) | 2,337 | 97 | 6 | 2,229 | 5 | 11 (15) | 0.9953 [0.9916–0.9976] | 0.0058 | 21/30 | pass |
| **Confirmation, 40 fresh docs** | **2,913** | **74** | **15** | **2,804** | **20** | **35 (18)** | **0.9880 [0.9833–0.9916]** | **0.0088** | **29/40** | **NOT MET** |

- The FP bound passes. The accuracy bound misses by 17 errors.
- **Uncovered cards:** 850 of 3,763. The sidecars' own `asked` count is 924,
  under the product's ask policy.
- **The pre-registered 31-document extension does not trigger.** It needed an
  LB in [0.987, 0.99), and the LB is 0.9833.

## Error anatomy

**Rules: 16 errors, all FN at score 1.0, which can never become asks.**

- **Definition rule 2, `rules.artifact_by_repeat`: 11.** A repeated title in
  the margin band is taken for a running header.
  - c3-0088:61, :105, :113, :152, :183: a map-series legend title, 15 pt
    bold, on 5 pages
  - c3-0850:154, :162, :171, :180, :189, :198: the title of each form in a
    packet
- **Definition rule 3, `rules.r2_no_letters`: 5.** Title words whose text layer
  is garbled have no letters, so the rule calls them `Lbl`.
  - c3-0327:2: a broken encoding; the page reads "NORTH" and the text reads
    "552,579"
  - c3-0217:23, :63, :64: a typewritten scan, with text `..`, `-` and `.`
  - c3-0331:59: text "2007-34"

  For c3-0327:2 and c3-0217:23, the page image and the card text were compared
  by eye.

**Model: 19 errors.**

- **15 FP.**
  - 12 were decided by the tie-break: c3-0103 ×7, c3-0309 ×2, c3-0684:16 and
    :84, and c3-0721:72.
  - 3 had both seats agreeing: c3-0004:13 and :14, and c3-0327:182.
- **4 FN:** c3-0088:14 and :15, c3-0331:141, c3-0365:14.

**The tie-break concern (open, not adjudicated).**
- 11 of the tie-break FP are an enumerator plus heading words on one short
  line: "IV. Public Comments", "V. Conclusion", "Section 2.".
- `labels/judge/PROTOCOL-sheets.md` says such a card is `H`. Seat 2 said H,
  seat 1 said non-H, and the Opus 5.5-low tie-break said P or Lbl.
- If those 11 are the tie-break's errors, the confirmation errors are 24, not
  35. That is **still NOT MET** (18 allowed). The labels are reported as judged.

## Reported, not gating

**Strata.** Multi-line is defined here as box height above 1.8 × `font_pt`.
This is not the 2026-09-23 record's probe-set definition; the batch has no
merged probe.

| | Rows | Covered | FP | FN | Acc LB | FP UB |
|---|---|---|---|---|---|---|
| Single | 2,183 | 2,183 | 13 | 14 | 0.9821 | 0.0105 |
| Multi-line | 726 | 726 | 1 | 6 | 0.9802 | 0.0078 |
| Split head | 3 | 3 | 1 | 0 | n/a | n/a |
| Split body | 1 | 1 | 0 | 0 | n/a | n/a |

**Other views:**
- **R5b view:** 0 covered model-decided cards match R5b and not R5, so the view
  equals the primary: 35 errors.
- **Colon-label shape** (`^\S.{0,30}:$`): 25 covered, 0 errors.

## Labels

- **Seat 1:** Claude Opus 5.5 at medium effort, on page sheets. All 54 chunks,
  2,913 boxes. Every agent read every one of its sheets, verified from its
  transcript.
- **Seat 2:**
  - Kimi K3 did chunks 00–40 except 29, from the blind pack branch
    `kimi-judge-pack-confirm-r13-2026-09-23`.
  - Kimi wrote each chunk's `done` line into the file; it was stripped before
    use.
  - Kimi's chunk-29 built card ids from sheet names and was discarded.
  - Kimi ran out of usage after chunk-40.
  - Claude Fable 5.1 did chunks 29 and 41–53 (789 boxes), under the same
    protocol, with verbatim ids and the instruction to trust the image over
    the text.
  - Seat 2 is therefore split: Kimi 40 chunks, Fable 14.
- **Tie-break:** Claude Opus 5.5 at low effort, card by card, on the 28
  heading-bit disagreements (11 H, 17 not).
- **Agreement:** the heading bit agrees on 2,885 of 2,913 cards (0.9904). The
  full type agrees on 0.783; the gap is mostly P against Other.
- **H counts:** seat 1 has 85, seat 2 has 109, and the consensus has 94.
- Every judge was pinned to an exact model id (see the disclosures).

## Disclosures

- **One prediction was seen before the look.** While checking a Qwen probe's
  report that c3-0327:2's box shows "NORTH" but its text reads "552,579", its
  sidecar row (rule-decided `Lbl`, score 1.0) was read. That was 1 of 2,913.
- **The R5b key check read test-split text.** The scan read the text, not the
  labels, of every card in the local `out/keys-all-9/cards.jsonl`, including
  45 matching test-split cards. Nothing from them is used.
- **Two agents ran on Qwen, not Claude.** In this environment the
  `opus`/`sonnet`/`haiku` aliases route to `qwen3.8-max`, `qwen3.8-flash` and
  `qwen3.6-flash`. Two agents requested as `opus` therefore ran on
  `qwen3.8-max`:
  - the diagnosis of r13's 6 wild FP, cited in the 2026-09-23 notes
  - the confirmation model run, which only executed commands

  All judging used exact ids: `claude-opus-5-5`, `claude-fable-5-1`.

## What this changes

The next lever is the rules, not training.
- They made 16 of the 35 errors.
- Decided at 1.0, they cannot abstain.
- Those errors are title-shaped cards: a repeated per-page title, or a title
  with a broken text layer.

Fixes derived from this batch are post-hoc, so a pass claim needs new
documents. The census pool is exhausted apart from the 31 same-host
documents, and those were only a conditional extension.
