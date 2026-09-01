# When the author typed "decorative" — results

Measured against [`decorative-declaration-predictions.md`](decorative-declaration-predictions.md),
committed in `a9bb693` before any product code changed. 148 documents, exit 0.
Counts and clause identifiers only.

## The scorecard

```
Disposition   core 43/43 hit · 0 refused differently · 0 delivered when a refusal was expected
Door          11/11 · 0 leaked · 0 wrong status
Punch items   0 missing · 2 unexpected (listed; a person decides)
Invented claims  0
Silent gaps   0 · 0 suppressed with nothing voicing them
Drift         0
Counts        2 off · 52 unverifiable
Conformance   0 not checked · 0 short of a compliant key
Key corrections  54 across 28 documents — 52 instrument defects, 2 scope changes
vs previous run: 0 fixed · 0 regressed · 0 still failing
```

**A green scorecard is not the evidence here, and could not be.** `ourCriteria()`
maps `needs` to `n.criterion` before `multisetDiff`, so item text is structurally
invisible to the scorer. What it proves is the *negative* half — that nothing
else moved.

## The measurement that chose the set

Over every `/Alt` string in the delivered real corpus that our F30 predicate
already refuses:

| | count |
|---|---:|
| refused `/Alt` strings | 173 |
| the literal word `decorative` | **153** |
| `spacer` | **0** |
| `blank` | **0** |
| everything else (paths, filenames, `image N`) | 20 |

**`spacer` and `blank` were refused by the registered rule, on evidence.** Rule 2
admitted them only if they occurred in a document that also used `decorative`;
they occur nowhere at all. That is the rule doing work rather than ratifying an
intuition, and a test drives the widened set and fails on it.

**Both carrying documents use ONE distinct string each** — byte-identical across
all 52 and all 101 figures. Rule 3 fired: this is a template convention, not 52
and 101 separate judgements.

That matters more than it first looks, because it makes a second reading live.
A bulk stamp applied to make a checker stop complaining is exactly as consistent
with those bytes as a considered declaration — it is the accessiBe move, in a
document we did not write. **The replacement sentence is true under both**, which
is why it was chosen over anything shorter:

> `described only as decorative (F30) — artifact it, or describe it`

If the figure is decorative, the mechanism is the artifact and the punch item now
names it. If the word was stamped on in bulk, a person still looks. The old
sentence — "write one" — was only ever right under the second reading.

## Predictions against outcomes

| registered | actual | |
|---|---|---|
| items whose sentence changes: 153, across exactly 2 documents | **154, across 3** | **WRONG.** See below |
| documents whose conformance changes: 0 | **0** | held — 16/78, Word 14/26, PDF 2/52 |
| punch-item criteria multisets: unchanged, every one | **0 moved** | held, verified per document |
| gap strings: unchanged | **0 moved** | held |
| existing tests broken: 0 | **0** | held — 131 passed untouched |
| `INSTRUMENT_VERSION` stays 11 | **11** | held |
| five promises hold; 0 regressed | all held, 0 regressed | held |

**The registered count was wrong and stays wrong on the record.** The 154th item
is on `p36-alt-placeholder-word`, the planted regression lock, whose spec row
carries a figure with alt `Decorative` — a row I read while planning and then
predicted around anyway. The prediction said "exactly 2 documents" without the
real-only qualifier the measurement had. It should have said 154 across 3.

Nothing about the change is wrong; the arithmetic in the prediction was. Editing
it after the run is the failure this apparatus exists to prevent.

`p36` is also the useful part of that miss: its criteria multiset did **not**
move — still three `1.1.1` — which is precisely the property the lock was
written to hold ("fail the run if the predicate is ever widened into a quality
judgement, or narrowed back into a presence check"). The sentence changed
underneath it and the lock stayed green, which is the whole design.

## What the change cost the header

Measured with `asciiJson`, the function that actually bounds the header, rather
than a reimplementation of it. A first pass here **did** reimplement the
escaping, double-encoded, and reported r05 as 302 bytes OVER budget — with no
trim marker anywhere in the summary to corroborate it. The contradiction is what
caught it.

| | items | before | after | headroom |
|---|---:|---:|---:|---|
| r05 | 104 | 13,382 | 13,079 | 618 → **921** |
| r04 | 54 | 7,277 | 7,121 | 6,723 → **6,879** |

Three bytes per item, 303 across r05. `SUMMARY_HEADER_BUDGET` was not raised and
did not need to be: correcting an instruction is not a licence to spend the
budget, and this one gives some back.

## What this did not do

**No conformance number moved, and none was expected to.** r04's residual is
`{5-1, 7.18.1-2, 7.2-43, 7.21.7-1}` and r05's is
`{5-1, 7.2-43, 7.21.4.1-1, 7.21.7-2}`. Neither has ever failed `7.3-1` — veraPDF
accepts these strings — so all 153 items were ours alone, and both documents were
several clauses away from conforming before this and are the same distance after.

Real conformance stands at **16 of 78**: Word 14/26, PDF 2/52.

**Not one item was removed.** The count, the criterion, and the gap string are
identical. `repair-results.md` records a temptation to soften a figure check to
report a better number and refuses it; the risk in this work was becoming that,
and the guard was saying so in `a9bb693` before the counts were visible.
