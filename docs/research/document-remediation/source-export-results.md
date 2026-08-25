# Brief A — Does structure survive an export, or was it never destroyed?

**Brief:** [`briefs/source-document.md`](briefs/source-document.md) ·
**Protocol:** [`briefs/README.md`](briefs/README.md) · **Timebox:** one session.

**The one question:** does a structure-preserving exporter deliver the semantics
our reconstruction pipeline cannot recover — on the same documents, against the
same ground truth?

Everything below the prediction was written after the runs. The prediction was
committed before the first measurement.

---

## Registered prediction

*Committed before the first measurement. Reproduced verbatim from the brief.
Not edited afterwards.*

1. `[H]` **Part 0:** at least **6 of 9** real documents report a structured
   producer — a word processor, a layout application, Distiller, or a report
   generator — rather than a scanner. All nine had extractable text.
2. `[H]` **LibreOffice emits a genuinely tagged PDF:** veraPDF 7.1-11 and 6.2-1
   both clear on Arm L.
3. `[H]` **Heading levels survive intact.** `<h1>` becomes `/H1` at the right
   level. **Zero heading assertions and zero heading omissions across Arm L.**
   This is the capability `Headings.java` structurally cannot have — it demotes
   and never promotes, so a document whose headings were never tagged gets zero
   headings from us, correctly and uselessly.
4. `[H]` **Table headers survive, but incompletely.** `<th>` becomes `/TH`;
   **scope and the merged group header do not.** Documents `03-simple-table` and
   `04-difficult-table` show header-relationship omissions — `03` has a
   `rowspan 2` and a `colspan 4` group header that I expect LibreOffice's HTML
   import to flatten.
5. `[H]` **Alt text survives** wherever `<img alt>` exists, on `05` and `06`,
   with **no model involved** — the exporter copies a string. If true this is the
   only path to alt text that does not assert.
6. `[H]` **Net: assertions fall to at or near zero, and DELIVERABLE rises above
   the Arm C baseline on the same set.** This is the first time in this project I
   have predicted DELIVERABLE to rise, and it is the whole point.
7. `[H]` **The failure will be fidelity, not semantics.** LibreOffice re-flows
   pages, so `02-two-column` and `08-slide-layout` will not look like the
   Chromium output. **Visual fidelity is not a WCAG criterion.** Record it as a
   finding; do not score it as a failure.

### Win condition

**Arm L assertions <= Arm C, and Arm L DELIVERABLE > Arm C, on the same set.**

### Kill condition

LibreOffice emits an untagged PDF, **or** heading levels do not survive.

---

## Results

*Not yet run.*
