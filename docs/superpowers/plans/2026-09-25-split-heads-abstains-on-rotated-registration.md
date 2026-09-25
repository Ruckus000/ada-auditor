# `split_heads` abstains on rotated blocks (registration, 2026-09-25, before the code)

[`2026-09-25-struct-text-page-space-registration.md`](2026-09-25-struct-text-page-space-registration.md)
left this open and named the two ways out:

> `Cards` should emit each block's `dir`, and both the width test and the line
> cut should use it (or abstain on `dir != 0`).

**This registers the second.**

## Why the cheaper one

`is_run_in_head` asks a reading-frame question — does the first line stop well
short of the block's width — and needs both sides in one frame. Since the box
moved to page space it compares `first_line_x1` (still the reading frame, and
deliberately so: those are the right coordinates for grouping glyphs into
lines) against a page-space width. On a rotated block the ratio is meaningless.
The head/body cut has the same fault: `y1 = y0 + 1.3 em` is the cross-line axis
upright and the *reading* axis rotated, so it slices characters off a vertical
run instead of taking its first line.

Making both work in the reading frame and converting the head and body boxes
back is the thorough fix. It is not worth it yet:

- **264 of the 311 run-in splits on cohort 8 are on upright blocks**, where
  every coordinate already agrees. The page-space registration measured 47 of
  311 landing on a block whose box moved.
- Rotated blocks are survey plats, maps and landscape sheets drawn from rotated
  portrait content. A run-in heading there is rare, and the 47 are the cards we
  have the least trustworthy geometry for.
- The run-in split has never been adopted. Building the thorough version to
  decide whether to adopt it is work spent before the question is asked.

Abstaining loses those 47 and makes the other 264 honest, which is what an
adoption measurement needs.

## The change

1. **`Cards` emits each block's text direction** as `text_dir`: the value
   `TextPosition.getDir()` reports when every glyph of the block agrees, and
   `null` when they do not. A block of mixed directions is not upright either.
2. **`labels/split_heads.py` splits only an upright block** — `text_dir == 0`.
   The guard sits on the shared path, so it covers the enumerated split as well
   as the run-in one: both make the same `y0 + 1.3 em` cut.
3. A block from a dump with no `text_dir` at all is treated as upright, so a
   legacy cards file behaves as it does today. New dumps always carry it.

## What must be measured

On cohort 8's 104 tagged copies, against the counts in the page-space
registration:

| | Registered before | Expected after |
|---|---|---|
| `split_enumerated_heads` | 54 | 54 — none of the 54 is on a rotated block |
| `split_run_in_heads` (0.5) | 311 | 311 − (those on rotated blocks) |

Blocks carrying a non-zero or null `text_dir` are reported too. A surprise is a
reason to stop, not to adjust the guard.

## Scope

- No model runs, no look, no retraining.
- `--split-run-in-heads` stays unused in any gated look until it has been
  measured for adoption **under this guard**. This registration unblocks that
  measurement; it does not authorise the flag.
- The reading-frame glyph list is unchanged.
