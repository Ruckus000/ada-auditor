"""Strategy D (registered 2026-09-22): a rule-only merged-heading detector, dev-measured.

No model anywhere. Four first-line predicates over the dev-set rows
(``labels.merged_probe``), each reused from existing repo code:

- D1 short first line: ``head_words(first_line) <= MAX_HEAD_WORDS`` (split_heads).
- D2 no closing sentence punctuation: first line does not end ``[.;:]``
  (split_heads' gate).
- D3 style boundary on line 1: ``same_line_probe.lead_boundary`` over
  ``first_line_runs`` returns a lead (expected to be weak here — it was built
  for single-line same-size leads; disclosed in the registration).
- D4 numbering: ``ENUM_HEAD`` matches the first line (split_heads).

Fire = D1 AND D2 AND (D3 OR D4). Reported on the same dev set as strategy A,
against the same 2.0 % negative-fire cap; marginals per predicate, no post-hoc
fitting past the cap. If the cap cannot be met the strategy is spent.

    python3 -B -m labels.merged_rules --dev-set out/labels/merged-dev/dev-set.json
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from labels.same_line_probe import lead_boundary
from labels.split_heads import ENUM_HEAD, MAX_HEAD_WORDS, head_words

FALSE_TRIGGER_MAX = 0.02


def predicates(row: dict) -> dict[str, bool]:
    """D1..D4 for one dev-set row (first_line + first_line_runs fields)."""
    first = (row.get("first_line") or "").strip()
    return {
        "D1_short": bool(first) and head_words(first) <= MAX_HEAD_WORDS,
        "D2_no_closing_punct": bool(first) and not re.search(r"[.;:]$", first),
        "D3_style_boundary": lead_boundary({"first_line": first,
                                            "first_line_runs": row.get("first_line_runs") or []}) is not None,
        "D4_numbering": bool(first) and bool(ENUM_HEAD.match(first)),
    }


def fire(row: dict) -> bool:
    p = predicates(row)
    return p["D1_short"] and p["D2_no_closing_punct"] and (p["D3_style_boundary"] or p["D4_numbering"])


def report(dev_set_path: Path) -> dict:
    dev = json.loads(dev_set_path.read_text())
    rows = dev["rows"]
    marginals = {k: {"positive": 0, "negative": 0} for k in ("D1_short", "D2_no_closing_punct", "D3_style_boundary", "D4_numbering")}
    fired = {"positive": 0, "negative": 0}
    totals = {"positive": 0, "negative": 0}
    for r in rows:
        kind = r["kind"]
        totals[kind] += 1
        ps = predicates(r)
        for k, v in ps.items():
            if v:
                marginals[k][kind] += 1
        if ps["D1_short"] and ps["D2_no_closing_punct"] and (ps["D3_style_boundary"] or ps["D4_numbering"]):
            fired[kind] += 1
    neg_share = (fired["negative"] / totals["negative"]) if totals["negative"] else 0.0
    recall = (fired["positive"] / totals["positive"]) if totals["positive"] else 0.0
    return {"dev_set_sha256": dev.get("sha256"), "totals": totals, "fired": fired,
            "marginals": marginals, "negative_fire_share": neg_share, "recall": recall,
            "cap": FALSE_TRIGGER_MAX, "cap_met": neg_share <= FALSE_TRIGGER_MAX}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dev-set", type=Path, required=True)
    a = p.parse_args(argv)
    print(json.dumps(report(a.dev_set), indent=1))


if __name__ == "__main__":
    main()
