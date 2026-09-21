# Judge pack: run-in split cards, Stage 2 wild gate (2026-09-21)

This branch exists so a judge model outside the machine can label cards. It
contains **no model predictions, no scores and no existing labels**: only the
protocol, the chunks, and the page sheets. Do not look for any of those
elsewhere. That includes other branches of this repo (`claude/*`,
`kimi-data-*`), which hold predictions. A judge that has seen them is not
blind and its output is discarded.

You are **seat 2** (Kimi K3 on page sheets, as registered on 2026-09-21: seat
1 = Claude Opus-medium on sheets, seat 2 = Kimi K3 on sheets, tie-break =
Claude Opus-quick per card on heading-bit disagreements). Seat 1 has already
judged these cards; you will not see its answers.

## What is here

- `PROTOCOL-sheets.md`: the judge protocol (v2, page-sheet mechanics). Read
  it first and follow it exactly. Where it says "the Read tool", use whatever
  tool opens an image for you.
- `chunks/chunk-00.json … chunk-03.json`: 22 sheets, 53 boxes (12, 18, 14, 9).
  Each chunk is a JSON array of `{"sheet": "sheets/<name>.jpg", "cards": [{"k", "id", "text"}]}`.
- `sheets/*.jpg`: one greyscale page image per sheet, every card's box drawn in
  magenta with its number tag `k`.
- `out/seat2/`: where your outputs go.

Some ids end in `h`: a short first line split off a longer block (a head
card). The protocol's rule applies: judge the head card on its own line only,
and judge its body card (same id without `h`) as body text unless it is itself
a heading.

## How to judge one chunk

Use a **fresh context per chunk** (no memory of other chunks). For every box
on every sheet, in order, append one line to `out/seat2/<chunk-name>.jsonl`:

```
{"sheet": "<sheet filename>", "k": <k>, "id": "<id>", "type": "<H|P|TH|Caption|TOCI|Lbl|Artifact|Other|Unsure>", "level": <int or null>}
```

When every box has a line, count the lines. The count must equal the chunk's
box count. End with exactly `done <chunk-name> <count>`. A run without its
`done` line, or with a different count, is discarded in full. Never skip a
box, never guess a box you did not look at.

## Returning results

Commit the four `out/seat2/chunk-0N.jsonl` files to this branch
(`kimi-judge-pack-runin-2026-09-21`) if you can push; otherwise paste each
file's full contents back in chat, one file per message, prefixed by its path.
Nothing else in this branch should change.
