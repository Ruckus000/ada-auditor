# Documents that arrive already tagged

**Date:** 2026-08-24 · The nine real municipal documents, each run down both
paths. No policy is chosen here; this records the evidence a policy would need.

## Why this was measured rather than decided

Five of the nine real documents arrived with a structure tree. `sturgis-agenda`
arrived tagged with 8,504 elements and **4** ua1 failures — four short of
conformance — and our pipeline re-tagged it into **27**. That looked like a
clear finding: do not re-tag what is already tagged.

It was a clear finding drawn from one document.

## Both paths

- **Path A** — current: OpenDataLoader re-tags, then captions → headings →
  tables → figures → lists → finishing.
- **Path B** — the same chain with OpenDataLoader skipped, operating on whatever
  structure arrived.

| | arrived | Path A | Path B |
|---|---:|---:|---:|
| **ua1 failures, the 5 tagged documents** | 3,131 | **51** | 1,132 |
| ua1 failures, all nine | 6,946 | **129** | 4,654 |
| conformant | 0/9 | 0/9 | 0/9 |

**Path A is 22× better on exactly the documents the sturgis case argued against
re-tagging.**

| document | arrived | Path A | Path B | |
|---|---:|---:|---:|---|
| `orono-fee-schedule` | 291 | **2** | 289 | re-tag wins |
| `tml-statutes-table` | 2,805 | **13** | 812 | re-tag wins |
| `lacity-clerk-misc` | 25 | **8** | 23 | re-tag wins |
| `newcastle-pc-hearing` | 6 | **1** | 4 | re-tag wins |
| `sturgis-agenda` | 4 | 27 | **4** | keep wins |

`sturgis-agenda` is not representative. It is the only tagged document that
arrived anywhere near conformance, and generalising from it would have cost
1,081 failures across the other four.

## And the structure half, which the failure count cannot see

Headings, tables and lists in the delivered file:

| document | Path A | Path B |
|---|---|---|
| `sturgis-agenda` | 84 headings, 4 tables, 57 lists | **0, 0, 0** |
| `orono-fee-schedule` | 40 headings, 4 tables, 11 lists | **0, 144, 0** |
| `tml-statutes-table` | 0 headings, 15 tables, 43 lists | **0, 1, 0** |
| `lacity-clerk-misc` | 8 headings | **0** |
| `newcastle-pc-hearing` | 0 headings | 6 headings |

**Path B delivers almost no structure on eight of nine documents.** What arrived
tagged was P-soup: five documents with 8,504, 1,255 and similar element counts
between them, and **six headings in total across all five**. It validates
because it claims nothing.

That is the trade in its clearest form so far. `sturgis-agenda` under Path B is a
90-page council packet that passes more of PDF/UA than it does under Path A, and
offers a screen-reader user no headings to navigate by. Under Path A it has 84
headings and fails 27 checks.

Recording only the validator score would have chosen Path B for `sturgis` and
called it an improvement. That is the conformance-equals-accessibility error
this spike has now documented four times, and it is why both halves are in the
table.

## What this supports

Re-tagging is right for four of five tagged documents and wrong for one, and the
one it is wrong for is the one that arrived nearly conformant. Any policy worth
having keys on **how close the input already is**, not on whether a structure
tree exists — and it needs more than five documents to set a threshold on.

`newcastle-pc-hearing` is the only real document that arrived with usable
headings, and Path A destroyed all six of them while removing five of its six
failures. One document is not evidence either, and it is noted here so it is not
lost.
