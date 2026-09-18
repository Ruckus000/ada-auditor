# Judge pack — heading labels for the ADA Auditor Stage 2 wild gate (2026-09-18)

This branch exists so a judge model outside the machine can label cards. It contains **no model predictions and no existing labels**: only the protocol, the card chunks, and the page images. Do not look for either elsewhere.

## What is here

- `PROTOCOL.md` — the judge protocol (v2). Read it first and follow it exactly.
- `chunks/calib-00.json` — 62 cards for calibration. These already have a hidden four-judge consensus; your output on them decides whether you are used as a judge at all (rule fixed in advance: heading-bit agreement ≥ 0.99 → full seat; 0.973–0.99 → tie-break seat only; < 0.973 → not used).
- `chunks/conflict-00.json` — 20 cards to be re-judged under the current protocol.
- `chunks/remaining-00.json … remaining-09.json` — 566 cards (62 per chunk, the last has 8).
- `images/<id>.jpg` — one page image per card, with the card's box drawn in magenta. Every chunk row's `image` field points here.
- `out/seat1/`, `out/seat2/`, `out/tiebreak/` — where outputs go.

Each chunk row: `{"n", "id", "text", "font_pt", "weight", "page", "repeats_on_pages", "in_table_box", "image"}`. `text` is the extractor's reading and may be garbled, merged or a fragment; **the image is the evidence.**

## How to judge one chunk

Start a **fresh context** per chunk (no memory of other chunks, no other files open). For every card in order: open its image, find the magenta box, decide the type per `PROTOCOL.md`, and append one line to the output file:

```
{"n": <n>, "id": "<id>", "type": "<H|P|TH|Caption|TOCI|Lbl|Artifact|Other|Unsure>", "level": <int or null>, "note": "<≤12 words>"}
```

`level` is an integer only when `type` is `H`, else `null`. `Unsure` only when the box is on handwriting, a stray mark, or an unreadable scan. Never skip a card, never guess a card you did not look at, never copy another judge's answer.

Output file: `out/<seat>/<chunk-name>.jsonl` (for example `out/seat2/remaining-03.jsonl`). When every card has a line, count the lines; it must equal the chunk length. End with exactly: `done <chunk-name> <count>`.

A run that did not end with its `done` line, or whose line count differs from the chunk length, is discarded in full.

## Order

1. `calib-00` first, as seat `calib`. Stop and report; the number is computed on the other side.
2. Only if told to continue: `conflict-00`, then `remaining-00` … `remaining-09`, as the seat you are assigned (`seat1`, `seat2`, or `tiebreak`). A tie-break seat only receives a short list of ids; judge only those.

## Returning results

Commit the `out/<seat>/*.jsonl` files to this branch (`kimi-judge-pack-2026-09-18`) if you can push; otherwise paste each file's full contents back in chat, one file per message, prefixed by its path. Nothing else in this branch should change.
