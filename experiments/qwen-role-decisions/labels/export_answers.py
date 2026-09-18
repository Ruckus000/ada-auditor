"""Stage 2 Task 3: stored heading answers -> human-answer label rows.

Reads a JSON dump of the product's `document_answers` rows -- never a
database, never a live route -- and writes JSONL label rows the
`eligibility_eval` label contract accepts (``refusals`` in
``eligibility_eval.py``), so its ``split``/``evaluate`` take them unchanged.

A row is kept only when it answers a heading-card ask: ``kind == "heading"``,
``askId`` starting ``heading-card:`` (``HEADING_CARD_PREFIX`` in the
product's ``src/domain/heading-suggestions.ts``), and ``disposition ==
"decided"``. Model output and considered-not-heading cards never reach this
file at all -- they never got an answer row -- so nothing here needs to
filter them out again; the filter is purely "was this card answered".

The dump's field names follow the product's own ``StoredDocumentAnswer``
(``src/domain/platform.ts``): ``id``, ``clientId``, ``documentId``,
``inputSha256``, ``askId``, ``kind``, ``target``, ``disposition``, ``value``,
``note``, ``actor``, ``declaredAt``. ``value`` is one of
``HEADING_CARD_VALUES`` (``H1``-``H6``, ``P``, ``Artifact``, ``Caption``,
``TH``, ``TOCI``, ``Lbl``, ``BlockQuote``) -- the reviewer's type and level
folded into one token, exactly as the workbench writes it
(``suggestedHeadingValue``). A rejected suggestion (model proposed ``H``,
reviewer answered ``P``) becomes the reviewer's stated type in the label --
never silently ``H``; nothing here reads ``target.suggested`` to decide the
label, only ``value``.

Latest-wins: when the same ``(documentId, inputSha256, askId)`` was answered
more than once, only the row with the greatest ``(declaredAt, id)`` survives
-- a later correction supersedes an earlier answer, and a tie on the
timestamp is broken by the answer id so the choice is deterministic.

Dependency rule: ``target.dependsOn`` (``HeadingCardTarget`` in
``document-answers.ts``) lists the card ids a suggestion assumed were
headings. A row is excluded, and counted, when any dependency's own ask is
unanswered in the dump, or was answered a non-``H`` type (rejected) --
checked against the *latest* decided answer for that dependency, not
against whether that dependency's own row was itself emitted.

There is no template concept in the answers channel (no web host, no CMS):
``client_id`` is the row's own ``clientId``; ``template_id`` and
``document_stem`` take the document id, since ``document_sha256`` (from
``inputSha256``) already carries the per-document grouping key the split
needs and no finer template signal exists here.

    python3 -B -m labels.export_answers --dump <json> --out <jsonl>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

HEADING_CARD_PREFIX = "heading-card:"
HEADING_CARD_VALUES = (
    "H1", "H2", "H3", "H4", "H5", "H6",
    "P", "Artifact", "Caption", "TH", "TOCI", "Lbl", "BlockQuote",
)
EXCLUSION_REASONS = ("dependency-unanswered", "dependency-rejected")


def card_id_of(ask_id: object) -> str | None:
    """The card id a heading-card ask names, or ``None`` for any other ask."""
    if not isinstance(ask_id, str) or not ask_id.startswith(HEADING_CARD_PREFIX):
        return None
    return ask_id[len(HEADING_CARD_PREFIX):]


def type_and_level(value: str) -> tuple[str, int | None]:
    """``"H2"`` -> ``("H", 2)``; every other vocabulary word -> ``(word, None)``."""
    if len(value) == 2 and value[0] == "H" and value[1].isdigit():
        return "H", int(value[1])
    return value, None


def load_dump(path: Path) -> list[dict]:
    """A bare JSON array of answer rows, or ``{"answers": [...]}``/``{"rows": [...]}``."""
    data = json.loads(path.read_text())
    if isinstance(data, dict):
        data = data.get("answers", data.get("rows", []))
    if not isinstance(data, list):
        raise ValueError("dump must be a JSON array of answer rows (optionally under 'answers' or 'rows')")
    return data


def heading_card_rows(dump: list[dict]) -> list[dict]:
    """Rows answering a heading-card ask, kept regardless of disposition (for the 'decided' count)."""
    return [r for r in dump if r.get("kind") == "heading" and card_id_of(r.get("askId")) is not None]


def latest_per_ask(rows: list[dict]) -> list[dict]:
    """One row per ``(documentId, inputSha256, askId)``: the greatest ``(declaredAt, id)``."""
    best: dict[tuple, dict] = {}
    for r in rows:
        key = (r.get("documentId"), r.get("inputSha256"), r.get("askId"))
        cur = best.get(key)
        if cur is None or (r.get("declaredAt"), r.get("id")) > (cur.get("declaredAt"), cur.get("id")):
            best[key] = r
    return list(best.values())


def dependency_status(latest: list[dict]) -> dict[tuple, str]:
    """``(documentId, inputSha256, card_id) -> type`` for every latest decided heading-card answer."""
    status: dict[tuple, str] = {}
    for r in latest:
        cid = card_id_of(r.get("askId"))
        typ, _ = type_and_level(r["value"])
        status[(r.get("documentId"), r.get("inputSha256"), cid)] = typ
    return status


def exclusion_reason(row: dict, status: dict[tuple, str]) -> str | None:
    target = row.get("target") or {}
    for dep in target.get("dependsOn") or []:
        dep_cid = dep[len(HEADING_CARD_PREFIX):] if dep.startswith(HEADING_CARD_PREFIX) else dep
        key = (row.get("documentId"), row.get("inputSha256"), dep_cid)
        dep_type = status.get(key)
        if dep_type is None:
            return "dependency-unanswered"
        if dep_type != "H":
            return "dependency-rejected"
    return None


def label_row(row: dict) -> dict:
    typ, level = type_and_level(row["value"])
    card_id = card_id_of(row["askId"])
    return {
        "id": card_id,
        "answer_id": row["id"],
        "actor": row["actor"],
        "label_source": "human-answer",
        "type": typ,
        "unsure": False,
        "label": {"heading": typ == "H", "level": level if typ == "H" else None},
        "note": "",
        "labelled_at": row["declaredAt"],
        # eligibility_eval's label contract (refusals()): required grouping keys.
        "client_id": row.get("clientId"),
        "template_id": row.get("documentId"),
        "document_sha256": row.get("inputSha256"),
        "document_stem": row.get("documentId"),
    }


def export(dump: list[dict]) -> tuple[list[dict], dict]:
    """Label rows, plus the counts the CLI prints: read, decided, latest, emitted, excluded by reason."""
    candidates = heading_card_rows(dump)
    decided = [r for r in candidates if r.get("disposition") == "decided"]
    latest = latest_per_ask(decided)
    status = dependency_status(latest)
    excluded = {reason: 0 for reason in EXCLUSION_REASONS}
    emitted: list[dict] = []
    for row in latest:
        reason = exclusion_reason(row, status)
        if reason is not None:
            excluded[reason] += 1
            continue
        emitted.append(label_row(row))
    counts = {
        "read": len(dump),
        "decided": len(decided),
        "latest": len(latest),
        "emitted": len(emitted),
        "excluded": excluded,
    }
    return emitted, counts


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dump", type=Path, required=True, help="JSON dump of document_answers rows")
    p.add_argument("--out", type=Path, required=True, help="JSONL label rows to write")
    a = p.parse_args()
    rows, counts = export(load_dump(a.dump))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text("".join(json.dumps(r) + "\n" for r in rows))
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
