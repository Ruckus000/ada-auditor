# labels/serve.py
"""Local keyboard labelling tool. Stdlib http.server; one reviewer at a time.

Writes one row per decision in eligibility_eval's label contract. Shows the
marked page, the text and its neighbours, the deterministic facts and the
APPROVED heading stack for the document. Never shows the source/tagger tag
or any model output. Document text stays under out/ (gitignored); the row
carries the text's SHA-256 only.

Sample mode (`--sample N`, reviewer B): cards are sampled and then re-sorted
back into reading order rather than left in sampled order, and the skip
refusal (only level 1 allowed on an empty stack) is waived — the sampled
stack is necessarily partial, so a real per-document ladder cannot be
enforced. Normal mode is unchanged: only the level that continues the
document's approved stack is allowed.

Fixed-set mode (`--cards-file PATH`, an audit reviewer): the file is a JSONL
list of `{"id": ...}` rows naming a pre-picked, fixed card set. Cards are
loaded from `out/keys-all-4/cards-r5.jsonl` (by `card_id`) and served in the
exact order the file lists them — not resorted into reading order, since the
file's own order (interleaving unrelated groups) is the point. An unknown id
is a loud, immediate error, never a silent skip. Like sample mode, the skip
refusal is waived (levels 1-6 always allowed) since the fixed set does not
form a per-document ladder. The document manifest (sha256, host) needed for
each row is pulled from `out/keys-all-4/labels.jsonl`, never from document
text. Rows are written to `out/labels/audit-r6-<actor>.jsonl`. Each card's
own `image` field (a marked-408 PNG) is used instead of the path `serve.py`
would otherwise compute from the card id.

`/answer` and `/skip` carry the shown card's id (`c=`) and are refused
(redirect without writing) unless it matches the current card — a double
keydown firing two in-flight requests would otherwise let the second one,
arriving after the first's write advances `next_card`, silently label a
card the reviewer never saw.

Cards are shown in tree reading order within a document (the integer after
':' in a PDF card's locator; a Word card's paragraph index), so the approved
stack is built in the order the headings occur. PDF cards whose marked page
image is missing are not queued; the page shows how many were left out.
Skipping a document asks for confirmation and writes `skipped: true` rows
(still `unsure: true`) so skips are counted apart from real unsure decisions.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import random
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from labels.render import image_path

TYPES = {"H": "H", "P": "P", "A": "Artifact", "C": "Caption", "T": "TH", "O": "TOCI", "L": "Lbl", "B": "BlockQuote", "U": "Unsure"}
OUT = Path("out/labels")
CARDS_FILE_SOURCE = Path("out/keys-all-4/cards-r5.jsonl")
CARDS_FILE_KEY_LABELS = Path("out/keys-all-4/labels.jsonl")


def card_image_path(card: dict) -> Path:
    """Marked-page PNG for a card: the card's own `image` field if it has
    one (fixed-set mode, sourced from keys-all-4), else the path serve.py
    computes and renders under out/labels/pages/marked (normal/sample mode)."""
    img = card.get("image")
    return Path(img) if img else image_path(card)


def read_ids(path: Path) -> list[str]:
    return [json.loads(l)["id"] for l in path.read_text().splitlines() if l.strip()]


def load_fixed_cards(ids: list[str], cards_path: Path = CARDS_FILE_SOURCE) -> list[dict]:
    """Cards named by `ids`, in that order. Unknown ids refuse loudly."""
    all_cards = [json.loads(l) for l in cards_path.read_text().splitlines() if l.strip()]
    by_id = {c["card_id"]: c for c in all_cards}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise ValueError(f"--cards-file: unknown card id(s) not in {cards_path}: {missing}")
    return [by_id[i] for i in ids]


def manifest_for_fixed_cards(cards: list[dict], labels_path: Path = CARDS_FILE_KEY_LABELS) -> list[dict]:
    """Minimal manifest (id, kind, sha256, host) for the given cards' documents,
    built from keys-all-4/labels.jsonl — never from document text."""
    needed = {c["document_id"] for c in cards}
    kind_of = {c["document_id"]: c.get("kind") for c in cards}
    found: dict[str, dict] = {}
    for line in labels_path.read_text().splitlines():
        if not line.strip() or len(found) == len(needed):
            break
        row = json.loads(line)
        did = row["document_id"]
        if did in needed and did not in found:
            found[did] = {"id": did, "kind": kind_of.get(did, row.get("kind")), "sha256": row["document_sha256"], "host": row["client_id"]}
    missing = needed - found.keys()
    if missing:
        raise ValueError(f"no manifest info in {labels_path} for document id(s): {missing}")
    return list(found.values())


def allowed_levels(stack: list[int]) -> list[int]:
    return list(range(1, (max(stack) if stack else 0) + 2))


def apply_heading(stack: list[int], level: int) -> list[int]:
    return [l for l in stack if l < level] + [level]


def order_cards(cards: list[dict], manifest: list[dict], rng: random.Random) -> list[dict]:
    docs = [m["id"] for m in manifest]
    rng.shuffle(docs)
    rank = {d: i for i, d in enumerate(docs)}

    def key(c: dict):
        pos = int(c["index"]) if "index" in c else int(c.get("locator", c["card_id"]).rsplit(":", 1)[1])
        return (rank.get(c["document_id"], len(rank)), pos)

    return sorted(cards, key=key)


def next_card(cards: list[dict], done: set[str]) -> dict | None:
    return next((c for c in cards if c["card_id"] not in done), None)


def make_row(card: dict, doc: dict, actor: str, type_: str, level: int | None, skipped: bool = False) -> dict:
    heading = type_ == "H"
    row = {
        "id": card["card_id"],
        "label_source": "human-answer",
        "answer_id": str(uuid.uuid4()),
        "actor": actor,
        "client_id": doc["host"],
        "template_id": doc["host"],
        "document_sha256": doc["sha256"],
        "document_stem": doc["id"],
        "document_id": doc["id"],
        "card_id": card["card_id"],
        "kind": card.get("kind"),
        "type": type_,
        "unsure": type_ == "Unsure",
        "label": {"heading": heading, "level": level if heading else None},
        "text_sha256": hashlib.sha256(card["text"].encode()).hexdigest(),
        "why": card.get("why"),
        "repeats_on_pages": card.get("repeats_on_pages"),
        "in_table_box": card.get("in_table_box"),
        "font_pt": card.get("font_pt", card.get("size_pt")),
        "weight": card.get("weight", "bold" if card.get("bold") else "regular"),
        "existing_tag": card.get("existing_tag"),
        "labelled_at": datetime.now(timezone.utc).isoformat(),
    }
    if skipped:
        row["skipped"] = True
    return row


class State:
    def __init__(self, cards: list[dict], manifest: list[dict], actor: str, sample: int | None = None,
                 fixed_order: list[str] | None = None, out_path: Path | None = None):
        self.docs = {m["id"]: m for m in manifest}
        self.actor = actor
        # Fixed-set mode reuses sample mode's "no per-document ladder" waiver
        # (allowed_levels_for below), since a pre-picked card set is not a
        # real per-document reading-order ladder either.
        self.sample = sample or bool(fixed_order)
        self.path = out_path or (OUT / f"labels-{actor}.jsonl")
        if fixed_order is not None:
            by_id = {c["card_id"]: c for c in cards}
            ordered = [by_id[i] for i in fixed_order]  # exact file order, not reading order
        else:
            rng = random.Random(20260913)
            ordered = order_cards(cards, manifest, rng)
            if sample:
                sampled = random.Random(7).sample(ordered, min(sample, len(ordered)))
                sampled_ids = {c["card_id"] for c in sampled}
                ordered = [c for c in ordered if c["card_id"] in sampled_ids]
        self.no_image = sum(1 for c in ordered if c.get("kind") == "pdf" and not card_image_path(c).is_file())
        self.cards = [c for c in ordered if c.get("kind") != "pdf" or card_image_path(c).is_file()]
        lines = [l for l in self.path.read_text().splitlines() if l.strip()] if self.path.is_file() else []
        self.rows: list[dict] = []
        for n, line in enumerate(lines):
            try:
                self.rows.append(json.loads(line))
            except json.JSONDecodeError:
                if n + 1 < len(lines):
                    raise
                print(f"dropped an unparseable final line from {self.path}")
                self.rewrite(self.rows)  # else the next append would glue onto the torn line

    def done(self) -> set[str]:
        return {r["id"] for r in self.rows}

    def stack_for(self, doc_id: str) -> list[int]:
        stack: list[int] = []
        for r in self.rows:
            if r["document_id"] == doc_id and r["label"]["heading"]:
                stack = apply_heading(stack, r["label"]["level"])
        return stack

    def allowed_levels_for(self, doc_id: str) -> list[int]:
        if self.sample:
            return [1, 2, 3, 4, 5, 6]
        return allowed_levels(self.stack_for(doc_id))

    def record(self, card: dict, type_: str, level: int | None, skipped: bool = False) -> None:
        row = make_row(card, self.docs[card["document_id"]], self.actor, type_, level, skipped)
        self.rows.append(row)
        with self.path.open("a") as f:
            f.write(json.dumps(row) + "\n")

    def rewrite(self, rows: list[dict]) -> None:
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text("".join(json.dumps(r) + "\n" for r in rows))
        os.replace(tmp, self.path)  # atomic: a crash leaves the old file or the new one

    def undo(self) -> None:
        if self.rows:
            rows = self.rows[:-1]
            self.rewrite(rows)
            self.rows = rows

    def skip_document(self, doc_id: str) -> None:
        for c in self.cards:
            if c["document_id"] == doc_id and c["card_id"] not in self.done():
                self.record(c, "Unsure", None, skipped=True)


def answer_buttons(card_id: str, levels: list[int]) -> str:
    """Links to the same URLs the keys send, for browsers where keydown never reaches the page."""
    c = quote(card_id, safe="")
    link = lambda href, label, extra="": f'<a class=btn href="{html.escape(href)}"{extra}>{label}</a>'  # noqa: E731
    heads = [link(f"/answer?type=H&level={n}&c={c}", f"H{n}") for n in levels]
    others = [link(f"/answer?type={t}&c={c}", t) for t in ("P", "Artifact", "Caption", "TH", "TOCI", "Lbl", "BlockQuote", "Unsure")]
    skip = link(f"/skip?c={c}", "Skip document", " onclick=\"return confirm('Skip the rest of this document? Every remaining card is written as skipped.')\"")
    return "<p>" + " ".join(heads) + "</p><p>" + " ".join(others) + "</p><p>" + link("/undo", "Undo") + " " + skip + "</p>"


PAGE = """<!doctype html><meta charset=utf-8><title>label</title>
<style>body{{font:15px system-ui;margin:16px;display:grid;grid-template-columns:1fr 420px;gap:16px}}
img{{max-width:100%;border:1px solid #ccc}} .t{{font-size:20px;font-weight:600}} kbd{{border:1px solid #999;padding:1px 5px;border-radius:3px}}
.dim{{color:#666}} .stack{{font-family:monospace}}
.btn{{display:inline-block;margin:2px;padding:4px 9px;border:1px solid #888;border-radius:4px;text-decoration:none;color:#000;background:#f4f4f4}}</style>
<body tabindex=-1>
<div>{image}</div>
<div>
<p class=dim>{progress} · {doc} · {kind} · {no_image} PDF card(s) skipped: no page image</p>
<p class=dim>prev: {prev}</p><p class=t>{text}</p><p class=dim>next: {next}</p>
<p>repeats on <b>{repeats}</b> page(s) · in table: <b>{in_table}</b> · {font}</p>
<p class=stack>approved stack: {stack}</p>
<p><kbd>H</kbd> heading → then level {levels} &nbsp; <kbd>P</kbd> paragraph &nbsp; <kbd>A</kbd> artifact &nbsp; <kbd>C</kbd> caption<br>
<kbd>T</kbd> TH &nbsp; <kbd>O</kbd> TOCI &nbsp; <kbd>L</kbd> Lbl &nbsp; <kbd>B</kbd> blockquote &nbsp; <kbd>U</kbd> unsure &nbsp; <kbd>⌫</kbd> undo &nbsp; <kbd>S</kbd> skip document</p>
{buttons}
</div>
<script>
document.body.focus();
let pendingH=false;const allowed={levels_json};const cardId={card_id_json};
document.addEventListener('keydown',e=>{{if(e.metaKey||e.ctrlKey||e.altKey||e.repeat)return;const k=e.key.toUpperCase();
 if(e.key==='Backspace'){{location.href='/undo';return;}}
 if(e.key==='Escape'){{if(pendingH){{pendingH=false;document.querySelector('.t').style.color='';}}return;}}
 if(pendingH){{const n=parseInt(k);if(allowed.includes(n))location.href='/answer?type=H&level='+n+'&c='+encodeURIComponent(cardId);return;}}
 if(k==='H'){{pendingH=true;document.querySelector('.t').style.color='#06c';return;}}
 if(k==='S'){{if(confirm('Skip the rest of this document? Every remaining card is written as skipped.'))location.href='/skip?c='+encodeURIComponent(cardId);return;}}
 const m={{P:'P',A:'Artifact',C:'Caption',T:'TH',O:'TOCI',L:'Lbl',B:'BlockQuote',U:'Unsure'}};
 if(m[k])location.href='/answer?type='+m[k]+'&c='+encodeURIComponent(cardId);}});
</script>"""


def make_handler(state: State):
    # The server is threaded (see main), so the c= check and the write must not
    # interleave: two in-flight answers for one card would both pass the check.
    lock = threading.Lock()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def send_html(self, body: str) -> None:
            data = body.encode()
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

        def redirect(self) -> None:
            self.send_response(303); self.send_header("Location", "/"); self.end_headers()

        def do_GET(self):
            with lock:
                self.handle_get()

        def handle_get(self):
            url = urlparse(self.path)
            card = next_card(state.cards, state.done())
            if url.path == "/img" and card is not None:
                p = card_image_path(card)
                data = p.read_bytes() if p.is_file() else b""
                self.send_response(200); self.send_header("Content-Type", "image/png"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
            if url.path == "/undo":
                state.undo(); self.redirect(); return
            if card is None:
                self.send_html(f"<p>Done: {len(state.rows)} rows in {state.path}</p>"); return
            if url.path == "/skip":
                q = parse_qs(url.query)
                if q.get("c", [""])[0] != card["card_id"]:
                    self.redirect(); return
                state.skip_document(card["document_id"]); self.redirect(); return
            if url.path == "/answer":
                q = parse_qs(url.query)
                if q.get("c", [""])[0] != card["card_id"]:
                    self.redirect(); return
                type_ = q.get("type", [""])[0]
                level = int(q["level"][0]) if "level" in q else None
                if type_ not in TYPES.values() or (type_ == "H" and level not in state.allowed_levels_for(card["document_id"])):
                    self.redirect(); return
                state.record(card, type_, level); self.redirect(); return
            stack = state.stack_for(card["document_id"])
            levels = state.allowed_levels_for(card["document_id"])
            has_img = card.get("kind") == "pdf" and card_image_path(card).is_file()
            font = f"{card.get('font_pt', card.get('size_pt'))} pt · {card.get('weight', 'bold' if card.get('bold') else 'regular')}"
            self.send_html(PAGE.format(
                image='<img src="/img?c=%s">' % html.escape(card["card_id"]) if has_img else "<p class=dim>(no page image for this card)</p>",
                progress=f"{len(state.done())}/{len(state.cards)}", no_image=state.no_image, doc=html.escape(card["document_id"]), kind=card.get("kind"),
                prev=html.escape(str(card.get("prev"))), text=html.escape(card["text"]), next=html.escape(str(card.get("next"))),
                repeats=card.get("repeats_on_pages", 1), in_table=bool(card.get("in_table_box")), font=html.escape(font),
                stack=" > ".join(f"H{l}" for l in stack) or "(none yet)", levels="/".join(map(str, levels)), levels_json=json.dumps(levels),
                card_id_json=json.dumps(card["card_id"]), buttons=answer_buttons(card["card_id"], levels)))

    return H


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("--actor", required=True)
    a.add_argument("--sample", type=int, default=None, help="label a fixed random sample (second reviewer)")
    a.add_argument("--cards-file", type=Path, default=None, help="serve exactly these card ids (JSONL of {id}), in file order — a fixed audit set")
    a.add_argument("--port", type=int, default=8765)
    args = a.parse_args()
    if args.cards_file:
        ids = read_ids(args.cards_file)
        cards = load_fixed_cards(ids)
        manifest = manifest_for_fixed_cards(cards)
        state = State(cards, manifest, args.actor, fixed_order=ids, out_path=OUT / f"audit-r6-{args.actor}.jsonl")
    else:
        manifest = json.loads((OUT / "manifest.json").read_text())
        cards = []
        for name in ("cards-pdf.jsonl", "cards-word.jsonl"):
            p = OUT / name
            if p.is_file():
                cards += [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
        state = State(cards, manifest, args.actor, args.sample)
    print(f"http://127.0.0.1:{args.port}/  ({len(state.cards)} cards, {len(state.rows)} already labelled, {state.no_image} PDF cards skipped: no page image)")
    # Threading, not the single-threaded HTTPServer: Safari opens speculative
    # keep-alive connections that send nothing, and a one-connection server
    # blocks on them forever, so the page loads once and every click hangs.
    ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(state)).serve_forever()


if __name__ == "__main__":
    main()
