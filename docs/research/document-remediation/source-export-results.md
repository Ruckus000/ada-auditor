# Brief A — Does structure survive an export, or was it never destroyed?

**Brief:** [`briefs/source-document.md`](briefs/source-document.md) ·
**Protocol:** [`briefs/README.md`](briefs/README.md) · **Timebox:** one session.
**Date:** 2026-08-25.

**The one question:** does a structure-preserving exporter deliver the semantics
our reconstruction pipeline cannot recover — on the same documents, against the
same ground truth?

Everything below the prediction was written after the runs. The prediction was
committed in `cc2cae2`, before the first measurement.

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

## Setup and cost

`[V]` **Install cost: zero bytes.** LibreOffice 26.2.2.2 was already present at
`/opt/homebrew/bin/soffice` (`LibreOffice 26.2.2.2 1f77d10d69…`). Nothing was
downloaded. `vendor/` (1.5 GB) and `node_modules` (615 MB) were **symlinked**
from the existing `elegant-matsumoto-6e3cad` worktree rather than copied or
re-fetched, so this worktree added only `out/` artefacts — **19 MB total**,
measured. `[V]` Disk was checked before the run at 97% full / 28 GiB free and
after at 98% / 20 GiB free; the 8 GiB difference is **not attributable to this
experiment**, whose whole footprint is the 19 MB above, and two other sessions
were writing to the same volume throughout. The brief's
check-disk-before-installing rule was satisfied by not installing.

`[V]` **Locality.** No network call was made by any stage. `generate-corpus.mjs`
routes the Chromium context to abort every non-`file:` request; `soffice` ran
`--headless` against a scratch `UserInstallation` profile; veraPDF and PDFBox are
local JARs. **No model of any kind was involved in either arm**, so
`HF_HUB_OFFLINE=1` had nothing to gate — this is `[V]` local by construction
rather than by that particular probe, and it is a weaker form of the same claim.

`[V]` **Shell.** Every run stage was driven from `bash -uo pipefail` with an
explicit per-stage `rc` echo. The trap in the brief reproduced immediately: the
session's default shell is `zsh`, where `${PIPESTATUS[0]}` expands to empty and a
failed stage prints no status at all.

**`09-scanned` is excluded from both arms**, per the brief. It is an image-only
PDF assembled from a PNG; there is no source structure to preserve. **All figures
below are over 11 documents**, and are not comparable to the published 8/28.

---

## Part 0 — The feasibility gate

`[V]` Read with a throwaway read-only PDFBox 3.0.8 probe in the scratch directory.
The nine files were opened in place under `real/`, never copied, never written,
and nothing below quotes document content — producer and creator strings only.

| document | pages | already tagged | `/Creator` | `/Producer` |
|---|---|---|---|---|
| ct-legal-notice | 11 | no | `Microsoft® Word for Microsoft 365` | `PDFsharp 1.51.5185 (…) (Original: Microsoft® Word for Microsoft 365)` |
| fordcity-fee-schedule | 4 | no | `Adobe Acrobat (64-bit) 25.1.21223` | `Microsoft: Print To PDF` |
| lacity-clerk-misc | 5 | **yes** | `14KONICA_C550i_CH3CPS_1` | `ABBYY FineReader Server` |
| newcastle-pc-hearing | 1 | **yes** | `Acrobat PDFMaker 20 for Word` | `Adobe PDF Library 20.5.73` |
| nola-cpc-notice | 2 | no | `Microsoft Office Word` | `Aspose.Words for .NET 20.5` |
| nyc-notice-form | 1 | no | `PDFium` | `PDFium` |
| orono-fee-schedule | 18 | **yes** | `Acrobat PDFMaker 24 for Excel` | `Adobe PDF Library 24.5.96` |
| sturgis-agenda | 90 | **yes** | `Microsoft Office Word` | `Diligent Corporation using ABCpdf` |
| tml-statutes-table | 15 | **yes** | `Acrobat PDFMaker 8.1 for Word` | `Acrobat Distiller 8.1.0 (Windows)` |

**`[V]` Gate: PASS.** The gate needed 3 of 9. **7 of 9** name a structured
producer on the inclusive reading; **6 of 9** on the strict one. The two readings
differ over `fordcity-fee-schedule`, whose `Microsoft: Print To PDF` is a virtual
print driver rather than an authoring application — it establishes that some
application document existed upstream but names neither the application nor a
format that retains structure. Counted as structured (not a scanner) in the 7;
excluded in the 6.

**`[V]` One of the nine is a scan.** `lacity-clerk-misc` is the only document
whose creator is a device — a Konica C550i multifunction copier — with
`ABBYY FineReader Server` as the OCR producer. `nyc-notice-form` names `PDFium`
as both creator and producer, which identifies the rendering engine and no
upstream document at all.

**`[V]` Five of nine already carry a structure tree.** `structTreeRoot` is
present on `lacity-clerk-misc`, `newcastle-pc-hearing`, `orono-fee-schedule`,
`sturgis-agenda`, `tml-statutes-table`. This independently confirms the
five-of-nine figure the brief cites when raising the Arm LP question.

`[V]` `sturgis-agenda` emitted a PDFBox parser warning (`found wrong object
number. expected [627] found [9579]`) and parsed anyway. Recorded, not pursued.

Part 1 ran.

---

## Part 1 — The measurement

`compare.mjs` unchanged, against `corpus/*.ground-truth.json`. Arm C is the
Chromium corpus through the full existing chain
(`opendataloader → captions → headings → tables → figures → lists → finishing`),
then `validate.mjs`, then `compare.mjs`. Arm L is `corpus/*.html` exported by
`soffice --headless --convert-to
'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}'`,
straight into `validate.mjs` and `compare.mjs`, with **no pipeline**.

### Headline `[V]`

| | Arm C (Chromium + pipeline) | Arm L (LibreOffice tagged export, no pipeline) |
|---|---|---|
| documents | 11 | 11 |
| **DELIVERABLE** | **3** | **0** |
| NEEDS_REVIEW | 2 | 0 |
| INCONCLUSIVE | 6 | 11 |
| **false assertions** | **1**, across 1/11 docs | **20**, across 7/11 docs |
| omissions | 17 | 31 |
| veraPDF PDF/UA-1 compliant | 5/11 | 0/11 |
| `compare.mjs` exit code | 1 | 1 |

**`[V]` The win condition is not met, in both directions.** Arm L assertions rose
1 → 20; Arm L DELIVERABLE fell 3 → 0.

**`[V]` The kill condition is met.** Heading levels do not survive.

### Tagging is genuinely on `[V]`

Confirmed **before** scoring, as the brief requires. Across all 11 Arm L
documents, veraPDF PDF/UA-1 reports **7.1-11 on zero documents and 6.2-1 on zero
documents**. The full set of failing rule IDs across Arm L is `5-1`, `7.1-9`,
`7.1-10`, `7.3-1`, `7.4.2-1`, `7.18.1-2`, `7.18.5-2`. The output is tagged.

**`[V]` Every Arm L document fails `5-1`, and four fail nothing else.**
`02-two-column`, `03-simple-table`, `04-difficult-table` and `07-complex-chart`
each carry exactly one veraPDF failure, and it is `5-1`, which veraPDF describes as
*"The PDF/UA version and conformance level of a file shall be specified using the
PDF/UA Identification extension schema"*. `UseTaggedPDF` produces tag structure
but does not write that identifier. Because `compare.mjs` derives
`verdict = !compliant ? INCONCLUSIVE : …`, **Arm L's DELIVERABLE of 0 is set by
`5-1` on every document before any structural defect is considered.** The
structural defects below are counted independently of it and are what the
question actually turns on.

### Headings — the mechanism `[V]`

| document | ground truth | Arm C | Arm L |
|---|---|---|---|
| 01-simple-text | `H1 H2 H3 H2 H2` | `H1 H2 H3 H2 H2` | `H2 H3 H2 H2` |
| 02-two-column | `H1 H2` | `H1 H2` | *(none)* |
| 03-simple-table | `H1` | `H1` | *(none)* |
| 04-difficult-table | `H1` | `H1` | *(none)* |
| 05-images-captioned | `H1 H2` | `H1 H1` | `H2` |
| 06-images-uncaptioned | `H1 H2 H2 H2 H2` | `H1` | `H2 H2 H2 H2` |
| 07-complex-chart | `H1` | `H1` | *(none)* |
| 08-slide-layout | `H1` | `H1` | *(none)* |
| 10-metadata-problems | `H1 H2 H2 H2` | `H1 H2 H2 H2` | *(none)* |
| 11-deliberately-inaccessible | `H1 H2 H2 H2` | `H1 H2 H2 H2` | `H4 H4 H4` |
| 12-kitchen-sink | `H1 H2 H2 H2 H2 H2 H3 H2` | `H1 H2 H2 H2 H1 H1 H1` | `H2 H2 H2 H2 H2 H3 H2` |

**`[V]` `<h1>` is lost on all 11 documents, and the cause is a single RoleMap
entry.** LibreOffice does not emit `/H1`. It emits a custom structure type named
after its own paragraph style — `/S /Heading#201`, i.e. `/Heading 1` — and the
document's RoleMap maps it to a paragraph:

```
/RoleMap <<
/Heading#201 /P
/Text#20body /P
>>
```

`<h2>` and `<h3>` become genuine `/H2` and `/H3`. Only the top level is
role-mapped away, and it is mapped to `/P`, not to `/H`. The RoleMap contains no
other entries, so nothing recovers it downstream.

**`[V]` Every other heading is exactly right.** On `01`, `06` and `12`, Arm L
reproduces the authored hierarchy **precisely, minus the H1** — `12` returns
`H2 H2 H2 H2 H2 H3 H2` against a ground truth of `H1 H2 H2 H2 H2 H2 H3 H2`, where
Arm C returns `H1 H2 H2 H2 H1 H1 H1` and gets three levels wrong. The exporter's
heading failure is one tag on one level, not a scattering.

**`[V]` The exporter is faithful to authored mistakes too.**
`11-deliberately-inaccessible` is authored with three `<h4>` elements and no
`<h1>`; Arm L returns `H4 H4 H4`. That is a correct export of an incorrect
document, scored as an omission against a ground truth that records the intended
`H1 H2 H2 H2`. Arm C returns the intended hierarchy because the pipeline infers
it rather than reading it.

**`[V]` Zero heading assertions in Arm L.** All 11 heading defects are
`heading under-detection`, which `compare.mjs` classes as an omission. Arm C, by
contrast, carries the run's single heading assertion on `05-images-captioned`
(`got ["H1","H1"], ground truth ["H1","H2"]`).

### Tables `[V]`

| | Arm C | Arm L |
|---|---|---|
| `03-simple-table` | 9 `/TH`, scopes `{Column, Row}` — clean | 9 `/TH`, scopes `{Column}` only — **3 assertions** |
| `04-difficult-table` | table **not detected at all** (omission) | 12 `/TH` — **5 assertions**, 1 header still `TD` |
| `12-kitchen-sink` | 9 `/TH`, scopes `{Column, Row}` — clean | two tables, 9 + 11 `/TH`, scopes `{Column}` only — **6 assertions** |
| `11-deliberately-inaccessible` | — | layout table tagged as a data table — **1 assertion** |

**`[V]` `<th>` survives as `/TH`, and Arm L finds more of them than Arm C does.**
Arm L detected `04-difficult-table` (12 `/TH`) where the pipeline detected no
table at all.

**`[V]` Scope survives, and is wrong.** Every `/TH` LibreOffice emits carries
`Scope=Column`, including the cells that head rows. `Northern`, `Southern`,
`Coastal` on `03`, and `Rigid18t`, `Artic44t`, `Shunter`, `Van3.5t` on `04`, all
head rows and all announce Column. On `04` a data cell was additionally marked as
a header. This is the defect class that matters: a missing scope is an omission a
reviewer can see, and a wrong scope is an assertion in the delivered bytes with
nothing to signal it.

### Figures and alt text `[V]`

**`[V]` LibreOffice does copy the authored string, with no model involved.**
`05-images-captioned` carries `/Alt <FEFF004E006F00720074006800770069006E00640020…>`
— UTF-16BE for the logo's authored `alt="Northwind Logistics"` — on both logo
occurrences.

**`[V]` The corpus has almost no authored alt to copy.** `05` authors
`alt="Northwind Logistics"` twice and `alt=""` twice; **`06-images-uncaptioned`
authors `alt=""` five times and nothing else.** The meaningful figures in this
corpus carry their description in a caption, not in an `alt` attribute. Arm C's
`/Alt` values on `05` are caption-derived, produced by `Captions.java`.

**`[V]` Empty `alt=""` becomes a described `/Figure`, not an artifact.** Arm L
tags every image as `/Figure` regardless, so the decorative images produce
`figure with no Alt and no ActualText` omissions **and** the
`N Figure elements for M expected` assertion on `05`, `06`, `11` and `12` — 4
extra Figure elements on `12` alone. Arm C artifacted 5 images across the run.

### Fidelity `[V]`

Page counts changed under re-flow: `02-two-column` 2 → 1, `12-kitchen-sink`
6 → 3, `05`/`06` unchanged at 2. Not scored, per the brief.

---

## The prediction, checked line by line

**1. Part 0, ≥6 of 9 structured producers — HIT `[V]`.**
7 of 9 inclusive, 6 of 9 strict. The prediction holds on either reading. The
sub-clause "all nine had extractable text" was not re-measured here and remains
`[R]` from the earlier run.

**2. Genuinely tagged, 7.1-11 and 6.2-1 both clear — HIT `[V]`.**
Both rules clear on all 11 documents.

**3. Heading levels survive intact, zero assertions and zero omissions — MISS.**
Split, and the important half missed. *Zero heading assertions* — **hit**, all 11
heading defects are omissions. *`<h1>` becomes `/H1` at the right level* —
**miss**; it becomes `/Heading 1`, role-mapped to `/P`, on 11 of 11 documents.
*Zero heading omissions* — **miss**; 11 of 11 documents carry one. **This is the
kill condition and it is met.** The prediction's reasoning about `Headings.java`
was sound and the fact it predicted was wrong: the exporter does carry `H2`/`H3`
perfectly, so the capability the pipeline lacks does exist — it just does not
extend to the level every one of these documents leads with.

**4. `<th>` survives, scope and the group header do not — HIT on outcome, MISS on
defect class.** `<th>` → `/TH`: confirmed, and Arm L emits more `/TH` than Arm C.
`03` and `04` do fail, as named. But the prediction said *"header-relationship
omissions"*, and what appeared were **assertions** — scope is emitted, and
emitted wrong, on every header cell. Predicting the right documents for the wrong
reason is worth less than it looks: this is the safety gate, and the prediction
put the defect on the harmless side of it.

**5. Alt text survives wherever `<img alt>` exists — HIT narrowly, MISS on the
claim that matters.** The exporter copies the string with no model: **confirmed**
on the logo. But the premise was wrong — `05` has no meaningful authored alt and
`06` has none at all, only five `alt=""`. The concluding claim, *"the only path to
alt text that does not assert"*, is **wrong in the opposite direction**: Arm L's
figure handling produced 7 of the run's 20 assertions, because empty-alt
decorative images are tagged as `/Figure` rather than artifacted.

**6. Assertions fall to near zero, DELIVERABLE rises — MISS, in both terms and by
a wide margin.** Assertions 1 → **20**, across 7 of 11 documents. DELIVERABLE
3 → **0**. The first time this project predicted DELIVERABLE to rise, it fell to
zero. Part of that fall — the whole of it, mechanically — is `5-1`, an identifier
`UseTaggedPDF` does not write; but assertions are computed independently of
veraPDF and rose twentyfold regardless.

**7. The failure will be fidelity, not semantics — MISS.** Re-flow did occur and
was not scored. The failure was semantic: a heading level, a table scope, and a
figure-versus-artifact decision.

**Score: 2 clean hits (1, 2), 1 split (4), 4 misses (3, 5, 6, 7).**

### Answer to the one question

`[V]` **On this corpus, against this ground truth, the exporter did not deliver
the semantics the pipeline cannot recover.** It delivered some of them — `H2`,
`H3` and `H4` levels exactly as authored, more `/TH` cells than the pipeline
found, and an authored `alt` string copied without a model — while destroying the
`H1` on every document, asserting a wrong `Scope` on every header cell it
produced, and tagging decorative images as content. Measured by `compare.mjs`,
Arm L is worse than Arm C on both numbers the brief named.

`[V]` **The brief's premise is confirmed and the inference from it is not.** The
information *is* in the source and *is* thrown away at export — `/Heading 1 → /P`
is that deletion, visible in four lines of a RoleMap. Replacing the exporter
recovered part of it and introduced new false claims while doing so.

**Arm LP was not run.** The kill condition was met, and the brief says record and
stop.

---

## FINDINGS — interesting, deliberately not pursued

1. **`PDFUACompliance` is a separate LibreOffice export option from
   `UseTaggedPDF`.** `[H]` Every Arm L document failed `5-1` and four failed
   nothing else, so this one filter option plausibly accounts for the whole
   DELIVERABLE gap on those four. Not tested — the brief names `UseTaggedPDF`,
   and a second export arm is a different question.
2. **The `/Heading 1 → /P` RoleMap entry may be an HTML-import artefact rather
   than an exporter one.** `[H]` `<h2>`/`<h3>` map correctly, which points at how
   LibreOffice's HTML filter assigns the outline level of the "Heading 1"
   paragraph style, not at the PDF writer. A `.docx` or `.odt` source might not
   reproduce it. **This is the obvious next brief the brief itself anticipated**,
   and it is now a sharper question than "does `.docx` work": it is one style,
   one outline level, one RoleMap entry.
3. **A RoleMap-aware reader would score Arm L differently.** `[H]` `Inspect.java`
   reads structure types literally. Resolving RoleMap would change nothing here —
   `/Heading 1` maps to `/P`, so it is genuinely not a heading — but it would
   matter for any producer that maps custom types *to* `/H1`. Five of the nine
   real documents arrive tagged, by producers that do exactly this kind of
   naming.
4. **Arm L detected a table the pipeline could not.** `04-difficult-table` is an
   omission in Arm C and 12 `/TH` cells in Arm L. Table *detection* and table
   *scope* came apart cleanly across the two arms; nothing was done with that.
5. **Every `/TH` LibreOffice emits is `Scope=Column`.** `[H]` If that is
   unconditional rather than inferred, it is a fixed, knowable property of the
   exporter rather than a per-document risk. Four tables is not enough to claim
   it.
6. **`11-deliberately-inaccessible` scores better under inference than under
   fidelity.** Arm C returns the *intended* `H1 H2 H2 H2`; Arm L returns the
   *authored* `H4 H4 H4`. The ground truth records intent, so faithfully
   exporting a badly-authored document is penalised and inferring past it is
   rewarded. That is a property of the fixture, not of either arm, and it affects
   exactly one document.
7. **The corpus expresses figure meaning in captions, not `alt`.** `06` authors
   five `alt=""` and nothing else. Any measurement of alt-text preservation on
   this corpus is measuring almost nothing, in either direction.
8. **`sturgis-agenda` has a malformed cross-reference** (`expected [627] found
   [9579]`) and parses anyway. 90 pages, `Diligent Corporation using ABCpdf`.
9. **`nyc-notice-form` names `PDFium` as both creator and producer** — the same
   family of engine as the `page.pdf()` path this corpus was built to model. A
   real municipal document produced the way our synthetic untagged baseline is
   produced.
10. **Page re-flow was substantial** — `12-kitchen-sink` 6 pages → 3. Not scored,
    per the brief, and worth knowing before any comparison that assumes page
    correspondence between arms.

---

## Reproduce

From this worktree, with `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, in
`experiments/document-remediation/`, driven from `bash`:

```bash
node make-images.mjs && node generate-corpus.mjs
mkdir -p out/armC-in && cp out/corpus/*.pdf out/armC-in/ && rm out/armC-in/09-scanned.pdf
node run-opendataloader.mjs out/armC-in out/armC-tagged
node run-captions.mjs out/armC-tagged out/armC-captioned
node run-headings.mjs out/armC-captioned out/armC-headings
node run-tables.mjs out/armC-headings out/armC-tables
node run-figures.mjs out/armC-tables out/armC-figures
node run-lists.mjs out/armC-figures out/armC-lists
node run-finishing.mjs out/armC-lists out/armC-finished
node validate.mjs out/armC-finished out/armC-validated
COMPARISON_OUT=out/armC.comparison.json node compare.mjs out/armC-finished out/armC-validated/summary.json
```

```bash
for f in corpus/*.html; do b=$(basename "$f" .html); [ "$b" = 09-scanned ] && continue
  soffice --headless --norestore -env:UserInstallation=file:///tmp/lo-profile \
    --convert-to 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}' \
    --outdir out/armL "$f"; done
node validate.mjs out/armL out/armL-validated
COMPARISON_OUT=out/armL.comparison.json node compare.mjs out/armL out/armL-validated/summary.json
```
