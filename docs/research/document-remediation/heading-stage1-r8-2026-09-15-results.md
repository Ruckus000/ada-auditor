# Heading-type adapter — Stage 1 round 8: r7 graded on its own audited errors, and three §4 rule-3 rules

> **Graded against Claude-audited labels** (Ruling R9). Judgements come from the reviewing Claude session, not a human relabel.

**Previous record:** `heading-stage1-r7-2026-09-15-results.md`. **Adapter:** r7 (unchanged in this round; no training). **Ledger:** `.superpowers/sdd/2026-09-13-stage1-round1/progress.md`.

## audit-r8: r7's own error rows, judged blind
216 validation cards, no prediction shown, deduped against every earlier audit. 3 rows are Unsure (the marked box held a stray glyph that did not match the card text) and are excluded from scoring. None is a train or test id.

| Group | Cards | Scored | Real headings | The rest |
|---|---|---|---|---|
| Every FP (77 of 83; 6 already audited) | 77 | 74 | **57 (0.77)** | P 8, Caption 3, Other 3, TOCI 3 |
| Every model-decided FN (39 of 70) | 39 | 39 | **17 (0.44)** | P 14, Caption 7, Other 1 |
| TP sample, document-capped | 60 | 60 | 58 | P 1, Caption 1 → **2/60** |
| TN sample, document-capped | 40 | 40 | **6 (6/40)** | P 19, Other 7, Lbl 4, TH 3, Artifact 1 |

- Three quarters of r7's "false positives" are headings the author never tagged. The real quarter is mostly three shapes: list-item bodies, contents entries, and figure or table titles.
- Of the headings r7 missed, more than half were not headings — the key over-called them and r7 was right.
- The TP and TN rates land where r4a's did (2/60 against 4/100; 6/40 against 13/99), so the calibration is now **r7-measured** rather than borrowed.

`out/keys-all-4/labels-audited-r8.jsonl` applies 213 of the 216 (sha in `split/labels-audited-r8.json`).

## Evaluation on labels-audited-r8

| Population | Run | Direct accuracy | Direct FP | Direct FN | Estimated accuracy | Estimated FP | Estimated FN |
|---|---|---|---|---|---|---|---|
| ∩ 273 | r5 | 0.773 | 0.006 | 0.540 | 0.701 | 0.015 | 0.610 |
| ∩ 273 | r7 | 0.949 | 0.050 | 0.053 | 0.874 | 0.069 | 0.189 |
| Cohort 6 validation | r5 | 0.867 | 0.006 | 0.360 | 0.784 | 0.013 | 0.481 |
| Cohort 6 validation | r7 | 0.946 | 0.025 | 0.107 | 0.861 | 0.037 | 0.274 |
| All validation | r5 | 0.850 | 0.006 | 0.396 | 0.769 | 0.014 | 0.506 |
| All validation | r7 | 0.946 | 0.029 | 0.096 | 0.863 | 0.042 | 0.258 |

"Estimated" applies r8's own rates (TP 2/60, TN 6/40) to rows **no audit has touched**. The controller recomputed every figure.

**The comparison is one-sided, and only the estimated column may be quoted outside this record.** audit-r8 audited r7's error rows exhaustively and nothing of r5's, so r7's direct figures absorb every label error in its own mistakes while r5's do not. **r7 direct 0.946 is not comparable to r5 direct 0.850.** A symmetric audit of r5's un-audited error rows (~200 more cards) would make the pair comparable; it was not queued, because r5 is not a shipping candidate and the estimated column already answers the question the round asks. Quote **0.863 against 0.769, FN 0.258 against 0.506, FP 0.042 against 0.014**, each tagged "graded against Claude-audited labels; r7's error rows audited exhaustively, r5's not".

## Label source is not the lever
Audited disagreement over all four audits: stripped-tree 185/516 (0.36), word-outline 60/186 (0.32). Word keys are no cleaner on the disagreement rows, so changing key source does not fix under-tagging.

## Registered before implementation: three rules from §4 rule 3 (a more specific ISO type wins)
Deterministic, definition-derived, no model involvement. Each is a **type assignment in front of the model**, like the existing repeats and no-letters rules.

1. **TOCI.** The text ends with a page number preceded by dot leaders: at least three dots (optionally spaced), then optional whitespace, then 1–4 digits at end of text.
2. **Caption.** The text begins with `Table`, `Figure`, `Chart` or `Exhibit`, then a number (optionally with a letter suffix), then a colon, period, dash or en/em dash.
3. **List-item body.** Another card on the same page sits on the same line (its y0 within 2 pt of this card's) and to the left (its x1 ≤ this card's x0), and that card has no alphabetic characters — a bullet or number. The row is then list text, type Other, not a heading.

**Registered prediction.** On the fixed validation population, with r7 unchanged:
- Each rule's hits are reported, together with **hits that audit says are headings** (the harm) and the net change in FP and FN on the estimated column.
- Expected direction: FP falls by roughly the 9 audited rows of these three shapes (3 TOCI + 3 Caption + 3 list items among r7's FPs), with harm near zero if the patterns are as specific as they look.
- A rule whose harm exceeds its benefit on the audited rows is reverted and reported, not kept.

Only rows whose rule decision changes are re-predicted; everything else keeps r7's prediction.

## Results — the three rules (commit 4caa7cb, 115 tests pass)

**The registered prediction did not land.** The rules were expected to remove roughly the 9 audited false positives of these three shapes; they reach **one** of them.

- **Cards:** `out/keys-all-4/cards-r8.jsonl` adds `after_inline_label` to all 10,901 cards; 121 are True.
- **Changed rows:** 9 of 1,525, all previously model-decided. The other 1,516 predictions are byte-identical to r7's.

| Rule | Hits | Audited hits | Audited as H (harm) | Audited as the rule claims | Δ FP | Δ FN | Verdict |
|---|---|---|---|---|---|---|---|
| TOCI | 3 | 0 | 0 | — | 0 | 0 | keep, inert |
| Caption | 4 | 2 | 0 | 2 Caption | −2 | +2 | keep, provisional |
| List-item body | 2 | 1 | 0 | 1 Other | 0 | 0 | keep, inert |

No rule harms an audited heading, so none is reverted.

**Effect on the whole set: a wash.** All 1,525 rows, graded against Claude-audited labels: accuracy 0.9462 direct and 0.863 estimated, unchanged to four decimals. FP falls by 2 rows and FN rises by 2.

### Why the rules miss the rows they were written for
- The audited TOCI rows have **no dot leaders**, so the pattern never fires on them.
- The audited captions are **unnumbered**, so "Table" plus a number never matches.
- The audited list rows carry the bullet **fused into the card's own text** (a private-use glyph), not as a separate card to the left, so the neighbour test cannot see it.
- The list rule is also under-fed by construction: `cards-r8` enriches `cards-r5`, which holds only labelled cards, so unlabelled bullets are invisible as neighbours. `key_context` computes the fact over every card in a document, so a rebuilt cards file would set it on more rows.

### The one measurable effect is a label contradiction, not a model change
All four Caption hits are in `c6-0102`:
- `:161` and `:248` were audited as Caption, so the rule scores −2 FP;
- `:131` and `:212` have the same shape but are un-audited key H, so the same rule scores +2 FN.

The graded labels disagree with themselves on four rows of one shape in one document. **Those two ids are the next audit rows**, and the Caption rule's verdict stays provisional until they are judged.

### Reading
Three deterministic rules written from the audit's own error shapes changed 9 rows and moved no metric. The remaining error mass is not reachable by surface patterns of this kind: it is under-tagged headings in the keys (about 138 estimated hidden headings in the TN pool) and shapes whose cues are inside the card text rather than in its neighbours or its form.

## Stop decision
*(round 8's options go to the user; this session does not choose a retrain)*
