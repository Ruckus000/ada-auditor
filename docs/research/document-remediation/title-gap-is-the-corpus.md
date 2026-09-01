# The `7.1-9` title gap is the corpus, not the product

`7.1-9` — the XMP `dc:title` entry PDF/UA requires — is the largest single
blocker in the delivered corpus after alt text. It fails on **23 of 68 delivered
real documents**, and **10 of them fail nothing else**: one title away from
PDF/UA-1 conformance.

That made it the highest-value item in the remediation backlog by a factor of
three. It is not an item at all. **Twenty-two of the twenty-three would have
carried a title in production**, and the corpus is what removed it.

`[V]` `experiments/document-remediation/title-from-real-filenames.mts`.

## Why the corpus removes it

Every real document is stored and posted under a generated id — `n02.pdf`,
`r23.docx` — so that a filename cannot leak a hint to the product or to anyone
reading the results. That is the right call and it stays.

The title chain's last rung is `titleFromFilename`
(`src/domain/document-remediation.ts:1293`), whose whole safety is its junk
table: `JUNK_FILENAMES` refuses `doc1`, `untitled`, `final_v2`, scanner names,
and **bare ids** — `^[a-z]{0,3}[\d .]*$`. Every corpus id matches that last
alternative.

`[V]` Against the live pattern: `n02`, `r23`, `n50` refused;
`p36 alt placeholder word` and `2024 Budget Ordinance` accepted.

So the filename rung of the title chain **has never once fired on a real
document**, in any of the four campaigns. Every real document that reaches it
falls through to `no-heading-to-copy`, and the delivery reports an honest 2.4.2
gap for a document that would not have had one.

`[V]` End-to-end, on the planted rows where names are ours to choose:
`p07-cyclic-tree` derives a title from its filename and does **not** fail
`7.1-9`; `p03-nothing-to-title-with` reaches `no-heading-to-copy` and does. The
rung genuinely clears the clause.

## The measurement

For each of the 23 documents failing `7.1-9`, take the last path segment of its
harvest URL — percent-decoded, query stripped, which is what a browser download
and an operator upload both produce — and run the product's own
`titleFromFilename` over it. Imported, never reimplemented, so the answer comes
from the code that would derive the title.

| | documents |
|---|---:|
| delivered real documents failing `7.1-9` | 23 |
| a real filename would have titled | **22** |
| no title from any rung of the chain | 1 |

All **10** documents whose only residual is `7.1-9` are in the 22. Not one of
them is the exception.

## What that does to the headline

| | measured | production-equivalent |
|---|---:|---:|
| Word → PDF | 12/26 (46%) | **19/26 (73%)** |
| PDF → repaired | 2/42 (5%) | **5/42 (12%)** |
| combined real | 14/68 (21%) | **24/68 (35%)** |

The right-hand column is what the same 68 documents would have scored had they
arrived under the names their publishers gave them. **The corpus has been
understating conformance by 14 points, on every campaign, in a direction nobody
had measured.**

## What was NOT done, and why each would have been the trap

- **Posting a synthetic filename.** The obvious fix — have the runner send a
  plausible name — inflates every future score with our own authorship. A title
  we invented is exactly what `isPlaceholderTitle` and the junk table exist to
  refuse; manufacturing one at the door and then grading ourselves on it is the
  same conduct with an extra step.
- **Recording the real filenames in the keys.** They would then be committed,
  and the corpus notes are public. Document titles from named public bodies are
  content, and this campaign quotes structure only.
- **Loosening `JUNK_FILENAMES`.** It is not wrong. `n02` *is* a bare id, and
  refusing it is correct behaviour on a document actually named that. The rule
  is doing its job; the corpus is feeding it inputs no client would send.
- **Any product change at all.** Twenty-two of twenty-three documents state a
  title the product already knows how to read. There is nothing to build.

## What is left after it

**One document.** `n27` declares no title, carries no heading to copy, and its
real filename derives nothing either. That is a genuine 2.4.2 gap, correctly
reported, and the only mechanical source left — `docProps/core.xml` and the
first heading — are already in the chain ahead of the filename.

The `7.1-9` line in the backlog therefore reads: **+10 documents, zero code**,
and the work is a note in this file rather than a commit in `Finish.java`.

## Spent

The blindness on this question is spent — the 23 ids and their filename outcomes
are recorded above. Nothing about it was blind in the first place: filenames are
not answer keys, and no key moved.

The bias itself is **not** spent, and does not decay: every future campaign that
anonymises filenames will understate 2.4.2 and conformance by the same
mechanism, until either the runner posts real names — which it must not — or the
production-equivalent column is computed alongside the measured one. This script
is what computes it.
