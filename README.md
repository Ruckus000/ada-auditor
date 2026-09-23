# Judge pack: r13 confirmation batch (2026-09-23)

This branch lets a judge model outside the machine label cards. It holds
**no model predictions, no scores and no existing labels**: only the protocol,
the chunks and the page sheets.

Do not look for any of those elsewhere. That includes the other branches of
this repo (`claude/*`, `kimi-data-*`) and any path named `confirm-r13` in them,
all of which hold predictions. A judge that has seen them is not blind, and its
output is discarded.

You are **seat 2**, registered on 2026-09-23 in
`docs/superpowers/plans/2026-09-23-r13-confirmation-batch-registration.md`:

- seat 1 = Claude Opus-medium on sheets
- seat 2 = Kimi K3 on sheets
- tie-break = Claude Opus-quick, card by card, on heading-bit disagreements

You will not see seat 1's answers.

## What is here

- `PROTOCOL-sheets.md`: the judge protocol (v2, page-sheet mechanics). Read it
  first and follow it exactly. Where it says "the Read tool", use whatever tool
  opens an image for you.
- `chunks/chunk-00.json` to `chunk-53.json`: 54 chunks, 322 sheets, 2,913 boxes
  (13–72 boxes per chunk). Each chunk is a JSON array of
  `{"sheet": "sheets/<name>.jpg", "cards": [{"k", "id", "text"}]}`.
- `sheets/*.jpg`: one greyscale page image per sheet. Every card's box is drawn
  in magenta with its number tag `k`.
- `out/seat2/`: where your outputs go.

## How to judge one chunk

Judge each chunk on its own, and don't carry decisions over from other chunks.
If your context fills, start a fresh one between chunks, never in the middle
of a chunk.

For every box on every sheet, in order, append one line to
`out/seat2/<chunk-name>.jsonl`:

```
{"sheet": "<sheet filename>", "k": <k>, "id": "<id>", "type": "<H|P|TH|Caption|TOCI|Lbl|Artifact|Other|Unsure>", "level": <int or null>}
```

When every box has a line, count the lines. The count must equal the chunk's
box count. End with exactly `done <chunk-name> <count>`.

A chunk without its `done` line, or with a different count, is discarded in
full. Never skip a box, and never guess a box you did not look at.

## Returning results

Commit the `out/seat2/chunk-NN.jsonl` files to this branch
(`kimi-judge-pack-confirm-r13-2026-09-23`) as you finish them, several at a
time is fine. If you can't push, paste each file's full contents back in chat,
one file per message, prefixed by its path. Nothing else in this branch should
change.
