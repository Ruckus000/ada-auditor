# Brief C, reviewed — the export is honest, with one systematic exception


> **CORRECTED, 2026-08-25.** Arm R+UA is **21 assertions and 0 DELIVERABLE**, not 17 and 2 — four were invisible, and all four come from Brief C's `alt=""` → decorative repair deleting meaningful images. The exporter's honesty is unaffected; **our repair asserted**. See [instrument-correction.md](instrument-correction.md).

**Date:** 2026-08-25 · Coordinating chat, under [briefs/README.md](briefs/README.md)
rule 9. Brief C's results are [source-native-results.md](source-native-results.md)
on `claude/brief-c-source-native` and are not edited here.

## Verified independently

`[V]` Re-derived from Brief C's own probe artifacts in `out/probes/`:

| probe | source states | PDF contains | honest? |
|---|---|---|:--:|
| no headings — two 28pt bold paragraphs | no outline levels | **0 `/H*`** | ✓ |
| image, no alt | nothing authored | 1 `/Figure`, **no `/Alt`** | ✓ |
| decorative image | `loext:decorative` | **0 `/Figure`**, in `/Artifact` | ✓ |
| table, row labels unmarked | no header marking | **0 `/TH`, 9 `/TD`** | ✓ |
| **table, header *style*** | a style, **no scope** | **3 `/TH`, `Scope=Column`** | **✗** |

**`[V]` The exporter does not infer.** Bold 28pt text planted to tempt it came out
`/P`. An image with no authored alt got no placeholder. Unmarked row labels got
`/TD`. **Every silence probe stayed silent.**

**`[V]` The decorative class resolves** — the one Brief A left untested and I
flagged as the line to watch.

My own first attempt to reproduce the scope finding gave the opposite result. My
`.fodt` referenced the style without declaring it, so LibreOffice fell back to
default. **My test was invalid; Brief C's finding stands.**

## The decision Brief C correctly routed here

It found one assertion and stopped, because removing it needed a repair outside
the four the brief permitted, and it declined to decide whether that mattered.

**My call: the kill condition does not fire, and the repair is judgement-free.**

The reasoning, so it can be argued with rather than inherited:

1. `[V]` The source states a **paragraph style**. It states **no scope**.
2. `[V]` LibreOffice emits `/TH` from that style and stamps `Scope=Column`
   unconditionally.
3. `[V]` For any `/TH` outside a declared header row, `Column` is **wrong** — the
   cell heads a row.
4. `[V]` ODF cannot express a row header at all, so there is no correct scope to
   substitute.
5. Therefore the only honest outputs are `/TH` with no scope, which LibreOffice
   will not produce, or `/TD`.

**Restyling those cells is abstention, not interpretation.** We are not deciding
the cell is not a header — we are declining to assert a scope we cannot know. The
rule is positional (*is this cell inside a declared header row?*) and it only ever
**removes** a claim. That is the same operation that took the pipeline from 16
assertions to 8, and removing a claim can never create an assertion.

`[H]` It should convert all 13 scope assertions into omissions, taking Arm R from
17 to ~4. **Not measured. Nobody has run it.**

**One implementation caveat:** `Table Heading` carries visual formatting, so a
naive restyle changes how the client's document looks. The formatting must be
preserved as direct character formatting. Deterministic, but it is real work and
it is not free.

## The finding against our own instrument

**`[V]` `compare.mjs` cannot see figure under-tagging.** It asserts on too many
`/Figure` elements and never on too few. `06-images-uncaptioned` dropped **all
four** of its meaningful figures and scored **DELIVERABLE with zero defects**.

This is more serious than it looks in Brief C's framing, because it is not
specific to Brief C:

- `[V]` Arm R's omission drop (25 → 12) is partly invisible loss, and at least one
  of its two DELIVERABLEs is false.
- `[H]` **It may also inflate the abstention result we already banked.** Global
  abstention removed structure and reported assertions 16 → 8 and DELIVERABLE
  5 → 8. If the comparator cannot see structure that should be present and is not,
  some of that gain is instrument blindness. **Unchecked. This needs checking
  before any further number is trusted.**

**Every arm scored since abstention was introduced is suspect on this axis**, and
that is the highest-priority item in the project right now — above building the
scope repair, because the repair's value cannot be measured on a broken
instrument.

## A claim withdrawn

Brief C's prediction 6 said copying `dc:title` would solve 2.4.2 for the four real
documents blocked on it. **`[V]` It does not.** Those four produce zero headings,
so there is nothing to copy, and the corpus document in the same position blocked
identically.

`[H]` **Not closed, though.** A real `.docx` carries a Title field in its document
properties, which Word often populates independently of any heading. Brief C
tested copying *from a heading*, not reading an authored title. Untested.

## Status of the path

`[V]` **The export is honest**, across every structure tested but one, and the
exception has a known judgement-free fix.

`[V]` **`.docx` behaves identically to `.fodt`** — byte-identical output on the
control. Word's import filter does not carry the defect that killed Brief A, and
`[V]` that defect belongs specifically to LibreOffice's **Writer/Web** module, not
its HTML handling generally.

**The ceiling is the source, and it is a hard one.** `[V]` A source that authors
`alt=""` on a meaningful image produces a PDF with that image artifacted out of
the structure tree entirely — honestly, deterministically, and uselessly. The
export cannot be better than what it is given, which is the whole point and also
the whole limitation.

## Open, in priority order

1. **Fix `compare.mjs` to detect figure under-tagging, then re-score everything
   since abstention.** Nothing else is trustworthy until this lands.
2. **Build and measure the scope repair.** `[H]` 17 → ~4 assertions.
3. **Read an authored `.docx` Title field**, rather than copying from a heading.
   Bears directly on four of the nine real documents.
4. **Triage the five documents still failing UA-1** after `PDFUACompliance` —
   `01-simple-text` has zero structural defects and still fails on two rules.
5. **Whether clients hold their sources.** `[V]` Not answerable by running code,
   and it governs everything above.
