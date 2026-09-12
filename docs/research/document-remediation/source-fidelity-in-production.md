# Source fidelity, in production — predictions

**Date:** 2026-08-31 · **Registered before the run**, per
[working-agreement.md](working-agreement.md). Results are appended below in a
second section once measured; nothing above the results line is edited
afterwards.

## What shipped

Until now, **nothing in production compared a delivered PDF against the source
it came from.** The only delivery-time check was
`contentChanges(before, after)`, which compares a PDF with *itself* — proving
the `Finish` repair step moved no content. It needs no reference, which is what
makes it work on a client's PDF, and it is why it cannot answer this question:
both its readings come from the output.

The 31/31 fidelity figure in
[remediation-test-2026-08-27-results.md](remediation-test-2026-08-27-results.md)
was produced by the spike's harness, by hand, offline, once. Every document
delivered since has been unverified against its own source.

Now graduated into `src/`:

| | |
|---|---|
| `domain/source-truth.ts` | what the source declares, read from its own bytes (`zipEntry`, no subprocess) or — for legacy `.doc` — from the flat ODF the pipeline already produces, labelled `engine-derived` |
| `domain/source-fidelity.ts` | the comparison, in the two-defect vocabulary lifted from `compare.mjs` |
| `app/api/_lib/document-conversion.ts` | **an assertion refuses delivery**; omissions become `needs[]` items |

The gate is asymmetric on purpose. An assertion — the output stating something
the source did not — is the failure that misleads a screen-reader user while
every instrument reads clean. An omission is honest and visible.

## Predictions

**P1 — zero assertions across all 31 documents.**
The 2026-08-27 campaign measured fidelity 31/31 on headings, tables and figures
after the empty-heading fix. If an assertion fires, either the pipeline has a
defect that hand-running missed, or a branch of the new comparator
false-positives. **Both are findings and both block the gate**; the gate does
not ship until a non-zero result here is understood.

**P2 — omissions on 0–3 documents.**
Deliberately a wide band, because this is the first automated pass. The likely
source is `figuresWithAlt`, which `extract-docx-truth.mjs` has always extracted
and nothing has ever consumed.

**P3 — `figuresWithAlt` surfaces at least one document where the author's alt
text did not reach the PDF.**
The genuinely uncertain one. This comparison has never been run. I am not
confident; a zero here is as informative as a hit.

**P4 — exactly 7 documents report `oracle: 'engine-derived'`.**
The corpus is 24 `.docx` and 7 legacy `.doc`, and only the `.doc` files lack
readable OOXML.

**P5 — all 31 still convert.**
The gate is new and refuses on assertion. If P1 holds, delivery is unchanged at
31/31. A drop here means the gate is refusing documents that were fine.

**P6 — no heading-level assertion (2.4.10) fires.**
Stated separately because it is the newest branch and the one most likely to
misfire. The five real documents whose headings start at H2 or skip levels are
carrying **their own author's** hierarchy; the pipeline transcribes it, so
fidelity must read those as a faithful match and leave them to the existing
`needsIn` punch item. If this branch fires on those documents it is confusing
"the source is wrong" with "we changed it" — the exact confusion
`source-fidelity.ts` documents itself as unable to detect.

## What this instrument cannot see, stated before it is asked to

**A source whose own structure is wrong.** The `newcastle` case — six headings
that were a centred masthead, one of them a street address — is transcribed
faithfully, so this reports a match, because it *is* one. Counting that as
covered would be the same over-claim the record keeps catching.

How often that happens across the 31 is the measurement that decides whether a
source-quality instrument is worth building. It is scored by hand in the results
section.

<!-- RESULTS BELOW THIS LINE -->

---

# Results

**Measured 2026-08-31**, 31 real municipal Word documents through
`convertSourceToPdf` — the shipping pipeline, not a harness reimplementation —
scored by `checkFidelity` exactly as a production conversion computes it.
Harness: `experiments/document-remediation/measure-source-fidelity.mts`.

**The predictions were scored against a FIRST run that found four defects in
this instrument. Those are reported first, before the numbers, because three of
the five assertions the first run produced were my bugs and one was my
misclassification.**

## The first run, and what it caught

| | first run | after the fixes |
|---|---:|---:|
| assertions | **5**, across 4 documents | **0** |
| documents delivered | 31 | 31 |

### 1. `\b` counted table cells as tables — my bug, and the spike's

`/<table:table\b/` puts a word boundary between `table` and the hyphen of
`table:table-cell`, so it matches **every cell, row and column**. r09's single
real table read as **24**, and the comparator reported a 23-table loss that
never happened. `<text:list\b` had it too — 26 against a true 10.

**The same defect was live in
`experiments/document-remediation/extract-docx-truth.mjs`.** Fixed the same day,
along with the identical image-only figure filter described next. Two published
numbers moved: **real-corpus tables 29/31 → 31/31 and figures 30/31 → 31/31**,
restated with a banner in
[remediation-test-2026-08-27-results.md](remediation-test-2026-08-27-results.md).
Headings (31/31) and lists (27/31) are unchanged — `listItems` is what fidelity
compares and `<text:list-item\b` has no hyphenated sibling, so the list numbers
were never touched by it. The campaign's `.docx` documents are unaffected
throughout; that path reads OOXML and never used these regexes.

Fixed here with the `[ >]` idiom already used for `<w:tbl`.

### 2. A drawn shape is a figure — my bug

r09 is a `.doc` whose only graphic is a `draw:custom-shape`: a vector shape,
with **no binary image data anywhere in the file**. The export tags it as one
honest `/Figure`. A frames-containing-`draw:image` count read that as the
pipeline inventing a graphic the author never placed — precisely backwards. The
author drew it.

The flat-ODF reader now counts `draw:custom-shape` and embedded OLE objects
alongside raster images.

### 3. Heading levels are an omission, not an assertion — my misclassification

Every level difference in the corpus is one of exactly two things, and **neither
is ours to fix**:

- **The PDF format ceiling.** Numbered heading structure types stop at H6.
  Three documents (r21, r24, r26) declare a Word outline level 7 at the same
  position, and the exporter clamps to H6 because there is nothing else to
  write. **Maximum delivered heading level across all 31 documents is 6.**
- **The exporter re-levelling.** r09's table-of-contents heading leaves as H1
  and arrives as H2.

The gate exists to catch **fabricated existence** — a table, a figure, a
language claim that is not in the source. A level difference fabricates nothing:
the same headings arrive carrying the same text at a different depth. Refusing
delivery would withhold a sound document for a defect with no remedy, and it
would contradict the product's own vocabulary, where `needsIn` already treats
heading depth as a decision for a person rather than a blocking defect.

Reclassified as an omission: on the punch list, never silent, never a refusal.

### 4. A weaker oracle may inform, never gate

`engine-derived` is LibreOffice's reading of a legacy `.doc`, and its own
documentation says it grades the export half only. Letting it refuse a delivery
lets a second-hand reading block a sound document — r09 above is exactly that
case. Findings from an engine-derived reading are now always reported as
omissions.

**This was a classification change made after seeing data, and it is recorded as
such.** The justification is that the gate's subject is fabricated existence,
not degraded precision; the consistency argument with `needsIn` is what makes it
principled rather than convenient.

## Predictions, scored

| | prediction | result | |
|---|---|---|---|
| **P1** | zero assertions across 31 | **0** — after four instrument fixes; **5 on the first run** | **miss, then hit** |
| **P2** | omissions on 0–3 documents | **5 documents** | **MISS** |
| **P3** | ≥1 document where source alt text did not reach the PDF | **0** | **MISS** |
| **P4** | exactly 7 report `engine-derived` | **7** | hit |
| **P5** | all 31 still convert | **31/31, zero refusals** | hit |
| **P6** | no heading-level assertion fires | **fired on 4 documents** | **MISS** |

Three misses and one that only passed after the instrument was corrected. P6 is
the useful one: it predicted the newest branch was the most likely to misfire,
and it did — which is why it was registered separately.

**P3's miss is informative rather than disappointing.** The corpus carries **6
source figures across 5 documents**, and only two documents (r16, r17) have alt
text on either side — both preserved 1→1. There was almost nothing for this
comparison to find. A bigger claim would need a figure-bearing corpus.

## What the instrument found that nobody knew

**Five list items are lost on export, on three documents, consistently.**

| | source `numPr` | delivered `LI` |
|---|---:|---:|
| r21 | 74 | 69 |
| r24 | 66 | 61 |
| r26 | 61 | 56 |

Localized, and **verified on all four documents**: the import is faithful and
the export is not. Each flat ODF carries exactly its source's item count (74,
66, 61, and r02's 43); each exported PDF carries fewer (69, 61, 56, 42). Not
tracked changes, not `numId="0"`, not empty paragraphs, and none of the items
sit inside tables — all four excluded by measurement.

Root cause unprobed, and stopped here per the working agreement's
three-attempt rule. It is a real content loss that no instrument in this project
could see before today, and it is now reported on the punch list of every
affected delivery.

r02 loses one list item the same way (43 → 42, engine-derived), and is included
in the four above.

## Where the corpus stands

- **31/31 delivered**, zero refusals, zero assertions.
- **26/31 fully faithful**; 5 carry omissions, every one itemised.
- **7/31 read `engine-derived`**, exactly the legacy `.doc` files.

## The escalation measurement

The trigger registered in the plan: **how many of the 31 carry source structure
that is itself wrong** — the case this instrument is structurally blind to,
because it reports a faithful match when we transcribe a bad source faithfully.

**Not scored in this pass.** Scoring it means reading 31 municipal documents by
hand against `legal-standard.md`, and doing it badly would produce exactly the
kind of number this project keeps having to retract. It is the next piece of
work, and it is what decides whether Path 4 (a local model as a source-quality
checker) is worth an afternoon.

What can be said from the automated pass: the three H7 documents and r09's
contents heading are all cases where **the source's own hierarchy is unusual**,
which is weak, indirect evidence that source quality is worth measuring. It is
not evidence that a model would help.

---

# Addendum, 2026-08-31 — three more defects, found by review

The section above records four defects the **first measured run** found in this
instrument. Code review of the same diff found three more. Worth recording
separately, because it is a third detection channel and it caught things the
corpus could not.

**Two of the three caused a false `422`** — the gate refusing a document that
was fine. For a feature built to stop the pipeline claiming what the source
never said, inventing a disagreement out of two readings of one file is the
worst available failure.

## 1. Two language parsers, one file

`sourceTruthFromDocx` read the language as "the first `w:lang` anywhere in
`styles.xml`". `docxDeclaredLanguage` — which decides what `Finish` writes as
`/Lang` — reads the `w:lang` inside `<w:docDefaults>`, falling back to a
majority vote over body runs. The gate then read the disagreement as an
invention.

Two shapes, both proved with fixtures:

| | `Finish` writes | this reader read | verdict |
|---|---|---|---|
| no `styles.xml`, `w:lang` on a body run | `es-ES` | `null` | *"declares a language the source never did"* → 422 |
| `docDefaults` silent, a style declares `fr-FR`, runs `en-US` | `en-US` | `fr-FR` | *"declares a different language"* → 422 |

**The corpus could not have caught this.** All 31 real documents carry
`w:lang` in `docDefaults` as the first occurrence in `styles.xml`, so both
rules agree on every one of them.

Fixed by calling `docxDeclaredLanguage`. This is the failure
`extract-docx-truth.mjs` already records — *"seven inventions that were two
parsers disagreeing about one file"* — which the flat-ODF path here avoids by
taking its language from the caller, and which the OOXML path reintroduced.

## 2. The punch list said the same thing twice, and one copy was wrong

`withFidelity` appended omissions with no filter for criteria `needsIn`
already voices. On r21, r24, r26 and r09 the client got two 2.4.10 items, and
the pre-existing one gave **wrong advice**: *"Heading levels skip from H1 to
H6 — decide whether the author meant an H2"*, when the author had decided
already, writing a Word outline level 7 that PDF has no heading type to carry.

Fixed by replacement rather than suppression: when fidelity produces a 2.4.10
item it drops `needsIn`'s, because the instrument that read the source knows
strictly more. Scoped to 2.4.10 alone — the two vocabularies also share
`1.3.1`, about different subjects, and both of those must survive.

Measured effect: those four documents go from `needs: 3` to `needs: 2`. No
other document changed.

## 3. VML shapes that draw without an image — confirmed, and wider than flagged

Review called this plausible by symmetry with r09's `draw:custom-shape`.
Measured through real conversions, it is confirmed, and the shape-only reader
was missing more than suspected:

| fixture | source read | delivered `/Figure` | image XObjects | |
|---|---:|---:|---:|---|
| `v:shape`, preset geometry, no imagedata | 0 | 1 | 0 | **false 422** |
| `v:rect` | 0 | 1 | 0 | **false 422** |
| `v:oval` | 0 | 1 | 0 | **false 422** |
| `v:shape` containing only a `v:textbox` | 0 | 0 | 0 | correct |

`v:rect` and `v:oval` are not `v:shape` at all, so a shape-only reader could
never have seen them. The reader now counts every VML element that draws —
shapes, rects, ovals, lines, roundrects, polylines, curves, arcs — while
excluding textbox-only shapes (measured: they produce no `/Figure`) and
`v:shapetype` (a preset declaration that draws nothing). After the fix all
four fixtures deliver.

## What the three have in common

All three were invisible to the 31-document corpus, and all three are cases
where **two readings of the same document disagreed** — two language parsers,
two heading-level vocabularies, and a source enumeration narrower than the
export's. The corpus can only show a disagreement that some document in it
actually triggers.

That is the same lesson as the restatement in
[remediation-test-2026-08-27-results.md](remediation-test-2026-08-27-results.md):
an instrument agreeing with itself is not evidence. Here the second opinion
came from a review reading the diff rather than from another instrument reading
the documents — a cheaper channel, and one that found what measurement could
not.

---

# Blind validation, 2026-08-31 — five runs against a population nobody tuned

Everything above was measured on the 31 real Word documents in
`experiments/document-remediation/real-word/`. That corpus is **Arm A — the
population the converter was iterated against** until heading fidelity reached
31/31 (`AGENTS.md:419`). Zero assertions there is close to a tautology, and it
was quoted in this document as though it were independent evidence. It is not.

The honest test is the blind corpus: nine real Word documents from hosts
disjoint from every training manifest, hash-locked, which the pipeline had never
seen. The bytes are gitignored and local to another worktree, so the runs were
executed there against this branch's `sourceTruthFromDocx` and `fidelityDefects`
read verbatim. **A prediction was registered before every run.**

## What five runs found

| run | assertions | what it cost, or would have |
|---|---:|---|
| 1 | **3** | would have refused 3 of 9 sound documents |
| 2 | 0 | `basedOn` unread; one over-fire mislabelled `omission` |
| 3 | 0 | `TOCHeading` over-reach, spurious punch item on 2 of 9 |
| 4 | 0 | 5 findings on 5 documents, none spurious |
| 5 | 0 | **3 findings on 3 documents** |

## Eight source dialects, and the direction that never reversed

Every false refusal came from **the source reader being short** — never once
from the pipeline inventing anything:

1. VML `v:imagedata`-only, missing OLE-embedded WMFs
2. `draw:custom-shape` on the flat-ODF path (r09)
3. `v:rect` / `v:oval`, which are not `v:shape` at all
4. style-level `w:numPr` — blind r34 read 13 against 93 delivered
5. heading styles whose id is not the literal `HeadingN`
6. `w:basedOn` inheritance — blind r28 read 9 against a true 11, and the
   under-count **inverted** a lost heading into an invented one
7. `w:numId="0"`, the removal marker — **the only dialect pointing the other
   way**, inflating the source read rather than shortening it
8. an unexplained residual of 1 item on r34 and 2 on r33, with no structural
   cause found. Left unchased: below the noise floor of what it would protect.

**That record is the argument for the count rows not gating.** A count
comparison's source side is a lower bound; a lower bound compared against a
complete reading cannot carry a refusal. The decision was made after run 1 and
vindicated by run 3, where a dialect that would have refused two more sound
documents arrived *after* the gate had stopped depending on it.

## A correction to the export-loss finding above

The section above reports five list items lost on export on r21, r24 and r26,
localized to the export half. **That finding stands** — those three documents
carry **zero** `w:numId="0"` removal markers, checked directly, so their loss is
not the reader's.

**But its corroboration is weaker than this document implied.** Two blind
documents that looked like the same defect were not: r23 shrank 56 → 50 and r32
shrank 59 → 49 once the removal marker was handled, and **both shrinks equal
their removal-marker count exactly** — 6 and 10. Both are now clean. What
survives on the blind nine is r33 −2 and r34 −1: three items across nine
documents, against four documents losing five each on Arm A.

So "the export drops list items" rests on the tuned corpus. It is not
contradicted by the blind one, but neither is it much supported. **If that
belief ever justifies a product decision, it rests on the 31 alone**, and this
line is here so nobody has to rediscover that.

## The methodological point

A calibration error does not announce itself by being large. r34's single-item
discrepancy and r23's six-item one had the same cause, and the small one was the
only reason the large ones were ever found — the six and ten looked plausible
because they matched the magnitude of a real defect measured elsewhere.

Chasing the one-item outlier over a reassurance that it was within range is what
turned two false findings into two clean documents.

## The blind nine are spent, and that limits what may be claimed

Four of the reader's fixes were diagnosed from those documents:

| dialect | diagnosed from |
|---|---|
| style-level `w:numPr` | r34 |
| `w:basedOn` inheritance | r28 |
| `TOCHeading` over-reach | r23 and r30 |
| `w:numId="0"` removal marker | r34's one-item residual |

**So the blind nine are now training data for the fidelity reader, exactly as
the 31 are training data for the converter.** That is the cost of having used
them, not a mistake in using them, and the run-4 and run-5 numbers remain true
statements about those documents.

But it draws a hard line under what may be claimed:

- **Run 1 is the blind measurement, and it is the one that carries weight.**
  Three assertions on nine documents the reader had never seen — that is the
  evidence the design decision rests on, and it was available exactly once.
- **Runs 2 through 5 are fit-then-confirm.** Each ran against documents the
  reader had just been corrected against. Useful, and not independent.
- **"0 assertions on a blind population" is no longer a claim this reader can
  make**, because it no longer has one. Both corpora have been used to fix it.

The `S5`/`T5` predictions — *no document gains a finding* — were the guard
against fitting, and both held. That is worth something. But "we guarded against
overfitting and the guard held" is a weaker statement than "we measured it on
documents it had never seen", and only the second was available at run 1.

**Nothing here needs a fresh corpus to land.** The gate is narrow by
construction: count rows inform and never refuse, so a reader that is still
incomplete costs a punch item, never a delivery. A completeness *number* is what
would need new documents. `blind-corpus/harvest.mjs` takes a names file and
refuses training-set domains and byte-identical files, so a fresh handful of
municipal `.docx` is cheap when somebody needs one.

**Read that as the standing condition on this instrument:** its safety rests on
the gate's shape, which was measured; its completeness rests on nothing
independent, and should not be quoted as though it does.

---

# Re-measurement on master, 2026-09-11 — predictions

**Registered before the run**, per [working-agreement.md](working-agreement.md).
Results are appended below in a second section once measured; nothing above the
results line is edited afterwards.

## Why measure again

Everything above was measured on 2026-08-31 against the tree at `545bba7`. That
work then sat uncommitted for ten days while master moved underneath it, and is
now integrated. Two things changed that this instrument depends on:

- **The pipeline.** Master added roughly 2,700 lines across the same files —
  the declared-answers channel, a second `Finish` pass that writes what a person
  declared, an identifier pass, clause routing, font embedding. The conversion
  these numbers describe is not the conversion running today.
- **The instrument itself, twice, today.** `sourceTruthFromDocx` now takes its
  language through `languageToCarry`, because master inserted that transform
  between the parser and `Finish` and the two sides had silently stopped
  agreeing. And the gate's reference is now the source *plus* what a person
  declared, because without it an operator answering the 3.1.1 language ask had
  their document refused — the instrument reading a human transcription as the
  pipeline inventing a language.

The condition set above still governs: **the gate does not ship until a
non-zero assertion result is understood.** The first run produced five
assertions and took four instrument fixes to reach zero, so a clean result here
is not the expected outcome — it is the one that has to be earned again.

## Predictions

**R1 — zero assertions across all 31 documents.** The export has never been
shown to invent structure, and the two instrument changes above both move in
the direction of *fewer* spurious assertions. Confidence moderate, not high:
the same prediction missed on the first run.

**R2 — the list-item loss is still there: r21 74→69, r24 66→61, r26 61→56,
r02 43→42.** Nothing in the ten days of pipeline work targeted the export's
list handling, and the loss was localised to it. A change here would be news in
either direction.

**R3 — omissions on 5 documents, the same five.** Weakly held. The alt-text and
caption work master landed could move `figuresWithAlt` on either side.

**R4 — exactly 7 documents report `oracle: 'engine-derived'`.** The corpus is 24
`.docx` and 7 legacy `.doc`, and only the `.doc` files lack readable OOXML. This
one is arithmetic, not judgement.

**R5 — 31/31 still convert, zero refusals.** A drop means the ten days of
pipeline change broke a conversion that used to work, which would be a finding
about master and not about fidelity.

**R6 — no language row fires on any document.** New, and registered separately
because it is where today's fixes landed. `languageToCarry` on both sides
should make source and delivered agree on every junk tag in the corpus. If one
fires, the two parsers have drifted again somewhere I have not looked.

## What this run does not measure, stated before it is asked

The harness drives `convertSourceToPdf` and compares what comes back. **It does
not exercise the answers channel** — no answers exist for these documents — so
the path where today's worst defect lived is covered by
`tests/api/document-conversion-fidelity-gate.test.ts` and the domain tests, and
by nothing on real bytes. For a corpus carrying no answers the harness and the
shipping gate judge the same structure, which is verifiable in
`remediateWordBytes`: `structure` is reassigned only inside the declared-answers
branch. That makes this run representative of the no-answers case and silent
about the other one.

# Re-measurement on master, 2026-09-11 — results

31 documents, **31 converted, 0 refused, 0 assertions**, 7 with omissions, 7
`engine-derived`. The harness exits 0, which is the shipping condition the
first section set: **the gate ships.**

## Predictions, scored

| | prediction | result | |
|---|---|---|---|
| **R1** | zero assertions across 31 | **0** | hit |
| **R2** | the list-item loss still there, same four documents | r21 74→69, r24 66→61, r26 61→56, r02 43→42 | hit |
| **R3** | omissions on 5 documents, the same five | **7 documents** | **MISS** |
| **R4** | exactly 7 `engine-derived` | **7** | hit |
| **R5** | 31/31 convert, zero refusals | **31/31, 0** | hit |
| **R6** | no language row fires | **none** | hit |

R6 holding is the narrow one worth naming: it is the row that was refusing
documents this morning, and the row whose two parsers had drifted. Neither
fires now on any of the 31.

## R3's miss is the finding

Two documents carry an omission that the 2026-08-31 run did not report, and
they are not the same kind of thing.

**r15 loses an entire list: 0 list items delivered for 6 in the source.**
Every loss recorded above was partial — five items of seventy-four, one of
forty-three. This is all of them. It sits in the same 1.3.1 row as the others
and is a larger failure than any of them, on a document that reports no other
defect. Root cause unprobed; recorded here rather than chased, per the
three-attempt rule.

**r09 and r16 report heading DEPTH, and the cause is ours.** Their detail lines
read "arrived at a different depth from the source, first at heading 2
(delivered H2, source H3)" — the delivered document is *shallower* than the
source. That is `renumberHeadings: true` in `convert.ts`, the standing 7.4.2
policy whose own comment says the exporter "parks the author's outline wherever
its style mapping lands (a flat H2 or H3 ladder on real documents), and
re-ranking it onto a gapless ladder carries the author's own level
distinctions". **That policy landed in master after this instrument was last
measured**, so the 2026-08-31 run could not have seen the interaction.

So the instrument is reporting a deliberate, user-approved transformation as a
divergence. It is not wrong — the delivered document really does differ from
the source — and it does not refuse anything, because a count row is an
omission and omissions inform. But five of the thirty-one documents now carry a
punch item describing a change this product made on purpose, and via
`withFidelity`'s 2.4.10 supersession that item **replaces** the heading
question `needsIn` would otherwise have asked.

**Left as a decision, not resolved here.** Suppressing it means teaching the
comparison to expect the re-rank — the `expectedAfter` idiom, and the same
shape as this morning's declared-language fix. Keeping it means a client is
told their H3 ladder was promoted to H2, which is a true and material fact
about the document they are being handed, and which nothing told them before.
Both are defensible; neither is a bug, and building the suppression on a guess
about which is wanted would be the speculative work this project cuts.

## What this run still does not establish

Everything the predictions section said before the run. The answers channel is
not exercised — no answers exist for these documents — so the declared-language
path is held by tests and by nothing on real bytes. And the corpus is the one
the reader has been corrected against; the completeness caveat from the blind
validation above stands unchanged.

# Correction, 2026-09-11 — the list-item loss was never a loss

Appended rather than edited above, per this document's own rule. **Everything
the sections above say about list items being dropped on export is wrong, and
the error is in this instrument's source reader, not in the pipeline.**

## What was actually happening

`sourceTruthFromDocx` counted a paragraph as a list item when it numbered —
inline `w:numPr`, or a style definition carrying one — and separately pushed a
heading level for the same paragraph. Nothing stopped one paragraph being
counted as both. A **numbered heading** — `Heading1` whose style definition
carries `numPr`, giving "1. INTRODUCTION", "2. SCOPE" — is exactly that
paragraph, and municipal documents are full of them.

The delivered document was right all along. A numbered heading exports as
`/H1` with its number in the text, which is what PDF/UA asks for; it is not a
list and is not tagged as one.

## The evidence

Counting, per document, how many paragraphs the reader classified as **both** a
heading and a list item:

| document | source items | delivered | recorded "loss" | heading/item overlap |
|---|---:|---:|---:|---:|
| r15 | 6 | 0 | 6 | **6** |
| r21 | 74 | 69 | 5 | **5** |
| r24 | 66 | 61 | 5 | **5** |
| r26 | 61 | 56 | 5 | **5** |

**The overlap equals the loss on every affected document.** r15 is the pure
case — every one of its list items is a numbered heading, so the count fell to
zero and the client was told every list had been lost.

## Re-measured with the reader fixed

31 documents, 31 converted, 0 refused, **0 assertions**, **6** with omissions
(was 7). Every 1.3.1 list-item omission on a `.docx` is gone: r15 is clean,
and r21/r24/r26 now read 69→69, 61→61, 56→56 against their sources. What
remains on those three, and on r09 and r16, is the 2.4.10 heading-depth item
that the standing `renumberHeadings` policy produces — unchanged, and still the
open decision recorded above.

## What this revises, and what it does not

**Revised.** "Five list items are lost on export, on three documents,
consistently… a real content loss that no instrument in this project could see"
— the headline finding of the 2026-08-27 campaign, and the sentence this whole
instrument was justified by. There was no loss. The campaign's own check —
"each flat ODF carries exactly its source's item count" — was true and
consistent with this: ODF wraps a numbered heading in `text:list-item` as well,
so the intermediate really did carry 74. The measurement was sound; the
interpretation was not.

**Not revised.** `r02` still reads 43→42. It is a legacy `.doc` read through
the flat-ODF oracle, which this fix does not touch, and one item is unexplained.
Stopped there rather than guessed at.

**The instrument's value is not revised either, and it is worth being precise
about why.** It was built to catch the pipeline claiming what a source did not
say. It has now caught its own reader doing exactly that — a false claim about
a client's document, found because the comparison was run again on real bytes
rather than trusted. That is the instrument working, on itself.

## The same shape on the legacy `.doc` path — looked for, not found

Raised by review over this correction: `sourceTruthFromFodt` counts
`text:list-item` and `<text:h>` independently and was NOT changed, and ODF
wraps a numbered heading in `text:list-item` — so the double-count should
exist there too.

Measured rather than reasoned about. Three of the seven `engine-derived`
documents carry headings, and every one agrees exactly:

| document | source headings | source items | delivered items |
|---|---:|---:|---:|
| r09 | 6 | 16 | 16 |
| r13 | 9 | 0 | 0 |
| r27 | 16 | 106 | 106 |

No inflation on any document that could show it. **Recorded as a latent risk,
not fixed**: a fix would have to detect a `<text:h>` nested inside a
`text:list-item` wrapper, and there is no failing document to prove it against
— building it would be guessing at a shape this corpus has never produced.

**It also does not explain r02.** r02 reports **zero headings** and still reads
43→42, so whatever costs it one item, it is not a heading counted twice. That
remains open, and remains the one genuine unexplained discrepancy in this
corpus.

# r02 chased, 2026-09-11 — a structural wrapper, not a lost item

The one discrepancy the correction above left open. It is the same class as the
other two, a third time: **the source reader counting something structural as
content.**

## What it was

r02's flat ODF carries 13 lists and 43 `text:list-item`; the delivered PDF
carries 12 lists and 42 items. Not one item missing from a list — one whole
single-item list missing.

Two of the 13 source lists hold exactly one item, and they are not the same
shape:

| list style | the item's children | its own text | nested |
|---|---|---:|---|
| `WW8Num3` | `[text:list]` | **0 chars** | a 6-item list |
| `WW8Num4` | `[text:p, text:list]` | 40 chars | a 2-item list |

`WW8Num3`'s item is nothing but a nested list. That is how ODF represents a
list which starts **indented** — an outer wrapper with no parent bullet. It has
no paragraph, no text, and nothing a screen reader could announce, so the
export emits no `LI` for it. Correctly: there is nothing to tag.

r02 carries exactly one such wrapper, and 43 − 1 = 42 is exactly what was
delivered. `WW8Num4` is a real item that happens to have a sublist, and it *is*
delivered — which is why the fix keys on the shape and not on "a list with one
item".

## Fixed and re-measured

`sourceTruthFromFodt` now subtracts items whose only child is a nested list.
Across the 31 documents: **31 converted, 0 refused, 0 assertions, 5 documents
with omissions** (was 7 before either fix, 6 after the first). r02 reads 42→42.
Nothing else moved — r27 still 106→106, r09 16→16, r05/r07/r20 6→6.

**Every 1.3.1 list-item omission in this corpus is now gone.** All five
remaining omissions are the 2.4.10 heading-depth item produced by the standing
`renumberHeadings` policy, which is the open decision recorded above and not a
defect.

## What three for three means

Every "content loss" this instrument reported on real documents has turned out
to be this instrument miscounting the source:

1. numbered headings counted as list items (r15, r21, r24, r26),
2. and a structural list wrapper counted as an item (r02).

The pipeline has still never been shown to drop content or to invent it — 0
assertions on every run. That is worth stating plainly, because the reverse was
recorded as fact for two weeks. The comparison is only as good as the reading
behind it, and the reading is the half that has been wrong every time.

# The heading rung, 2026-09-11 — the open decision dissolved

Recorded above as a decision for a person: our own `renumberHeadings` policy
showed up as a 2.4.10 divergence on five documents, and the choice looked like
"suppress it, or tell the client their H3 ladder became H1". **It was neither.
The comparison was asking the wrong question.**

## What the policy actually does

`renumberHeadings` (`Finish.java:757`, passed only on the conversion lane) is an
**order-isomorphism**: it collects the distinct heading levels present, sorts
them, maps them onto 1, 2, 3…, and returns early when that is already the
identity. An author's `{3, 5, 7}` is delivered as `{1, 2, 3}` — every
distinction they drew intact, and the absolute numbers changed on purpose.

The fidelity row compared absolute depth. So it fired **precisely when the
re-rank did its job**, reporting the one property the pipeline is designed to
change while ignoring the one it is designed to preserve. Worse, the item was
unresolvable: no edit to the client's document could ever bring the ladders into
agreement, and via `withFidelity`'s supersession it displaced the heading
question `needsIn` would otherwise have asked.

## The rule now

Both ladders are normalised to **rungs** before comparison — the same rule
`renumberHeadings` applies, named on both sides. The question becomes the one
that survives the policy: *did the author's distinctions reach the reader?*

The format ceiling dissolves with it, without special-casing: a Word outline
level 7 clamping to H6 is two rungs against two. A clamp that genuinely
**merges** — levels 7 and 8 both landing on H6 — is three rungs against two and
is still reported. That case has its own test.

## Re-measured

**31 documents, 31 converted, 0 refused, 0 assertions, 0 omissions.** Every
document in the corpus is now fully faithful.

**A clean sweep is the result that should be trusted least, so it is guarded.**
An instrument that reports nothing is indistinguishable from one that cannot
report anything — which is the failure `fidelity-fires.test.ts` was written for
after a comparator went two whole experiments unable to see figure
under-tagging. That file proves every branch still fires, and
`document-conversion-fidelity-gate.test.ts` proves a forged divergence still
reaches a 422. Twenty-eight cases, all passing. The silence is the corpus, not
the instrument.

## What the sweep means

Four "content losses" were reported on real documents across two weeks. All
four were this instrument miscounting or mis-comparing its own source:

1. numbered headings counted as list items — r15, r21, r24, r26
2. a structural list wrapper counted as an item — r02
3. heading depth compared where the pipeline re-ranks by design — five documents

**The pipeline has never been shown to drop content or to invent it.** That was
true on the first run and every run since; what changed is that the reader
finally agrees.

# Correction, 2026-09-12 — what "nothing on real bytes" left out, and now covers

Appended, per this document's rule. Two sections above say the answers path is
held "by nothing on real bytes". **That overstated the gap.**

`tests/integrations/documents/toolchain/soffice-remediate-route.test.ts` has put
a person's **figure description** through a real LibreOffice conversion and a
real JVM since before the gate existed, and since #240 that request has passed
through `checkFidelity`. A 200 there has meant no assertion fired. What was
genuinely uncovered was the **declared language**, the path where the gate's
worst defect lived: every case for it mocked the conversion.

That file now has the case. Building it turned up something the mocks could not:
**LibreOffice will not write a `.docx` that declares no language.** A seed with
none, `none`, or an unparseable tag came out as its locale's `en-US` (`zxx`
came out as `zxx`, a real tag). A LibreOffice-made fixture therefore cannot reach
the declared-language branch at all. The test takes every `w:lang` out of
LibreOffice's own output and re-zips the rest untouched. Before it was trusted,
the `declaredTruth` substitution in `remediateWordBytes` was disabled, and the
test refused delivery with `fidelity-assertion` on 3.1.1. That is the defect
that shipped.

One qualification to "every document in the corpus is now fully faithful" above.
The harness counts assertions and omissions and prints `faithful` for a document
with neither. It does not count `unverified`, the third kind, which `withFidelity`
also puts on the punch list. From the stored per-document rows, no count on any
of the 31 delivers more than its source. The rows record only `hasTitle`, not
title values, so the one `unverified` finding they cannot rule out is a title
that differs from the source on a `.doc` document. The sweep stands, with that
exception named.
