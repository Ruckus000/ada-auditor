# Registration: blind re-judge of the 48 errors and 92 matched comparators (2026-10-09)

Written and committed before any judge runs. The user approved the spend (about 5.4M in the shadow
budget's unit, `heading-cpu-probes-2026-10-09.md` §2) and chose Opus and Fable seats.

## Sample

`out/cpu-probes-2026-10-09/audit-design.json`, seed 20261009. The sample is all 48 errors at the
certification threshold (0.9940428) plus 92 correct decided cards drawn from the same documents, with
the same predicted heading bit and the same decider, 140 cards in all. The judges see one list. Nothing
in a chunk says which cards are errors, and no prediction, score or label appears.

## Mechanics (the shadow registration's frozen protocol)

- **Sheets:** `labels/judge/page_sheets.py` (r14 branch, run read-only with `-B`), max 12 boxes per
  sheet, 6 sheets per chunk. Output goes to `out/cpu-probes-2026-10-09/rejudge/`.
- **Seats:** `PROTOCOL-sheets.md` verbatim (sha256 prefix c1b05cf5104d).
  - seat 1 is `heading-judge-medium` (claude-opus-5-5, medium);
  - seat 2 is `heading-judge-fable` (claude-fable-5-1, medium).
- **Tie-break:** applies wherever the seats split on the heading bit (Unsure counts as not-H, and a
  missing answer counts as a split). It is 3 blind runs on the generic agent at claude-opus-5-5 high,
  using the panel-sft tie-break prompt and `labels/panel-sft/tiebreak-rules.txt` (sha256 prefix
  4d9b7979277e). The majority on the heading bit decides.
- **Disclosed deviation:** the runs go through the plain Agent tool, not a Workflow script. The model
  of every run is checked against the pinned id from `message.model` in its transcript. A run on any
  other model is discarded and rerun. A seat file counts only if its run ended with the
  `done <chunk> <count>` line, and partial files are deleted, never merged.

## Read

Each card gets a new heading bit.

- **Error flip:** one of the 48 whose new label agrees with the combination's prediction.
- **Comparator flip:** one of the 92 whose new label disagrees with the prediction.
- Reported with both rates, the two-sided Fisher exact p, and splits by mechanism and by the old
  resolution (seats agreed or tie-break).

**Interpretation, fixed now:**
- If the error flip rate is not significantly above the comparator flip rate (p ≥ 0.05), the labels
  on the 48 are as reliable as their neighbours', and the 48 stand as model errors.
- If it is significantly above (p < 0.05), panel noise is concentrated on the errors. The genuine
  model-error count is then estimated as 48 minus the error flips, with the comparator flip rate as
  the noise floor.

Either way, **no label file changes and no gate number is re-stated.** Re-labelling only these cards
would be asymmetric. A label correction would need the same re-judge over every decided card, which
is a separate decision.
