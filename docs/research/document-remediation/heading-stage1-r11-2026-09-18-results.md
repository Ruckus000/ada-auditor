# Heading-type adapter — Stage 1 round 11: the under-title fact, and the operating threshold

> **Graded against Claude-audited labels** (`labels-audited-r10`). Audited rows come from the reviewing Claude session, not a human relabel.

**Plan (the registration):** `docs/superpowers/plans/2026-09-18-stage1-round11.md`, copied unchanged from the coordinator worktree and committed at 6b339fc before any work. **Candidate:** r10. **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md`.

## Task 1 — `after_h1`: built, measured, **not trained**
Round 10's only systematic genuine false positive is the line directly under a title. The registered fix was one prompt fact: `after_h1: yes|no`, taken from the key ladder in training and from the model's own prior H1 decision at inference.

- **Built and tested** (commit 72192bc, 123 label tests pass). `sft-r11` is 4,942 rows, sha `75331371…`, and differs from `sft-r10` **only** by the new fact line: 0 rows differ in any other way, 0 image and 0 target differences. The leak check is clean.
- **`predict.py` now walks rows in reading order**, so an r11 prediction file must be joined to r10's on `id`, not by line number.

**Why it was not trained.** The registered decision rule (reviewing session, before the measurement) was: train only if the fact marks **≥ 5 of the 8** audited genuine under-title false positives, **and** the H share of fact-firing train rows is **≤ 0.6**.

| Fact variant | Train rows firing | H share | Validation firing | Marks the 8 genuine FPs | Marks audited real-H rows the model called H (of 79) |
|---|---|---|---|---|---|
| `after_h1` — ladder, level 1 | 466 | 0.543 | 94 | **1 / 8** | 4 |
| `after_heading` — ladder, any level | 1,411 | 0.534 | 329 | **1 / 8** | 17 |
| Inference mechanism — previous card the model called H | — | — | 141 | 5 / 8 | 19 |

Both ladder variants fail the ≥ 5 condition, so **Task 1 closes as "not trained: the fact does not mark the shape"**, and no 14 h run was spent.

**Why the ladder misses it.** Of r10's 8 audited genuine false positives, only 2 have a key H1 directly above; 5 have a line above that **r10 itself** called a heading while the key calls it P or Other; 1 has nothing above it. The title above an under-title line is usually not tagged as a heading in the key — the same under-tagging that made three quarters of r10's false positives real headings. The fact the model could use exists only at inference, where it would have no matching training signal.

**Counting note.** The reviewing session's pre-measurement was 528 firing train cards (H 275, P 181, Other 50, other 22); this round's measurement is **466** (H 253, P 145, Other 50, Lbl 10, TOCI 4, TH 3, Caption 1). This definition — same-page previous card by y0, over `keys-all-9` train rows with c5 excluded — is the registered one.

## Task 2 — the operating threshold for r10 (`out/stage1/operating-point-r10.json`)
**Rule, registered:** the lowest score threshold at which the covered subset's exact 95 % accuracy lower bound is ≥ 0.98 **and** the FP upper bound is ≤ 0.02, on `labels-audited-r10`.

**Result: threshold 0.9933.**

| | At the operating point |
|---|---|
| Coverage | **0.749** (1,142 of 1,525) |
| TP/FP/TN/FN | 359 / 3 / 770 / 10 |
| Accuracy | **0.9886** [0.9806–0.9939] |
| FP rate | **0.0039** [0.0008–0.0113] |
| FN rate | 0.0271 |
| Documents with zero covered errors | **52 of 59** |
| Documents fully covered with zero errors | **0 of 59** |

- **Abstained: 383 rows** — H 219, P 117, Other 28, Caption 8, TOCI 5, TH 4, Artifact 2; 203 bold and 180 regular; the H are L1 52, L2 86, L3 69, L4 12.
- At the lower thresholds the rule fails: at 0.99 the accuracy lower bound is 0.9783, below 0.98.
- **Every document has at least one abstained row**, so no document is delivered end-to-end without a person looking at something. 52 of 59 have no *error* among the rows the model does answer.

## Stop decision — (b): r10 stays the candidate, and the operating point is registered
- The fact was not trained, so the false-positive shape is unchanged.
- **The operating point is 0.9933 → 74.9 % coverage at 0.989 accuracy [0.981–0.994] and 0.4 % FP [0.08–1.1 %].**
- **The Stage 2 gate is still not met.** It asks for accuracy ≥ 99 % with a lower bound ≥ 99 %, FP ≤ 1 % with an upper bound ≤ 1 %, and abstention ≤ 10 %. At this operating point the accuracy lower bound is 0.981 (needs 0.99), the FP upper bound is 0.0113 (needs 0.01) and abstention is 25.1 % (needs ≤ 10 %). The point estimates clear the accuracy and FP bars; the bounds and the abstention rate do not.
- **Test was not evaluated**, and `test.spent` does not exist.

---

*Round 12 (a third epoch resumed from adapter-r10, aimed at the abstention rate) is registered in `docs/superpowers/plans/2026-09-18-stage1-round12.md` and recorded in `heading-stage1-r12-2026-09-18-results.md`.*
