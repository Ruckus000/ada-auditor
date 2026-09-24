# Cohort 8 look: r13 with the rule guards (results, 2026-09-24/25)

Counts only. **Registration:** `docs/superpowers/plans/2026-09-24-cohort8-look-registration.md`
(e52d1ad, committed before any document was run). **Model:** r13
(`out/overnight/12-train-r13/adapter-r13`) at t_r13 = 0.98081102556551. The code
path was the branch head at e52d1ad, which includes both rule guards. The test
split was not evaluated.

## Verdict: NOT MET (one look)

| Covered | TP | FP | TN | FN | Errors (max for pass) | Accuracy [exact 95 %] | FP UB | Clean docs |
|---|---|---|---|---|---|---|---|---|
| 8,953 | 297 | 38 | 8,523 | 95 | **133** (71) | 0.9851 [0.9824–0.9875] | 0.0061 | 64/103 |

- FP passes; accuracy does not.
- The spent-data estimate of r13 plus the guards (14 errors on 2,872 cards,
  0.49 %) did not hold on fresh documents. The fresh rate is 1.49 %.
- One document had no covered card, so 103 documents are counted.

## Model pass

- **Documents:** 104 of 104, 0 failures, 5.97 h.
- **Cards:** 10,989. Covered 8,953, of which 3,056 were decided by rule; asks
  2,036; split heads 54.
- **Guard 2** (text layer contradicted) released 22 cards.
- `out/suggest/cohort8-r13/summary.json`

## Labels

- **Seat 1:** `claude-opus-5-5`, effort medium. **Seat 2:** `claude-fable-5-1`,
  effort medium. Both covered 165 chunks and 8,953 boxes, with 0 missing,
  duplicate or unparsable rows. Protocol v2.1.
- **Heading-bit agreement:** 0.9917 (74 disagreements).
- **Tie-break:** 3 blind `claude-opus-5-5`-high runs per disagreement, with the
  majority deciding. 222 of 222 runs returned.
- **Unsure** counts as not-H, as in the r13 confirmation batch. Seat 1 used it 76
  times and seat 2 254 times.
- **Source:** `out/labels/cohort8-labels.jsonl`, label source
  `opus-fable-consensus+opus55-high-tiebreak`, 392 H.
- **The errors do not rest on disputed labels.** 116 of the 133 are on cards
  where both seats agree.

## Error anatomy (counts)

- **FN (95): 83 model, 12 rule.**
  - **Merged heading plus body (run-in headings):** 55 of the 95 FN are cards
    longer than 60 characters that the seats label H under "a heading merged
    with its first sentence is still H". Examples:
    - "1. Minimum Lot Size Requirements No minimum lot size…"
    - "C. Fillers and Pigments. The plastic…"
    - "PHYSICAL DEMANDS: The physical…"

    Most are in c8-0114, c8-0206, c8-0187 and c8-0107. The run-in split
    (`--split-run-in-heads`) stayed off, as registered.
  - **Short FN (40):** form-section labels (c8-0117, "OWNER", "JOB
    INFORMATION"), map legend titles decided by rule (c8-0132, c8-0044), and
    garbled scan text (c8-0220).
- **FP (38): all model.**
  - **23 are table row or column headers** labelled TH by both seats: town
    names in c8-0022 (19), fund names in c8-0265 (4).
  - The rest are scattered. 5 are enumerator-only fragments ("B. W", "D. “").
- **Concentration:** c8-0022 has 19 errors, c8-0187 12, c8-0114 11 and
  c8-0220 9. Together that is 51 of 133.

## Reported, not gating

- **R5b view** (labelled rows): 131 errors, LB 0.9827, FP UB 0.0058.
- **Invisible marks:** 344 of 10,989 cards (3.1 %) had no visible magenta mark
  in the image the model saw. 268 of them were covered. They are tiny boxes on
  large-format pages (c8-0034, c8-0004, c8-0077, c8-0132 …). This is a product
  finding, not a registered deviation, and it is filed as its own task.

## Deviations and disclosures

- **`labels/judge/page_sheets.py`** hard-coded `out/cohort3/real`. It now picks
  the cohort from the stem. The pixel check now skips cards whose mark vanished,
  and still requires 5 comparable documents.
  - One document failed the check by 0.05 px: c8-0005 at 3.05 px against a 3 px
    limit. It is the only page whose sheet is upscaled (×1.062).
  - Across 40 documents the others were all at 2.0 px.
  - To confirm the box encloses its text, I viewed that one card's crop
    (c8-0005:0, a title). I did not see its prediction.
- **Tie-break run numbering:** the journal kept no run labels, so runs were
  numbered in completion order. That order only breaks type ties; it never
  decides the heading bit.
- **Label types:** where the seats agree on the heading bit but not the type,
  the label's type is seat 1's. The gate reads only the heading bit.
- **`runs.tsv`** writes a literal `\t` between fields (zsh `print -r`). It is
  cosmetic.

## Consequences

- r13 plus the guards does not pass on fresh documents.
- The two largest error classes are run-in headings (55 FN) and table headers
  called H (23 FP). Both are shapes the loop has named before, and neither is
  covered by a registered fix.
- **Cohort 8 is now spent for the gate.** Its labels may become training or
  validation data. Doing so retires them as a test.
- The 244 remaining non-eligible or tagged cohort-8 PDFs are not part of any
  population.
