# The summary header is bounded

`AGENTS.md` recorded this as an open defect with the fix named: *"that is
HEADROOM, not a bound … The response contract is what needs fixing."*

## The defect

The whole remediation summary rides in `x-remediation-summary` because the body
is the PDF. Node's default `--max-http-header-size` is **16,384 bytes for the
entire header block**, and the summary carries one punch item per undescribed
figure, per unnamed form field — a list with no upper limit.

It has already broken a delivery once. A real municipal document with 101
undescribed figures produced a **22,743-byte** header, and every client on the
default rejected the whole response with `Headers Overflow Error`: the file
arrived, the punch list did not. That was patched by shortening two item
strings, which bought margin rather than a bound.

Measured before this change, the worst document sits at **13,212 bytes with
2,972 spare — about 23 items**. Every criterion added since has spent some of
it, including the two added this week.

## The change

`boundSummary` in `src/domain/document-remediation.ts`, applied in
`remediationResponse` — the single place the header is built.

Bounded at the transport, not where the summary is made, because the limit is a
property of this response and not of the vocabulary: the same summary handed to
any other consumer should be whole. The measure is injected, so the domain does
not need to know that the header is ASCII-escaped JSON where one CJK character
costs six bytes.

Three rules, in order:

1. **Every criterion keeps at least one item.** On the real document the items
   worth reading — the fonts item, the identifier item, the PDF/UA catch-all —
   sit at the END, behind 101 figure lines that differ only by their number.
   Truncating the tail would keep the hundred and drop the three.
2. **Then as many of the rest as fit**, in the order they arrived.
3. **Then one item saying how many are not shown.** Never a silent cap.

**Selection and ordering are separate steps.** The per-criterion picks come from
all over the list, and emitting them in selection order hoisted the PDF/UA items
to the front — silently reshuffling a client's punch list. A test locks it.

## What it does not bound

The punch list, which is the part that grows without limit and the part that
broke a delivery. The rest is counts, a title and the failing-clause list;
trimming those would change facts rather than shorten a list. A document whose
title and gaps alone exceeded the budget would still overflow — a different bug,
to be fixed where those fields are produced.

## Verification

`[V]` **97 documents, exit 0, every promise held, 0 regressed.** Disposition
42/42, doors 11/11, punch items **0 missing**, invented claims 0, silent gaps 0,
drift 0. r05 delivers all 104 items at 13,212 bytes, byte-identical to the
baseline, and **0 documents were trimmed**.

lint, typecheck, 1,906 unit tests. The bound itself is proved by tests that
drive 101, 500 and 5,000 items and assert the encoded size never exceeds the
budget — including a document whose single item is twice the budget.

## Two mistakes worth recording

**The budget was 12,000 first, and the blind test showed what that cost.**
I picked it so the corpus's worst document would cross the bound, reasoning that
a bound nothing reaches is a bound nothing has verified. Wrong twice: the
property is verified by unit tests that drive 5,000 items, so the corpus does
not need to exercise it — and at 12,000 the run reported **12 punch items
missing**, twelve of r05's figures dropped from a client's list to make room for
nothing. 14,000 leaves 2,384 of the 16,384 for the rest of the header block,
which is an order of magnitude more than the four headers this response sets,
and the worst real document fits whole.

**I validated the budget against the wrong artifact.** Before choosing 12,000 I
read `r05.key.json`, saw `needs: []` with `needsExact: false`, and concluded
that collapsing items could raise nothing. The scorer does not read the key
alone — it applies `corrections.json`, and r05 carries a `needs` overlay
expecting 101 `1.1.1` items. The blind test caught it; my reading of the key did
not. Checking the artifact instead of what the consumer actually consumes is the
same error as reading a `.class` file's source and assuming the build is fresh.

## The encoding is still the real problem

101 items each carrying one integer is a poor encoding, and the bound is a
safety net over it rather than a fix for it. One item per criterion naming the
range — *"Figures 1–101: alt text is a placeholder — write one for each"* —
would be smaller, more readable, and lose no figure identity.

**Not done here, and it is not a refactor.** The corpus expects one item per
figure, and that expectation is itself a product decision about whether the
punch list is a human's reading or a machine's work queue. Changing the
encoding means changing that decision and the keys that encode it, which is not
something to slip into a fix for a size limit.
