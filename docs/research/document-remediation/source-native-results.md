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

## Setup and cost

`[V]` **Install cost: zero bytes.** LibreOffice 26.2.2.2 was already present.
`vendor/` and `node_modules` were symlinked from `elegant-matsumoto-6e3cad` as
the brief directs; `out/classes` was rebuilt with `javac` (164 KB). This
worktree's whole footprint is its `out/` artefacts.

`[V]` **Locality.** No network call by any stage. `soffice` ran `--headless`
against a scratch `UserInstallation` profile; PDFBox and veraPDF are local JARs.
**No model was involved at any point** — Brief C authorises none, and none was
used, so there was no `HF_HUB_OFFLINE=1` to set.

`[V]` **Shell.** Every stage ran under `bash -uo pipefail` with an explicit `rc`
echo **and an existence check on the output file**. That second check earned its
place immediately: `soffice --convert-to fodt` on an HTML input **returned
`rc=0` for all 11 documents while producing no files at all** (`Error: no export
filter ... aborting` on stdout). This is the fourth recorded instance of a
zero exit code over a wholly failed run in this project, and the first where the
false success came from the tool rather than the shell. The fix was an explicit
import filter, `--infilter="HTML (StarWriter)"`, plus the full output filter name
`fodt:OpenDocument Text Flat XML`.

**`09-scanned` is excluded from every arm**, as in Brief A. All Part 2 figures
are over the same 11 documents, so they are directly comparable to Arm C and
Arm L.

**One deviation, declared:** Part 2's intermediate is **flat ODF (`.fodt`)**
rather than zipped `.odt`. Same format, same filter, same import path — it is
ODF without the zip container, which makes a throwaway repair script a text
substitution instead of a zip round-trip. YAGNI.

---

## Part 1 — The assertion probe

Ten probes, hand-authored flat ODF, roughly ten lines each. Each probe's ground
truth is the source I wrote. Scored by reading the source and `Inspect.java`'s
output side by side. **No comparator was built** (rule 6).

`[V]` **The probes are read by LibreOffice, not merely written by me.** A
`.fodt` -> `.fodt` round-trip through `soffice` preserves `loext:decorative="true"`,
which proves the decorative flag is parsed rather than ignored as unknown XML.

| # | probe | the source states | the PDF contains | claims something unstated? |
|---|---|---|---|:--:|
| 1 | headings | `text:outline-level` 1–6 | `/H1 /H2 /H3 /H4 /H5 /H6`, texts verbatim | **no** |
| 2 | **no headings** | body text only; two paragraphs at 28pt bold | **zero `/H*`**; `/Big` role-mapped to `/P` | **no** |
| 3 | table, header row | `table:table-header-rows`, 3 cells | 3 `/TH` `Scope=Column`, 6 `/TD` | **no** |
| 4 | **table, row labels** | 3 rows, **no header marking** | **9 `/TD`, zero `/TH`** | **no** |
| 5 | **layout table** | a table used for positioning | `/Table`, 4 `/TD`, **zero `/TH`**, no header relationships | **no** — see note |
| 6 | **decorative image** | `loext:decorative="true"` | **zero `/Figure`**; image drawn inside `/Artifact BMC` | **no** |
| 7 | meaningful image | `svg:title` + `svg:desc`, distinct strings | `/Alt` = both, joined — see note | **no** — see note |
| 8 | **image, no alt** | an image, nothing authored | 1 `/Figure`, **zero `/Alt`**, no placeholder | **no** |
| 9 | list | 3 items, one nested child | 2 `/L`, 4 `/LI`, depth 2 | **no** |
| 10 | title + language | `dc:title`, `fo:language="cy"` | title verbatim, `/Lang="cy-GB"` | **no** |

**`[V]` Across the brief's ten probes: zero assertions.** Nothing in any output
claims anything the source did not state.

**`[V]` Probe 6 is the decisive one and it resolves.** The decorative image is
*present* — the image XObject is still in the file — and drawn inside
`/Artifact BMC` with no `/Figure` element. The 7-assertion class Brief A left
untested does resolve at source, and prediction 4 is the single line of this
brief that mattered most.

**Note on probe 5.** By the brief's own criterion — "`/TH` anywhere, or header
relationships" — this passes: there are none. The `/Table` element itself is
retained, because **the source did state a table**: ODF has no way to say "this
table is layout only". The exporter copied a table-ness the source asserted. That
is not an invention, and it is repairable at source by not using a table.

**Note on probe 7.** `/Alt` came out as
`TITLESTRING ALPHA - DESCSTRING BRAVO` — LibreOffice **concatenates `svg:title`
and `svg:desc` with " - "**. Every character originates in the source and nothing
is added, so it is not an assertion. It is also **not verbatim** against either
authored string, which is what the brief's probe row said to look for. Reported
as a join, not an invention.

### Probe 11 — added beyond the brief's ten, and why

Probe 3 contained only column headers, so it could not distinguish *"the exporter
copies a scope the source stated"* from *"the exporter stamps `Column` on every
`/TH`"*. Part 2 then produced 13 assertions turning on exactly that. One probe
settles it, and it is the one question, not a new one — so it was added rather
than deferred to FINDINGS.

Source: hand-authored native ODF, **no `table:table-header-rows` anywhere**, the
first cell of each body row carrying the `Table Heading` **paragraph style** and
nothing else. No scope is stated, and no header row is stated.

```
TH:Column(Northern)  TD(12) TD(4)
TH:Column(Southern)  TD(8)  TD(6)
TH:Column(Coastal)   TD(3)  TD(1)
```

**`[V]` The exporter derives `/TH` from a paragraph style, and stamps
`Scope=Column` on it unconditionally — including on cells that head rows.** The
source stated a style. It stated no scope at all. `Column` is the exporter's own
claim, and on these cells it is wrong.

**`[V]` This is an assertion in the brief's exact sense: the export claims
something the source did not state.**

**On the kill condition.** The kill condition is *"the exporter asserts something
the source did not state, **and the assertion cannot be removed by a repair at
source**"*. The assertion **can** be removed at source — changing those cells'
paragraph style from `Table Heading` to `Table Contents` yields `/TD` and an
honest omission. So the kill condition **as written is not met**. But that repair
is **not one of the four the brief permits**, and deciding that a header-styled
cell is not a header is a judgement about meaning, which the brief routes to
FINDINGS rather than to code. Both halves of that are recorded; resolving which
one governs is synthesis, and is not done here.

### The `.docx` control

`[V]` **Identical.** Probe 1 converted to `.docx` and re-exported produces
`/H1`–`/H6`, the same heading texts, the same `RoleMap<</Standard /P>>`, and a
byte-identical file size. Word's import filter does not reproduce the HTML
filter's defect.

---

## Part 2 — The corpus number

Same 11 documents, `compare.mjs` and `Inspect.java` unchanged. **Arm C and Arm L
are Brief A's figures, not re-run.**

| | Arm C | Arm L | **Arm N** | **Arm R** | **Arm R+UA** |
|---|:--:|:--:|:--:|:--:|:--:|
| | Chromium + pipeline | LO from HTML | LO from ODF, no repair | + permitted repairs | + `PDFUACompliance` |
| **assertions** | **1** | **20** | **20** | **17** | **17** |
| omissions | 17 | 31 | 25 | **12** | **12** |
| veraPDF UA-1 | 5/11 | 0/11 | 0/11 | 0/11 | **6/11** |
| DELIVERABLE | 3 | 0 | 0 | 0 | **2** |
| NEEDS_REVIEW | 2 | 0 | 0 | 0 | 4 |

`[V]` **Arm R+UA assertion classes:** 13 wrong table scope · 1 data cell as
header · 1 reading order · 1 layout table as data · 1 extra figure.
**13 of 17 are the single probe-11 behaviour.**

### Arm N did not lose the H1

`[V]` Headings survive from ODF on 8 of 11 documents, several exactly:

| document | ground truth | Arm L (Brief A) | **Arm N** |
|---|---|---|---|
| 01-simple-text | `H1 H2 H3 H2 H2` | `H2 H3 H2 H2` | **`H1 H2 H3 H2 H2`** |
| 12-kitchen-sink | `H1 H2 H2 H2 H2 H2 H3 H2` | `H2 H2 H2 H2 H2 H3 H2` | **`H1 H2 H2 H2 H2 H2 H3 H2`** |
| 08-slide-layout | `H1` | *(none)* | *(none)* |
| 10-metadata-problems | `H1 H2 H2 H2` | *(none)* | *(none)* |

`[V]` **Brief A's `/Heading 1 -> /P` RoleMap defect does not reproduce**, and the
cause is narrower than "the HTML import". Going through `--infilter="HTML
(StarWriter)"` — the **Writer** module — produces correct
`<text:h text:outline-level="1">`. Brief A's direct `.html -> .pdf` went through
**Writer/Web**, which does not.

`[V]` **`08` and `10` produce no headings because their sources contain none.**
Neither HTML file has a single `<h1>`–`<h6>` element; both style `<div class="title">`
and `<div class="big">` instead. The exporter omits, honestly. Arm C's pipeline
infers them — and on `12-kitchen-sink` Arm C inferred three levels wrongly.

### What the permitted repairs reached, and what they did not

`[V]` Only the four repairs the brief permits were applied:

| repair | effect |
|---|---|
| R1 outline level on heading-styled paragraphs | **0 applied** — the Writer import had already set every one |
| R2 empty authored alt -> decorative | **18 images** across 6 documents |
| R3 `dc:title` by copying a stated heading | **1 copied** (`11`), **1 blocked** (`10`) |
| R4 document language | **0** — already present on every document |

**`[V]` R3 blocked on `10-metadata-problems` for exactly the reason the four real
documents are blocked: there is no heading to copy.** The copy mechanism works
and it cannot reach a document whose source states no heading. Inventing one is
the assertion this brief exists to avoid, so the repair correctly declined.

### `PDFUACompliance` — prediction 11

`[V]` **It clears `5-1` completely.** The rule disappears from every document.
Six documents become UA-1 compliant, DELIVERABLE goes 0 -> 2 and NEEDS_REVIEW
0 -> 4. **Assertions and omissions are unchanged at 17 and 12** — the option
touches conformance metadata, not structure. Five documents still fail on
`7.18.1-2`, `7.18.5-2`, `7.1-3`, `7.1-9`, `7.4.2-1`.

### A DELIVERABLE that should not be one

**`[V]` This is the most important caveat on the number above, and it is a
finding against the instrument, not against the exporter.**

`06-images-uncaptioned` scores **DELIVERABLE** in Arm R+UA with zero defects. Its
ground truth records **4 meaningful figures**. The repaired document contains
**zero `/Figure` elements**: all five images carried `alt=""`, R2 marked them
decorative exactly as the brief specifies, and the exporter artifacted them.

`compare.mjs` checks for *too many* Figure elements and never for too few, so
four meaningful images silently leaving the structure tree produces a clean
verdict. The same pattern holds on `07`, `08` and `11`:

| document | gt meaningful figures | Arm N tagged | Arm R+UA tagged | verdict |
|---|:--:|:--:|:--:|---|
| 06-images-uncaptioned | 4 | 5 | **0** | **DELIVERABLE** |
| 07-complex-chart | 1 | 0 | **0** | **DELIVERABLE** |
| 08-slide-layout | 1 | 1 | **0** | NEEDS_REVIEW |
| 11-deliberately-inaccessible | 1 | 2 | **0** | INCONCLUSIVE |

**`[V]` Neither the exporter nor the repair asserted anything here** — an
`alt=""` image is one the author marked decorative, and both copied that
faithfully. The defect is that **the instrument cannot see the resulting
omission**, so part of the omission drop from 25 to 12, and at least one of the
two DELIVERABLEs, is an instrument blind spot rather than a improvement.

---

## The prediction, checked line by line

**1. Outline levels 1–6 survive as `/H1`–`/H6` — HIT `[V]`.** All six, texts
verbatim, in `.fodt` and in the `.docx` control.

**2. The `no headings` probe produces zero `/H*` — HIT `[V]`.** Two 28pt bold
paragraphs, deliberately planted to tempt inference, came out `/P`. **The
exporter does not infer headings from formatting.** This is the cleanest
confirmation in the run of the omit-don't-assert hypothesis.

**3. Row-label cells are never emitted as `/TH` — MISS.** True where the source
marks nothing (probe 4: 9 `/TD`, zero `/TH`). **False where the source carries the
`Table Heading` paragraph style** — probe 11 and 13 corpus assertions. The
prediction's *reason* was right and load-bearing — ODF genuinely cannot express a
row header — but the conclusion drawn from it was wrong, because **LibreOffice
derives `/TH` from a paragraph style rather than from table structure**, and then
supplies a `Scope` the source never stated. This is the miss that matters.

**4. A decorative-marked image becomes an artifact — HIT `[V]`.** Probe 6:
zero `/Figure`, image drawn inside `/Artifact BMC`. In the corpus it removed 3 of
the 4 extra-figure assertions. The brief called this "the single most valuable
line" and it holds.

**5. An image with no authored alt produces no `/Alt` — HIT `[V]`.** No
placeholder, no empty string. A `/Figure` with no `/Alt` is a `7.3-1` failure,
which is the honest gap we want.

**6. `dc:title` and `/Lang` copy verbatim — HIT on the mechanism, MISS on the
consequence.** Probe 10 copies both exactly. But the prediction went on to say
*"2.4.2 is solved for the four real documents blocked on it"*, and **it is not**:
those four produce zero headings, so there is no heading to copy from, and R3
blocked on the corpus document in the same position. The copy is verified; the
claim about the four real documents does not follow from it and is withdrawn.

**7. Zero assertions across every probe — HIT on the brief's ten, MISS on the
eleventh.** The ten probes the brief specified produce zero assertions. The probe
I added to disambiguate probe 3 produces one, and it is the behaviour behind 13
of Part 2's 17.

**8. The `.docx` control behaves identically — HIT `[V]`.**

**9. Arm N still loses the H1 — MISS.** It does not. `H1` survives on 8 of 11,
and `01` and `12` match ground truth exactly. The defect is narrower than the
prediction assumed: it belongs to LibreOffice's **Writer/Web** module, not to its
HTML filter generally.

**10. Arm R assertions at or below Arm C's 1 — MISS, by 16.** 17 against 1. The
prediction's arithmetic assumed both systematic classes were source-fixable; only
one was. The decorative-image class resolved as predicted (4 -> 1). The table-scope
class did not move at all, because removing it needs a repair outside the four
permitted.

**11. `PDFUACompliance` clears `5-1` and lifts DELIVERABLE — HIT `[V]`.** `5-1`
gone on all 11; DELIVERABLE 0 -> 2; six documents UA-1 compliant.

**Score: 6 hits (1, 2, 4, 5, 8, 11), 1 split (6), 4 misses (3, 7, 9, 10).**

### Answer to the one question

**`[V]` Yes — once, in one place, and it is systematic.** Across ten probes
covering headings, silence, tables, images, lists, titles and language, the
export claimed nothing the source did not state. It omitted where the source was
silent, in every case tested, including all four load-bearing silence probes.
**The one exception is `Scope`:** LibreOffice emits `/TH` from a paragraph style
and stamps `Scope=Column` on it unconditionally, so any cell styled as a table
heading anywhere other than a header row carries a scope the source never
stated and that is wrong. That behaviour accounts for **13 of Arm R's 17
assertions**.

`[V]` **The assertion is removable at source** — restyling the cell yields `/TD`
and an honest omission — **but not by any of the four judgement-free repairs the
brief permits.** The kill condition as written is therefore not met, and the
question of whether that distinction matters is synthesis, which does not happen
here.

---

## FINDINGS — interesting, deliberately not pursued

1. **De-styling row-label cells is the repair that would remove 13 of 17
   assertions.** `[H]` Changing `Table Heading` to `Table Contents` on cells
   outside a header row would turn every scope assertion into an omission. It is
   **not** on the brief's permitted list, and it requires deciding that a
   header-styled cell is not a header — a judgement about meaning. Recorded, not
   coded, exactly as the brief directs.
2. **`compare.mjs` cannot see figure under-tagging.** `[V]` It asserts on too
   many `/Figure` elements and never on too few, so a document that drops four
   meaningful images scores DELIVERABLE. This affects any arm that artifacts
   aggressively and it is a gap in the instrument, not in any arm.
3. **The `alt=""` repair is lossy in a way the source cannot distinguish.** `[V]`
   An author who left `alt` empty because the image is decorative and one who left
   it empty because they did not fill it in are byte-identical in the source. The
   permitted repair treats both as decorative. Honest, deterministic, and it
   deletes meaningful images.
4. **Writer/Web versus Writer is the whole of Brief A's kill.** `[V]` The same
   HTML, the same binary, the same export option: through Writer/Web the `H1`
   becomes `/Heading 1 -> /P`; through Writer it becomes `/H1`. `--infilter` is
   the difference. Whether any real client path goes through Writer/Web is
   unknown and untested.
5. **`soffice --convert-to` returns `rc=0` on total failure.** `[V]` Eleven
   documents, no output, exit 0, with the error on stdout. Any automation must
   check for the output file. Fourth instance of a false success in this project.
6. **`/Alt` is a concatenation of `svg:title` and `svg:desc`, joined with " - ".**
   `[V]` Deterministic and lossless, but a caller expecting one authored field
   back will not get it verbatim.
7. **Five documents still fail UA-1 after `PDFUACompliance`**, on `7.18.1-2`,
   `7.18.5-2`, `7.1-3`, `7.1-9` and `7.4.2-1`. Untriaged. `01-simple-text` has
   **zero structural defects** and is still INCONCLUSIVE on two of them.
8. **A layout table stays a `/Table`.** `[V]` ODF cannot mark a table as
   presentational, so the exporter faithfully reproduces a table the author used
   for positioning. Repairable only by not using a table — a source-authoring
   change, not a repair.
9. **Whether clients still hold their sources is not answered by running code.**
   The brief says so and it remains true: a producer string proves a source
   existed at export time. Nothing here bears on retrievability.
10. **Arm LP was never run** in Brief A and still has not been. Feeding good
    structure into a pipeline that re-tags unconditionally remains untested.
11. **`07-complex-chart` never had a `/Figure` in any arm**, including Arm N with
    no repair, while its ground truth records one meaningful figure. Its chart is
    drawn rather than placed as an image. Not investigated.

---

## Reproduce

From this worktree, `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, in
`experiments/document-remediation/`, driven from `bash`. Probe and repair scripts
are throwaway and live in the session scratch directory.

```bash
soffice --headless --norestore --infilter="HTML (StarWriter)" \
  --convert-to "fodt:OpenDocument Text Flat XML" --outdir "$ODT" corpus/NN.html
python3 repair.py "$ODT" "$ODT_REPAIRED"
soffice --headless --norestore \
  --convert-to 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"},"PDFUACompliance":{"type":"boolean","value":"true"}}' \
  --outdir out/armRUA "$ODT_REPAIRED"/NN.fodt
node validate.mjs out/armRUA out/armRUA-validated
COMPARISON_OUT=out/armRUA.comparison.json node compare.mjs out/armRUA out/armRUA-validated/summary.json
```

**Check for the output file after every `soffice` call.** `rc` alone is not a
result.
