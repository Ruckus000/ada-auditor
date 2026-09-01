# The mechanical wave — results, including the run that failed

Measured against [`mechanical-wave-predictions.md`](mechanical-wave-predictions.md),
committed in `f1805b0` before the first run. **Two runs**, and the first is the
important one: it failed, correctly, and the failure is the best evidence this
apparatus has produced. Counts, ids and clause identifiers only.

## Run one: the corpus caught an invented claim veraPDF cannot see

`FAIL r34 — invented-structure: headings: key 0, reported 6.`

r34's RoleMap maps H1 and H3 to P: its H-named elements are paragraphs to
every reader. The renumber guard refused only the inverse case — a
custom-named element resolving INTO a heading — so the re-rank moved six
elements to H2, a name the map does not cover, and they became real headings
the author never wrote. **r34's veraPDF clause list did not move**: the
invented ladder was valid PDF/UA, and the only instrument that could see the
product claiming structure that is not there was the corpus's own counts
check. On the first change in this codebase that could have slipped past the
checker, the second instrument fired. That is the design working, and it is
why the scorecard's invented-claims line is never merged into any rate.

Fixed in `a8a8f27`: the remap is refused outright when any H-named element's
resolved type differs from its own `/S`. A fixture reproducing r34's shape
fails against the shipped class — renumbering to H2 exactly as r34 did — and
passes with the fix. 60/60 documents tests.

## Run two: predictions against outcomes

| registered | actual | |
|---|---|---|
| newly conformant: +5 exactly {n01, n08, n32, r22, n37} | **exactly those five** → 26/78 → **31/78** | held |
| `7.4.2-1` clears on n37, n50, w13 and nowhere else | held — n50's punch item gone, its 7.3-1 wall stands | held |
| `7.21.3.2-1` clears on n23, r13 only | held | held |
| planted rows: not one moves | **w13 moved — to conformant** | **WRONG as written.** See below |
| scorer fatals: 0 | 0 (run two; run one had the invented claim) | held after the fix |
| punch-missing noise: ~a dozen, all probe | **14, zero core** | held |
| five promises; drift 0 | all held; `vs previous: 1 fixed · 0 regressed` | held |
| n08 risk: least-verified of the four | n08 conformed — the bulk width pass was enough | held |
| contrast wobble risk | none observed — 1.4.3 movement zero | held |
| `INSTRUMENT_VERSION` | 11 | held |

**The predictions doc contradicted itself, and the contradiction stays.** One
row said `7.4.2-1` clears on w13; another said not one planted row moves. Both
cannot be true, and the run obeyed the specific row: w13 lost `7.4.2-1`,
earned `5-1`, and conformed — which is exactly what its regenerated key
expects and what the heading policy is for. The general row was written about
fonts and overreached. Recorded rather than reworded.

## Where the corpus stands

| | before today | after |
|---|---:|---:|
| real conformant | 16/78 (21%) | **31/78 (40%)** |
| Word lane | 14/26 | **22/26 (85%)** |
| PDF lane | 2/52 | **9/52** |

Three changes did it, none of which touched what a document says: the harness
stopped hiding real filenames (+10), exporter-seated heading ladders re-rank
onto H1 (+2 incl. w13's lane), and producers' named-but-never-embedded fonts
gained metric-proven Liberation programs (+4 incl. the CIDToGIDMap rider's
clauses).

The 14 `punch-missing` probe notes are keys whose `mustVoice: ["7.21.4"]`
models pre-embedding capability; per the standing protocol they stand, and the
independent checker is the record.

## What remains, priced

The Word lane's four holdouts: three blocked by figure descriptions (7.3-1, a
human), one by the language floor. The PDF lane's wall is unchanged in kind:
24 documents needing descriptions, 8 refused as untagged, 2 signed, 7 with no
declared language, and the judgement items now explicitly declined with their
prices in `AGENTS.md`. The mechanical backlog this wave set out to clear is
clear: nothing left in it survives its own price tag.
