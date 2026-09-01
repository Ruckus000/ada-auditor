# MCID reachability — the 7.1-3 population, measured with a calibrated instrument

The instrument `tree-coverage-declined.md` named and declined to fake: per
page, the MCIDs the content stream opens versus the MCIDs the structure tree
references, plus text-showing operators outside any marked content and inside
`/Artifact`, recursing Form XObjects once. Text operators only, by scope — the
probe deliberately does not count graphics items. Delivered documents, ids and
counts only.

## Calibration first — where the last instrument died

8 delivered real documents that do NOT fail `7.1-3` (pages 1–37):

| id | pages | MCIDs total/reachable | orphaned | orphans w/ text | untagged text ops |
|---|---:|---:|---:|---:|---:|
| n18 | 1 | 24 / 24 | 0 | 0 | 0 |
| n02 | 2 | 120 / 120 | 0 | 0 | 0 |
| r25 | 3 | 85 / 79 | 6 | 0 | 0 |
| n13 | 6 | 237 / 185 | 52 | 0 | 0 |
| n04 | 9 | 443 / 417 | 26 | 0 | 0 |
| n36 | 12 | 240 / 240 | 0 | 0 | 0 |
| n01 | 21 | 516 / 516 | 0 | 0 | 0 |
| r05 | 37 | 2,686 / 2,686 | 0 | 0 | 0 |

**Zero untagged text on 8 of 8.** Every orphaned MCID in the three imperfect
controls contains zero text — empty markers, not lost content. Where the
discarded proxy put its control at 0.56 against a 0.80 gate, this one puts it
at 1.00 on both measures. The population is interpretable.

## The population — 19 of 19 parsed, zero stream errors

Sorted by untagged-text ratio, untagged / (untagged + tagged):

| id | pages | MCIDs total | reach | orphaned | orph. w/ text | untagged | artifact | tagged | reach ratio | untagged ratio |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| r14 | 47 | 6 | 5 | 1 | 0 | 2,276 | 0 | 16 | 0.833 | **0.993** |
| r10 | 26 | 189 | 187 | 2 | 0 | 12,063 | 50 | 995 | 0.989 | **0.924** |
| n30 | 4 | 57 | 57 | 0 | 0 | 1,025 | 4 | 163 | 1.000 | **0.863** |
| r06 | 16 | 180 | 180 | 0 | 0 | 874 | 16 | 583 | 1.000 | **0.600** |
| n05 | 578 | 6,810 | 6,793 | 17 | 3 | 6,699 | 1,059 | 28,354 | 0.998 | 0.191 |
| n28 | 9 | 307 | 307 | 0 | 0 | 79 | 8 | 421 | 1.000 | 0.158 |
| n21 | 9 | 315 | 315 | 0 | 0 | 57 | 38 | 1,783 | 1.000 | 0.031 |
| n22 | 2 | 330 | 330 | 0 | 0 | 14 | 0 | 467 | 1.000 | 0.029 |
| r13 | 12 | 1,907 | 1,907 | 0 | 0 | 26 | 197 | 2,445 | 1.000 | 0.011 |
| n15 | 113 | 6,102 | 5,685 | 417 | 19 | 128 | 320 | 36,485 | 0.932 | 0.004 |
| n06 | 46 | 1,973 | 1,973 | 0 | 0 | 0 | 44 | 2,008 | 1.000 | 0.000 |
| n23 | 2 | 85 | 85 | 0 | 0 | 0 | 4 | 171 | 1.000 | 0.000 |
| n24 | 2 | 118 | 118 | 0 | 0 | 0 | 30 | 741 | 1.000 | 0.000 |
| n29 | 38 | 673 | 658 | 15 | 13 | 0 | 299 | 6,205 | 0.978 | 0.000 |
| n33 | 14 | 309 | 308 | 1 | 1 | 0 | 30 | 1,174 | 0.997 | 0.000 |
| r09 | 16 | 2,421 | 2,379 | 42 | 42 | 0 | 18 | 2,454 | 0.983 | 0.000 |
| r11 | 9 | 1,034 | 1,029 | 5 | 4 | 0 | 50 | 1,001 | 0.995 | 0.000 |
| r15 | 45 | 2,955 | 2,955 | 0 | 0 | 0 | 179 | 3,026 | 1.000 | 0.000 |
| r17 | 53 | 4,824 | 4,824 | 0 | 0 | 0 | 183 | 12,556 | 1.000 | 0.000 |

## The shape

**The failure lives in the content stream, not in the tree walk.** Tree
reachability is ≥0.93 on 17 of 19; the only low raw number is 5 of 6 MCIDs.
Three populations:

1. **Decorative trees — 3, arguably 4** (r14, r10, n30; r06 midway). A
   non-empty tree over pages it essentially does not describe. A
   tree-emptiness floor would catch r14 alone; only a content-side ratio sees
   the others.
2. **Trees with gaps — 2** (n05, n28). Mostly tagged, one material untagged
   block.
3. **Fully-tagged text — 13.** Nine at exactly 0.000. Six of these carry
   orphaned MCIDs WITH text (r09: 42 — tagged content the tree forgot); the
   five pure zeros fail `7.1-3` on non-text items — paths, images, shading
   outside `/Artifact` — which the probe deliberately does not count. n24, one
   of `tree-coverage-declined.md`'s "90/121 untagged runs" exemplars, is in
   this group: its text is fully tagged.

The proxy post-mortem: of its five sub-0.25 tail documents, four confirmed,
and **n22 exonerated** (97.1% of its text ops tagged). Declining to read the
discredited tail was correct in the specific, not only the principle.

## The decision this informed

**No standing 7.1-3 policy** — taken by the user with these tables in front of
them. Artifacting the untagged graphics is content-stream surgery worth about
one document (n33) in the direction twice refused; refusing decorative trees
un-delivers four documents (r14, r10, n30, r06) and conforms none. Revisited
when a client engagement makes the trade concrete.

One curiosity noted, not pursued: n28 carries 31 tree references to MCIDs that
exist in no content stream — the only document with phantom references.
