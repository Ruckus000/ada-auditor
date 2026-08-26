# What already exists, what we duplicated, and what only we have

**Date:** 2026-08-25 · Prompted by a direct challenge: are we still solving the
same problem, and are we rebuilding something that exists.

---

## 1. The drift, named

**We pivoted, deliberately and on evidence** — `[V]` zero of nine real documents
reachable from PDF-in/PDF-out, recorded in
[position-2026-08-25.md](position-2026-08-25.md). That was the right call.

**But there is a drift underneath it that nothing has flagged, and it is mine.**

`[V]` Everything measured on the source path runs on a **synthetic HTML corpus
converted to ODF**. That is two format conversions away from anything a client
sends. Brief C's `.docx` control was **one probe testing headings**, not a
document. **No real `.docx` has ever been through this path.**

So the last two days optimised a pipeline against a fixture that no client will
ever produce. The engineering is sound and the measurements are honest; the
*input* is a proxy nobody validated. This is the same failure the project already
recorded once — *"validating against a proxy we controlled"* in
[working-agreement.md](working-agreement.md) — and it recurred.

## 2. What we built versus what exists

| what we built | prior art | honest verdict |
|---|---|---|
| tagging pipeline (Headings, Tables, Figures, Lists) | Adobe Acrobat auto-tag, PDFix Auto-Tag API, PREP, Apryse | **Duplicated.** Our own research put us at *"rough parity with the incumbent's automated step"*. No moat. |
| contrast detection | PAC 2024, Acrobat checker | Partly duplicated. Ours is report-only and integrated, which is a nicety, not a product. |
| **assertion / omission comparator** | **none found** | **Genuinely ours.** See below. |
| source-first remediation | axesWord, Word's own Accessibility Checker, every practitioner guide | **We reinvented the industry consensus** — and arrived at it by measurement rather than by reading, which is expensive but not wrong. |
| `FixScope.java` | — | Ours, and possibly solving a problem we created. See §4. |

`[R]` **PDFix's marketplace integrates IBM Docling** — the same component we
tested and measured as making our output *worse*, 8 assertions to 26
([tagger-comparison-results.md](tagger-comparison-results.md)). A shipping vendor
is building on the thing we rejected on evidence. That is a point in favour of
our measurement discipline, not our product.

`[R]` **PREP advertises "up to 95% auto-tagging."** The number nobody publishes
is what the other 5% does. Under our own gate, a wrong tag is not 5% of a
success — it is a false claim in the delivered bytes.

## 3. The one thing that appears to be ours

**Nothing found in the market distinguishes "we invented this" from "we left a
gap."** Every tool reports conformance: rules passed, rules failed, some marked
for manual review. PAC's Matterhorn checks come closest, flagging conditions that
*cannot* be machine-verified — but that is "unknown", not "we asserted and may be
wrong."

That distinction is the whole of what we learned, and it is the buyer's actual
exposure. A municipality that pays a vendor cannot tell whether the returned file
is correct, and neither can the vendor's own report.

**`[V]` And a useful part of it needs no ground truth at all.** These are
detectable in any PDF, from anyone's pipeline:

| assertion | detectable how |
|---|---|
| `/TH` scoped Column while sharing a row with `/TD` | structural — this is exactly `FixScope`'s rule |
| heading levels that skip (H1 → H3) | structural — `Headings.java` R8 already does it |
| placeholder alt (`"image 1"`) | pattern — `compare.mjs` already does it |
| image drawn on the page but artifacted out of the tree | `Inspect.java` already counts this |
| a table where no cell references content | `Tables.java` R0 already does it |
| contrast below 4.5:1 | `Contrast.java` already does it |

**Six assertion detectors that work on documents we have never seen, and five of
the six are already written.**

## 4. The uncomfortable finding about `FixScope`

`[R]` Practitioner comparisons report that **Word exports table headers as `/TH`
but without a `Scope` attribute**, while LibreOffice's is the weaker export in
that area.

If that holds, then:

- **Word omits** (a `/TH` with no scope claims nothing) — honest, and it clears
  gate 1.
- **LibreOffice asserts** (a `/TH` scoped Column that heads a row) — which is the
  defect `FixScope` exists to correct.

**`FixScope` may be correcting a problem created by choosing LibreOffice.** It is
`[R]`, not `[V]` — one practitioner source, not our measurement — and it is the
single highest-value thing left to test, because it decides whether an entire
layer of our stack is necessary.

`[V]` It is not wasted either way: on a Word export with no scope at all,
`FixScope`'s rule *adds* the correct one, which is an improvement rather than a
correction. The rule is sound; the question is what it is pointed at.

**Why LibreOffice was chosen and why that still matters:** headless, scriptable,
free, local, no per-seat licence, no Windows. Word is none of those on a server.
The tradeoff is real and unmeasured.

---

## The options

### A — Finish the source path, but validate the input first
Run a real `.docx` end to end before another line of repair code. Test our
LibreOffice path against Word's own export on the same file.
**Cost:** small. **Kills:** finding the whole export layer is unnecessary — which
would be a cheap and valuable thing to learn.

### B — Stop converting; remediate the source and hand it back
Fix the `.docx` — heading styles, table headers, title, language — and let the
client export with the Word they already own. We never touch PDF.
**Pro:** far simpler, and it is what axesWord already does.
**Con:** a competitor exists, the export quality becomes theirs, and alt text
still needs a human.

### C — Recommend HTML instead of PDF where the document allows it
The practitioner consensus, and Title II covers web content either way. Fee
schedules, agendas and statute tables — most of our real corpus — are strictly
better as pages.
**Pro:** honest, cheap, and removes the hardest problems entirely.
**Con:** it is consulting, not software, and it shrinks the product.

### D — Sell the verification, not the remediation
Build the ground-truth-free assertion detector. Point it at **anyone's** output —
Acrobat's, a vendor's, PDFix's — and report the false claims in the delivered
bytes.
**Pro:** the one thing we have that the market does not; five of six detectors
already written; it needs no client source files; it works on a PDF, which is
what clients actually have. Aligned with the buyer's real anxiety — they are
paying someone and cannot check the work.
**Con:** a smaller product than remediation, and it sells against our own
would-be partners.

### E — Stop
Weaker than a week ago. We now have one clean document and a real differentiator.
