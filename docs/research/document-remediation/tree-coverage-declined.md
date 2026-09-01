# Is the structure tree decorative? Measured with the wrong instrument, and discarded

`isTagged` is a floor of one: a PDF with a non-empty structure tree is
repairable, an empty one is refused. Nineteen delivered documents fail `7.1-3`
— "content shall be marked as Artifact or tagged as real content" — and the
failure counts split into two shapes the clause number hides:

| | untagged runs |
|---|---:|
| r09, n24 | 90, 121 |
| r14, n05 | 2,407, **7,928** |

n05's 7,928 sits against 32,399 untagged text runs in the same file. That is a
document whose tree reaches almost nothing, which we accept as tagged, repair,
and deliver as something that can never conform — while the client sees a punch
list that reads like ordinary remaining work.

**The question is real. This did not answer it.**

## What was registered, and what happened

Criteria were committed in `4ac78e8` before the script ran. The first was a
calibration gate on the instrument itself:

> Documents that do NOT fail `7.1-3` are the negative control — their trees do
> cover their content. If their median coverage is below 0.80, the proxy is
> measuring its own normalisation rather than the tree, and the whole result is
> discarded rather than explained.

`[V]` 52 source PDFs read:

| | documents | median coverage |
|---|---:|---:|
| negative control (`7.1-3` passes) | 33 | **0.56** |
| suspect (`7.1-3` fails) | 19 | 0.49 |

**0.56 against a 0.80 gate, and the two populations are 0.07 apart.** One
control document reads **1.42** — above 1, which is only possible by
double-counting nested elements. The proxy is noisy in both directions:
`order` is block-level and whitespace-normalised, so it under-counts text
inside cells and spans, and over-counts where elements nest.

Criterion 1 failed. The result is discarded.

## The part that makes this worth writing down

Criterion 2 was met, and it is exactly the trap the criteria exist for.

`[V]` Five documents pass `isTagged` with coverage below 0.25 — n22 at 0.03,
r14 at 0.00, r10 at 0.09, r06 at 0.12, n30 at 0.14 — against a bar of three.
They are precisely the population the hypothesis predicted, in precisely the
place it predicted them.

It would take one sentence to keep them: *criterion 1 is about the median, and
look at the tail.* That sentence is wrong. Criterion 1 is a gate on the
INSTRUMENT, not on the population. A proxy that cannot separate control from
suspect in the middle has not earned trust at the extreme — a 0.00 may be a
document whose `order` is empty for a reason that has nothing to do with
coverage, and this measurement cannot tell the difference. Reading the tail of
a discredited instrument is how the `/Artifact` contrast mistake happened, and
it is recorded twice already.

So the five are **not** a finding. They are the reason to build a real
instrument, and nothing more.

## What would answer it

MCID reachability, in Java: count the marked-content operators a page draws,
and how many carry an MCID the structure tree actually references. That is an
exact ratio rather than a proxy, and `StructText` already builds the per-page
MCID map it needs — this is a counting pass over data that exists, not a new
capability.

**It is not built here.** The clause is worth one document of conformance
(`7.1-3` alone clears exactly one), and criterion 3 stands whatever the number
turns out to be: any change to `isTagged` REFUSES documents we currently
deliver, which is a regression from the client's side and a decision for a
person, not for a script.

The honest state is that the gate is **unmeasured**, the instrument that would
measure it is named, and the reason it has not been built is that the return is
one document and the action it could justify needs a human decision anyway.

## Spent

The blindness on this question is not spent — nothing here read a document's
words, and no key moved. What is spent is the cheap version of the question:
`order[].text / textChars` has been tried, has been shown not to separate, and
should not be tried again.
