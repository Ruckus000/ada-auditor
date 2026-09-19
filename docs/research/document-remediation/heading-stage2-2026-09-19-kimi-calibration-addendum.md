# Addendum — 2026-09-19: Kimi K3 judge calibration; judging halted by user decision

Status: **judging stopped before round-3 completion. No labels were merged. The gate numbers are unchanged from the section above.** This addendum records what ran, so the finished judge files on disk are interpretable as provenance.

## Kimi K3 as a judge candidate

Kimi K3 (this session, Kimi Code subagents, blind, one fresh context per chunk) was calibrated against the 4-judge Claude-consensus rows of `out/labels/s2wild-r3-consensus.jsonl` (`votes.judges == 4`), per the runbook §3 scoring script, over three chunks:

| Chunk | Heading-bit agreement | n |
|---|---|---|
| calib-00 (judged earlier in a web chat) | 0.9672 | 61 |
| chunk-01 | 0.9828 | 58 |
| chunk-02 | 0.9825 | 57 |
| **Total** | **0.9773** | **176** |

(n = 176 of 186: ten cards had no 4-judge consensus row or an `Unsure` vote. Graded against consensus labels, judges: Claude ×4 for the reference rows, Kimi K3 as the candidate.)

Registered rule applied to the total: ≥ 0.99 full seat; 0.973–0.99 tie-break seat only; < 0.973 not used. **0.9773 → tie-break tier.** A seating amendment was registered (Opus seat 1 external, Kimi seat 2, Fable tie-break) and Kimi began seat-2 judging, but no seat-2 file was ever merged into a consensus.

## What exists on disk (provenance, all unused by any consensus)

- Finished: `out/labels/s2wild-judges-r3/calib/kimi-k3/{calib-00,chunk-01,chunk-02}.jsonl` (62 + 62 + 62); `out-conflict/seat2/chunk-00.jsonl` (20/20, `done` line received — all 20 judged `Lbl`, consistent with the v2 enumerator convention); `out-remaining/seat2/chunk-09.jsonl` (8/8, `done` line received).
- Deleted per the never-merge-unfinished rule: `out-remaining/seat2/chunk-01.jsonl` (12/62), `chunk-02.jsonl` (8/62), `chunk-07.jsonl` (7/62) — partial files from quota-killed runs, never finished.

## The 20 convention-conflict cards

Judged by Kimi K3 seat 2 **only**. With no seat-1 file there is no two-vote consensus, so **the re-judge was not merged and the v1 labels stand** in `out/labels/s2wild-consensus-v2.jsonl`. `v2_patch.py` was never run.

## Gate status — unchanged

No new labels entered any consensus file, so the gate stands exactly as recorded above (graded against consensus labels, judges: Claude ×4):

- Rounds 2+3 at t = 0.9933: accuracy 0.9903, **lower bound 0.9848 — 0.0052 under the 0.99 bar**; FP 0 (upper bound 0.0020, passes); abstention 0.142 (ask-rate).
- 566 covered round-3 cards remain unjudged; the 114 uncovered cards remain unlabelled by design.
- Round-3 completion per runbook §5, and the §7 levers, were **not** run: the user halted all judge runs.

## Why it stopped

Judge runs are image-bound (≈62 page images per 62-card chunk) and exhausted this session's metered quota after three chunk-runs. The user ruled: stop all judging, keep finished files as provenance, delete unfinished ones, record the current numbers, and stop. Any resumption starts from the runbook's §3 seating with an externally-run full seat; Kimi K3's registered role on this evidence is tie-break only.
