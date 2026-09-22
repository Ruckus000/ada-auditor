# Merged-heading strategies — 2026-09-22 (Step 0 registration, before any run)

Problem. 17 of the wild gate's 21 covered errors are merged heading+body blocks
(heading recall 2/19 on the affected boxes). Single blocks already pass: 1,472
covered, 4 errors, LB 0.9931. Judges call merged blocks H; training keys call
them non-H (keys-all-9 train: 49 vs 11; the 11 are long headings, not merged
bodies). r10 learned the key convention: p_H <= 0.006 on every miss. The fix
must reconcile the convention, not the threshold.

Gate to beat (run-in fold + R5, end-to-end, t = 0.9933): 2,543 covered,
accuracy 0.9917 [0.9874-0.9949], 0 FP (UB 0.0015), 21 FN, NOT MET (15 errors
allowed). Pass = accuracy exact-95% LB >= 0.99 and FP exact-95% UB <= 0.01.

## Dev set (built from keys only; struct-tree truth; never wild; test split never read)

- Universe: fresh Cards.java dumps of all 352 keys-tagged PDFs (locators match
  keys-all-9 card ids `<doc>:<block-index>`; blocks_to_cards drops
  first_line/line_count, so the dumps are the source). Segmentation verified
  stable: for a sampled document all 128 card locators match the fresh dump
  with identical text.
- Positive: multi-line block (line_count >= 2) with >= 3 body words whose first
  line normalizes (run.text_norm) to a key heading of the same document
  (match: same norm, prefer block's page, then nearest y0, then reading order),
  in train AND validation.
- Negative: every other multi-line block (line_count >= 2, >= 3 body words) in
  VALIDATION only; seeded sample (seed 20260922) capped at 600. Train
  negatives are excluded (counted, not used) — the wild gate scores
  validation-like unseen docs, so false-trigger is measured there.
- Wild-gate documents (docs with sidecars under out/suggest/*/*/) are excluded
  from the dev set entirely.
- Fewer than 30 positives: stop and record it. (Met: 1,299.)
- Disclosure: most positives are train rows r10 learned as non-H (or never
  saw — see strategy C), so dev recall is conservative for any strategy that
  keeps r10's convention.

### Dev set record (build: labels.merged_probe dev, --no-images locally)

- documents 223; blocks scanned 103,047
- positives: train 1,152, validation 147 (total 1,299)
- negatives: pool 2,763 (validation), kept 600 (seed 20260922)
- excluded: containers 5,484; fewer-than-3-body-words 3,984; train negatives
  17,147; wild docs 0
- probe cards 1,899; block cards (strategy C) 1,152
- dev-set sha256: 336caf8366d2d4213de5d42a527731d9f39bfa73967b175683a8104236d74c6c
- The runner's imaged build (request 01) must reproduce this sha exactly; a
  mismatch stops strategies A and C.

## Strategies

### A — probe-and-ask (Kimi + runner)

Score r10 on each multi-line block's first line as its own card (probe id =
`<locator>mh`, split_heads head construction: text = first line, y1 = y0 +
1.3em, next = body text, prev/facts from the block's context card; rules in
front; own-stack per doc in reading order, dev and wild probed identically).
A block abstains when its probe was model-decided at p_H >= tau_A.

- tau_A rule: candidates = distinct non-null probe p_H over all dev rows;
  tau_A = the smallest candidate with negative-trigger share <= 0.02 of dev
  negatives. None if unmeetable -> strategy spent.
- Dev recall = positives at/above tau_A / positives. Wild look only if dev
  recall >= 0.5.
- Wild look (exactly one): probe all multi-line wild blocks, recompute the
  gate with labels/judge/refold.sh plus the abstention applied to the fold's
  predictions on the existing labels — no judging. The baseline 2,543 / 0 FP /
  21 FN is reproduced first; a mismatch stops the strategy.

### B — probe-and-split (from A's dev scores)

tau_B = the smallest candidate with dev split precision (positives fired / all
fired) >= 0.9. Dev precision/recall reported only; a gate look is the user's
call, not tonight's.

### C — convention fix in training (runner), amended after the dev build

Registered mechanism (labels.merged_overlay): overlay keys-all-9 with the
train positives as H at the matched key level, change nothing else.

Finding that shapes the overlay (dev build 336caf83): of 1,152 train positives
only 7 have a keys-all-9 label row at all (6 non-H, 1 already H). The other
1,145 merged blocks never became cards — a merged block's norm contains the
key heading's norm, so it fell out of the key matcher's candidate pool
(match.py's contains tier needs card norm inside key norm; the box tier
labels some P and drops the rest). The earlier "49 vs 11" counted the
card-level subset from a different definition. Relabelling alone would change
6 rows and teach the model nothing, so the overlay does both:

- relabel: the 6 non-H rows become H at the matched key level, old row under
  `superseded`;
- append: each of the 1,145 no-row positives gets its whole-block card
  (merged_probe block-cards.jsonl: the keys-card schema, whole text, whole
  box, the following block as next — the card the wild pipeline scores)
  appended to cards.jsonl, plus a new H label row (label_source
  key-merged-first-line, actor key:merged-first-line, fixed labelled_at
  2026-09-22T00:00:00+00:00); split.json is copied with the appended ids added
  to ids.train so emit_sft admits them. Validation positives are never
  touched; key-headings.json is byte-identical; no original row is removed or
  edited beyond the 6 relabels.

Effective training rows: of the 1,145 appended, 712 sit in c5-prefixed
documents and drop out under the recipe's --exclude-doc-prefix c5, leaving
433 appended + 6 relabelled convention rows (0 rule-decided). Local emit with
the r10 recipe (images patched non-null; the Mac build carries real marked
images) gives N = 5,572 rows vs r10's 4,942; training iters = 2N from the
RUNNER's emit manifest (request 04), verified against this number — a
mismatch stops C.

Then: train with the registered command (exact r10 recipe, dataset/output/
iters only), 16h gate at the step-100 projection. Threshold re-derived on
validation by the r11 rule (lowest score threshold with covered-accuracy
exact 95% LB >= 0.98 and FP exact 95% UB <= 0.02) against labels-audited-r10
(out/keys-all-4/labels-audited-r10.jsonl on the Mac), guarded: validation
covered-accuracy LB and FP UB no worse than r10's
(out/stage1/operating-point-r10.json). One wild look = full re-prediction on
the same wild cards and labels; no judging; evaluated locally at t_r13.

Queued right after A's dev probe so the Mac is never idle: requests 01 (imaged
dev build) -> 02 (probe scoring) -> 03 (overlay) -> 04 (emit) land together;
05 (train), 06 (validation scoring), 07 (operating point), 08 (wild scoring)
follow the moment 04's manifest reports N.

### D — rule-only detector (Kimi, fully local)

First-line predicates, no model: D1 short first line (head word count <= 6,
split_heads MAX_HEAD_WORDS); D2 no closing sentence punctuation [.;:]
(split_heads' gate); D3 = same_line_probe.lead_boundary exactly (expected weak
on multi-line blocks — disclosed); D4 = ENUM_HEAD numbering. Fire = D1 AND D2
AND (D3 OR D4). Same dev set, same 2.0 % false-trigger cap on negatives;
marginals reported; no post-hoc fitting past the cap. No wild look is
registered for D; it is a dev-side bound on what rules alone can do.

### E — rejected options

- E1 Threshold retune on r10: the 17 merged errors are convention misses at
  p_H <= 0.006; no threshold recovers them without eating the 1,472-block
  passing margin. Rejected: cannot address the cause.
- E2 Judge the merged blocks on wild to flip labels: the brief forbids
  judging tonight; labels are the gate's ground truth and the 20/30 clean
  docs would be re-exposed. Rejected: out of bounds and moves the target.
- E3 Split every multi-line block unconditionally (rule, no probe): the dev
  negatives are exactly the blocks this would shred (lists, wrapped
  paragraphs); the 2 % cap exists because that failure mode is real. Folded
  into D as the gated D1-D4 version. Rejected standalone.
- E4 Train on synthetic merged blocks (paste headings onto bodies): no
  renderer tonight that preserves the keys' typography; unverifiable without
  judging. Rejected: unverifiable inside the protocol.
- E5 Same-line probe (probe the block's own first line in place, same card
  id): probed earlier today — Step 0 review concluded DO NOT BUILD (d1833cc):
  in-place probing changes the row the gate scores and double-counts the
  block. Superseded by A's separate-card probe.

## Winner rule

Among strategies whose single registered wild-gate look passes (accuracy LB
>= 0.99 and FP UB <= 0.01): lowest added ask-rate (abstentions / covered).
C beats A on a tie (a fixed convention needs no runtime probe). If none
passes, report the best with numbers and record every other strategy as spent.

## Verification

Every table is recomputed from pushed outputs (fold files, prediction files,
operating-point JSONs) before it is cited; a mismatch stops that strategy.
Every number names its label source (keys struct-tree for dev; the run-in
fold labels for wild looks). Counts only; code and records on the code branch
only; no data files committed, no judging, no threshold fitted on wild.
