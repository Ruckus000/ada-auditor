# Brief A, reviewed — the kill condition fired on the fixture, not the question

**Date:** 2026-08-25 · Written in the coordinating chat, which is where synthesis
happens under [briefs/README.md](briefs/README.md) rule 9. Brief A's own results
are at [source-export-results.md](source-export-results.md) on branch
`claude/brief-a-source-export` and are not edited here.

## Every number in Brief A reproduces

`[V]` Re-derived from `out/armC.comparison.json` and `out/armL.comparison.json`:

| | Arm C (Chromium + pipeline) | Arm L (LibreOffice, no pipeline) |
|---|---|---|
| assertions | **1**, in 1 of 11 docs | **20**, in 7 of 11 docs |
| omissions | 17 | 31 |
| veraPDF UA-1 | 5/11 | 0/11 |
| DELIVERABLE | 3 | 0 |

`[V]` The RoleMap claim is real and is four characters wide:
`/RoleMap<</Heading#201/P` appears in every Arm L document. LibreOffice emits
`/S /Heading 1` and maps it to a paragraph.

**The report is accurate, the prediction was registered before the run, and four
of seven hypotheses were reported as misses.** Nothing below contradicts it.

## What its own FINDINGS #2 asked, and the answer

Brief A recorded, as `[H]` and deliberately unpursued:

> *The `/Heading 1 → /P` RoleMap entry may be an HTML-import artefact rather than
> an exporter one. `<h2>`/`<h3>` map correctly, which points at how LibreOffice's
> HTML filter assigns the outline level.*

**`[V]` It is an HTML-import artefact.** A native ODF source with
`text:outline-level="1"`, exported by the same binary with the same
`UseTaggedPDF` option, emits:

```
/S/H1   /S/H2   /S/H3        RoleMap: <</Standard/P>>
```

All three levels. No `Heading#201`. Nothing role-mapped away.

**`[V]` The table scope assertions are also an HTML-import artefact.** A native
ODF table with `<table:table-header-rows>` produces 3 `/TH` carrying
`Scope=Column` — which is **correct**, they head columns — and the row-label
cells come out `/TD`. **Not marked as headers at all.**

## Why this changes the conclusion and not the measurement

Arm L's 20 assertions are not 20 defects. They are two systematic behaviours:

- **10** — `Scope=Column` asserted on cells that head rows.
- **7** — decorative images tagged `/Figure` instead of artifacted.
- 3 — one data cell as header, one layout table as data, one reading order.

`[V]` The 10 do not reproduce from a native source. The row-header cells are
simply not marked as headers, which turns **10 assertions into omissions**.

`[H]` The 7 figure assertions are **untested** from a native source and are the
honest remaining gap. ODF and OOXML both carry a decorative flag; whether
LibreOffice acts on it is unmeasured. Do not count them as solved.

**`[V]` The kill condition — "heading levels do not survive" — was met by the
fixture's source format, not by the exporter.** Our corpus is authored in HTML
because that is how it was generated. **Clients do not send HTML.** They send
`.docx`, and 7 of the 9 real documents name a word processor or layout
application upstream.

## The finding worth keeping

**`[V]` The two paths fail in opposite directions, and only one of them is safe.**

- The pipeline infers. When it is wrong it **asserts** — a wrong claim in the
  delivered bytes, invisible to a reviewer. Arm C got three heading levels wrong
  on `12-kitchen-sink` and called a data row a header row on a real fee schedule.
- The exporter copies. When the source lacks something it **omits** — an honest
  gap. Row headers have no representation in ODF or OOXML at all, so the source
  path can never assert one.

That is a permanent ceiling on the source path for row headers, and it is the
*good* kind of ceiling. **Gate 1 is zero assertions.** A path whose failures are
structurally omissions clears it by construction.

## Brief A did the right thing by stopping

The kill condition fired, and it recorded the hypothesis instead of chasing it —
which is what [briefs/README.md](briefs/README.md) rules 2 and 6 require. **The
protocol worked.** The finding was preserved, handed back, and tested here in two
commands. Had the chat pursued it, it would have been drifting, and the result
would have been a `.docx` experiment with no registered prediction.

## What is now open

1. **Re-run Arm L from native sources.** `[H]` The corpus needs `.docx` or `.fodt`
   equivalents authored to the same ground truth. That is a real cost and it is
   the next brief.
2. **The 7 figure assertions.** Untested. The only assertion class not yet
   explained away.
3. **`PDFUACompliance` is a separate export option from `UseTaggedPDF`.** `[H]`
   Four Arm L documents failed `5-1` and nothing else. Untested.
4. **Arm LP was never run**, and the open question it addresses stands: the
   pipeline re-tags unconditionally, so feeding it good structure may destroy it.
