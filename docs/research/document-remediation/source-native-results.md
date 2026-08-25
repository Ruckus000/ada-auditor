# Brief C — Does the source→PDF export ever assert?

**Brief:** [`briefs/source-native.md`](briefs/source-native.md) ·
**Protocol:** [`briefs/README.md`](briefs/README.md) · **Timebox:** one session.
**Date:** 2026-08-25.

**The one question:** does exporting a native word-processor source to PDF ever
claim something the source did not state? Not whether the output is good —
whether the export **invents**, or only **copies and omits**.

Everything below the prediction was written after the runs. The prediction was
committed before the first measurement.

---

## Registered prediction

*Committed before the first measurement. Reproduced verbatim from the brief.
Not edited afterwards.*

### Part 1

1. `[H]` **Outline levels 1–6 all survive** as `/H1`–`/H6`.
2. `[H]` **The `no headings` probe produces zero `/H*`.** The exporter does not
   infer headings from formatting.
3. `[H]` **Row-label cells are never emitted as `/TH`.** Row headers have no
   representation in ODF, so this is an omission the format makes structural.
4. `[H]` **A decorative-marked image becomes an artifact, not a `/Figure`.**
   **This is the 7-assertion class Brief A left untested and I predict it
   resolves at source.** It is the single most valuable line in this brief.
5. `[H]` **An image with no authored alt produces no `/Alt`** — not a placeholder,
   not an empty string that veraPDF accepts.
6. `[H]` **`dc:title` and `/Lang` copy verbatim.** If so, **2.4.2 is solved for
   the four real documents blocked on it**, by copying rather than inventing.
7. `[H]` **Zero assertions across every probe.** This is the win condition and the
   whole hypothesis.
8. `[H]` **The `.docx` control behaves identically to `.fodt`.** Word's import
   filter is far better maintained than the HTML one that broke Brief A.

### Part 2

9. `[H]` **Arm N still loses the H1**, reproducing Brief A's defect and confirming
   it lives in the HTML import.
10. `[H]` **Arm R assertions land at or below Arm C's 1**, and well below Arm L's
    20 — because the two systematic classes behind 17 of those 20 are a wrong
    table scope and an unartifacted decorative image, and both are source-fixable.
11. `[H]` **`PDFUACompliance` clears `5-1`** and lifts DELIVERABLE on the four
    documents that failed nothing else.

### Win condition

**Zero assertions in Part 1**, and **Arm R assertions <= Arm C's 1** in Part 2.

### Kill condition

**The exporter asserts something the source did not state, and the assertion
cannot be removed by a repair at source.**

---

## Results

*Not yet run.*
