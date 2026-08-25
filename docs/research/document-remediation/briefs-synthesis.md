# Both briefs, synthesised — the two paths fail in opposite directions

**Date:** 2026-08-25 · Written in the coordinating chat under
[briefs/README.md](briefs/README.md) rule 9. Source results are
[source-export-results.md](source-export-results.md) on
`claude/brief-a-source-export` and
[vlm-scale-results.md](vlm-scale-results.md) on `claude/vlm-scale-b`. Neither is
edited here. Brief A's verification is in
[brief-a-synthesis.md](brief-a-synthesis.md).

## What each brief was told, and what came back

Both were told to attack a wall. **Both found our recorded explanation for that
wall was wrong.** Neither found the wall wasn't there.

| | our recorded belief | what was measured |
|---|---|---|
| **A** structure | it cannot be recovered from a PDF | `[V]` a native source exports `/H1 /H2 /H3` intact; our kill fired on an HTML-import quirk |
| **B** alt text | *"a purpose only visible from the document's context"* | `[V]` a 7B model conveyed the purpose **from bare pixels, with no context at all** |

## The joint finding

**`[V]` The two paths fail in opposite directions, and that — not accuracy — is
the product decision.**

| | when it lacks the information | what a reviewer sees |
|---|---|---|
| **source export** | **omits** | an honest gap |
| **inference** — pipeline or VLM | **asserts** | nothing |

Gate 1 is zero assertions. A path whose failures are structurally omissions
clears it by construction. A path that infers cannot, at any accuracy.

## Brief B is the decisive one, and it inverts what scale means

`[V]` Scoring against a fact list registered before the run, on the same image:

| | 256M | 7B, bare pixels | 7B, + document text |
|---|:--:|:--:|:--:|
| F1–F6 (the content facts) | **1/6** | **6/6** | **6/6** |
| F7 (invents nothing) | ✗ | ✗ | ✗ |

The jump from 1/6 to 6/6 is real and it happens **with no context added**. Size
mattered, and our recorded reason was wrong.

**And it does not help, because the failure mode got worse.** `[V]` Arm 3
fabricated a regulatory requirement — that the department *"requires at least two
photographs to confirm the posting date and location"* — and attributed it to the
**correctly named** Los Angeles Department of City Planning. I re-ran the probes:
`department of city planning` occurs 2x in the extracted text and `zoning` 3x, so
the agency is grounded; `compliance`, `posting date`, `development project`,
`windows` and `facade` occur **0 times each**.

The 256M model said *"a poster on the wall"* — visibly thin, and a reviewer
distrusts it. The 7B model produced confident municipal procedure under a real
department's name. **It passes a human skim more easily than the failure it
replaced.**

**`[V]` The general case is worse than the case we caught.** Arm 3's fabrication
was only detectable because it happened to be checkable against extracted text. A
fabrication about something the text does not mention would not have been caught
at all — **and that is most of what alt text asserts.**

> **Under zero human input, a larger VLM is not an improvement. It is a
> regression, because it moves the failure from visible to undetectable.**

That closes the question the brief asked. It does not need a bigger model next.

## Two errors in our own published record, now corrected

Both were found by the briefs and neither could fix them — rule 10 reserves
shared documents to this chat.

1. **`[V]` `lacity-clerk-misc` is five full-page scans**, one JPEG-2000 XObject
   per page, verified by extracting exactly 5 images from 5 pages. Our recorded
   "8 images, 3 described, 5 under threshold" counted **docling layout regions**,
   not PDF objects. Corrected in place.
2. **`[V]` The stated mechanism for the alt-text failure is falsified.**
   Corrected in place with a banner.

The threshold finding survives and is now `[V]`: `picture_area_threshold`
defaults to `0.05` and accepts `0.0`. A setting, not a wall.

## What is now decided, and what is not

**Decided `[V]`:**
- **Alt text by VLM is closed under zero human input.** Not for lack of capability
  — for lack of any way to check the assertion, which scale makes worse.
- **The pipeline's failure mode is assertion, and the exporter's is omission.**
  Only one of those clears gate 1.

**Open, and now the whole question:**
1. **Re-run Arm L from native `.docx`/`.fodt` sources** authored to the same
   ground truth. Brief A's result is unresolved until this runs, and it is the
   only remaining path with a plausible route to zero assertions.
2. **7 figure assertions** in Arm L — decorative images tagged as content.
   `[H]` Untested from a native source; both ODF and OOXML carry a decorative
   flag.
3. **Row headers are unexpressible** in ODF or OOXML. `[V]` A permanent ceiling
   on the source path — and it produces an omission, not an assertion.
4. **`PDFUACompliance` is a separate export option.** `[H]` Four Arm L documents
   failed only `5-1`. Untested.

## On the protocol

Both chats registered predictions before measuring, reported their own misses
first, stopped at their stopping conditions, and refused to edit shared
documents. **Brief A's biggest contribution was a hypothesis it declined to
test** — which resolved here in two commands. **Brief B's was refuting four of
its own eight predictions**, including the one it called *"the biggest error in my
prediction."*

`[V]` Neither drifted. Every number in both reports reproduced when re-derived
from raw output. The two corrections above exist because the briefs were forbidden
from making them, which is the boundary working rather than failing.
