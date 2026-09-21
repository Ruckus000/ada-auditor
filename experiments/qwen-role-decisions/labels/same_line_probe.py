"""Same-line run-in probe (Step 0 only; no rule).

The run-in split plan (2026-09-22) cut shape 2 — heading and body sharing line 1 —
because a line-based split cannot reach it. ``Cards.java`` now reports
``first_line_runs``: the first line's style runs (maximal spans of equal rounded
font size and weight). This module counts where a clean style boundary — a bold or
larger lead run followed by regular text, ending at a word boundary — appears:

- validation: of the key headings lost in the off arm, how many are same-line
  lead-ins with a clean boundary, and how precise the boundary pattern is
  (lead text vs the document's struct-tree key headings);
- wild: of the 9 shape-2 misses, how many blocks show the boundary.

Scripts only: no model calls, no labels written, no PDF modified, nothing split.
"""
from __future__ import annotations

from run import text_norm


def norm(text: str) -> str:
    return text_norm(text or "")


def lead_boundary(block: dict) -> str | None:
    """The lead text of a clean style boundary on line 1, else None.

    Clean boundary: at least two runs; the first run is bold or strictly larger
    than the second; the second is regular and not larger than the first; and the
    first run ends at a word boundary of the first line (not mid-word).
    """
    runs = block.get("first_line_runs") or []
    if len(runs) < 2:
        return None
    lead, body = runs[0], runs[1]
    if not (lead["bold"] or lead["font_pt"] > body["font_pt"]):
        return None
    if body["bold"] or body["font_pt"] > lead["font_pt"]:
        return None
    first_line = (block.get("first_line") or "").strip()
    text = (lead["text"] or "").strip()
    if not text or not first_line:
        return None
    if first_line != text and not (
            first_line.startswith(text) and first_line[len(text)] in " \t"):
        return None  # boundary mid-word, or the run text is not the line's start
    return lead["text"]
