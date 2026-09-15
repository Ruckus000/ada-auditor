# labels/test_serve.py
import json
import random
import tempfile
import threading
from contextlib import contextmanager
from http.client import HTTPConnection
from http.server import HTTPServer
from pathlib import Path

import labels.serve as serve
from labels.serve import State, allowed_levels, apply_heading, make_handler, make_row, next_card, order_cards
from eligibility_eval import refusals


@contextmanager
def images_for(*card_ids):
    """Point serve.image_path at a temp dir holding a PNG for each given card id only."""
    real = serve.image_path
    with tempfile.TemporaryDirectory() as d:
        serve.image_path = lambda c: Path(d) / (c["card_id"].replace(":", "_") + ".png")
        for cid in card_ids:
            serve.image_path({"card_id": cid}).write_bytes(b"png")
        try:
            yield
        finally:
            serve.image_path = real


def fresh(actor):
    path = Path(f"out/labels/labels-{actor}.jsonl")
    for q in (path, path.with_name(path.name + ".tmp")):
        if q.is_file():
            q.unlink()
    return path


def test_allowed_levels_forbid_skips():
    assert allowed_levels([]) == [1]
    assert allowed_levels([1]) == [1, 2]
    assert allowed_levels([1, 2, 3]) == [1, 2, 3, 4]
    assert apply_heading([1, 2, 3], 2) == [1, 2]
    assert apply_heading([1], 2) == [1, 2]


def test_order_cards_shuffles_documents_but_keeps_reading_order():
    cards = [{"card_id": "a:2", "document_id": "a", "page": 0, "y0": 700}, {"card_id": "a:1", "document_id": "a", "page": 0, "y0": 500},
             {"card_id": "b:p3", "document_id": "b", "index": 3}, {"card_id": "b:p1", "document_id": "b", "index": 1}]
    manifest = [{"id": "a", "kind": "pdf"}, {"id": "b", "kind": "docx"}]
    out = [c["card_id"] for c in order_cards(cards, manifest, random.Random(3))]
    assert out.index("a:1") < out.index("a:2") and out.index("b:p1") < out.index("b:p3")
    assert next_card(order_cards(cards, manifest, random.Random(3)), {"a:1", "a:2", "b:p1", "b:p3"}) is None


def test_make_row_passes_the_evaluator_contract_and_hides_text():
    card = {"card_id": "n34:p7", "document_id": "n34", "kind": "docx", "text": "Public Comment", "prev": "x", "next": "y",
            "existing_tag": "P", "why": ["short"], "repeats_on_pages": 1, "bold": True, "size_pt": 14.0}
    doc = {"id": "n34", "sha256": "a" * 64, "host": "fnsb.gov"}
    row = make_row(card, doc, "reviewer-a", "H", 2)
    assert refusals([row]) == []
    assert row["label"] == {"heading": True, "level": 2} and row["type"] == "H"
    assert "text" not in row and len(row["text_sha256"]) == 64
    assert row["client_id"] == row["template_id"] == "fnsb.gov" and row["document_stem"] == "n34"
    p = make_row(card, doc, "reviewer-a", "Caption", None)
    assert p["label"] == {"heading": False, "level": None} and refusals([p]) == []
    u = make_row(card, doc, "reviewer-a", "Unsure", None)
    assert u["unsure"] is True


def test_sample_mode_waives_the_skip_refusal_and_keeps_reading_order():
    cards = [{"card_id": "a:2", "document_id": "a", "page": 0, "y0": 700, "text": "t", "kind": "pdf"},
             {"card_id": "a:1", "document_id": "a", "page": 0, "y0": 500, "text": "t", "kind": "pdf"},
             {"card_id": "b:p3", "document_id": "b", "index": 3, "text": "t", "kind": "docx"},
             {"card_id": "b:p1", "document_id": "b", "index": 1, "text": "t", "kind": "docx"}]
    manifest = [{"id": "a", "kind": "pdf", "sha256": "a" * 64, "host": "a.gov"},
                {"id": "b", "kind": "docx", "sha256": "b" * 64, "host": "b.gov"}]

    with images_for("a:1", "a:2"):
        sample_state = State(cards, manifest, "reviewer-b", sample=4)
        assert sample_state.allowed_levels_for("a") == [1, 2, 3, 4, 5, 6]
        ids = [c["card_id"] for c in sample_state.cards if c["document_id"] == "a"]
        assert ids == ["a:1", "a:2"]

        normal_state = State(cards, manifest, "reviewer-a", sample=None)
        assert normal_state.allowed_levels_for("a") == [1]


def test_order_cards_follows_tree_reading_order_with_top_origin_y0():
    # Real relation from Cards.java: y0 is top-origin (grows downward), and the
    # locator index is tree order. A two-column page puts a:3 (right column,
    # top) after a:2 (left column, bottom) in reading order despite a smaller y0.
    cards = [{"card_id": "a:3", "locator": "a:3", "document_id": "a", "page": 0, "y0": 90.0},
             {"card_id": "a:10", "locator": "a:10", "document_id": "a", "page": 1, "y0": 80.0},
             {"card_id": "a:2", "locator": "a:2", "document_id": "a", "page": 0, "y0": 640.0},
             {"card_id": "a:1", "locator": "a:1", "document_id": "a", "page": 0, "y0": 72.0},
             {"card_id": "b:p12", "document_id": "b", "index": 12}, {"card_id": "b:p2", "document_id": "b", "index": 2}]
    manifest = [{"id": "a", "kind": "pdf"}, {"id": "b", "kind": "docx"}]
    out = [c["card_id"] for c in order_cards(cards, manifest, random.Random(3))]
    assert [c for c in out if c.startswith("a:")] == ["a:1", "a:2", "a:3", "a:10"]
    assert [c for c in out if c.startswith("b:")] == ["b:p2", "b:p12"]


def test_queue_skips_pdf_cards_without_an_image_and_says_how_many():
    cards = [{"card_id": "a:1", "document_id": "a", "page": 0, "y0": 50, "text": "t", "kind": "pdf"},
             {"card_id": "a:2", "document_id": "a", "page": 0, "y0": 90, "text": "t", "kind": "pdf"},
             {"card_id": "b:p1", "document_id": "b", "index": 1, "text": "t", "kind": "docx"}]
    manifest = [{"id": "a", "kind": "pdf", "sha256": "a" * 64, "host": "a.gov"},
                {"id": "b", "kind": "docx", "sha256": "b" * 64, "host": "b.gov"}]
    path = fresh("noimage-test")
    with images_for("a:2"):
        state = State(cards, manifest, "noimage-test", sample=None)
        assert [c["card_id"] for c in state.cards if c["kind"] == "pdf"] == ["a:2"]
        assert state.no_image == 1 and len(state.cards) == 2
        server = HTTPServer(("127.0.0.1", 0), make_handler(state))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            conn = HTTPConnection("127.0.0.1", server.server_address[1])
            conn.request("GET", "/")
            body = conn.getresponse().read().decode()
            assert "1 PDF card(s) skipped: no page image" in body
        finally:
            server.shutdown()
            thread.join()
    assert not path.is_file()


def test_skip_document_marks_rows_skipped_and_unsure():
    cards = [{"card_id": "b:p1", "document_id": "b", "index": 1, "text": "t", "kind": "docx"},
             {"card_id": "b:p2", "document_id": "b", "index": 2, "text": "t", "kind": "docx"},
             {"card_id": "c:p1", "document_id": "c", "index": 1, "text": "t", "kind": "docx"}]
    manifest = [{"id": "b", "kind": "docx", "sha256": "b" * 64, "host": "b.gov"},
                {"id": "c", "kind": "docx", "sha256": "c" * 64, "host": "c.gov"}]
    path = fresh("skip-test")
    try:
        state = State(cards, manifest, "skip-test", sample=None)
        state.record(cards[0], "P", None)
        state.skip_document("b")
        rows = [json.loads(l) for l in path.read_text().splitlines()]
        assert [r["card_id"] for r in rows] == ["b:p1", "b:p2"]
        assert "skipped" not in rows[0] and rows[0]["unsure"] is False
        assert rows[1]["skipped"] is True and rows[1]["unsure"] is True and rows[1]["type"] == "Unsure"
        assert refusals(rows) == []
    finally:
        fresh("skip-test")


def test_undo_rewrites_through_a_temp_file_and_replace():
    cards = [{"card_id": "b:p1", "document_id": "b", "index": 1, "text": "t", "kind": "docx"},
             {"card_id": "b:p2", "document_id": "b", "index": 2, "text": "t", "kind": "docx"}]
    manifest = [{"id": "b", "kind": "docx", "sha256": "b" * 64, "host": "b.gov"}]
    path = fresh("undo-test")
    real_replace = serve.os.replace
    try:
        state = State(cards, manifest, "undo-test", sample=None)
        state.record(cards[0], "P", None)
        state.record(cards[1], "P", None)
        before = path.read_text()

        def crash(src, dst):
            raise OSError("killed mid-undo")
        serve.os.replace = crash
        try:
            state.undo()
        except OSError:
            pass
        assert path.read_text() == before  # the label file is untouched until the replace
        serve.os.replace = real_replace
        state.undo()
        assert [json.loads(l)["card_id"] for l in path.read_text().splitlines()] == ["b:p1"]
        assert not path.with_name(path.name + ".tmp").is_file()
    finally:
        serve.os.replace = real_replace
        fresh("undo-test")


def test_state_drops_a_torn_final_line_but_raises_on_a_torn_middle_line():
    cards = [{"card_id": "b:p1", "document_id": "b", "index": 1, "text": "t", "kind": "docx"},
             {"card_id": "b:p2", "document_id": "b", "index": 2, "text": "t", "kind": "docx"}]
    manifest = [{"id": "b", "kind": "docx", "sha256": "b" * 64, "host": "b.gov"}]
    path = fresh("torn-test")
    try:
        good = json.dumps(make_row(cards[0], manifest[0], "torn-test", "P", None))
        path.write_text(good + "\n" + '{"id": "b:p2", "lab')
        state = State(cards, manifest, "torn-test", sample=None)
        assert [r["card_id"] for r in state.rows] == ["b:p1"]
        assert path.read_text() == good + "\n"  # the torn line is gone from disk too
        path.write_text('{"id": "b:p2", "lab\n' + good + "\n")
        try:
            State(cards, manifest, "torn-test", sample=None)
        except json.JSONDecodeError:
            pass
        else:
            raise AssertionError("an unparseable non-final line must raise")
    finally:
        fresh("torn-test")


def test_answer_refuses_a_replay_carrying_a_stale_card_id():
    cards = [{"card_id": "a:1", "document_id": "a", "page": 0, "y0": 500, "text": "t", "kind": "pdf"},
             {"card_id": "a:2", "document_id": "a", "page": 0, "y0": 700, "text": "t", "kind": "pdf"}]
    manifest = [{"id": "a", "kind": "pdf", "sha256": "a" * 64, "host": "a.gov"}]
    path = Path("out/labels/labels-guard-test.jsonl")
    if path.is_file():
        path.unlink()
    with images_for("a:1", "a:2"):
        state = State(cards, manifest, "guard-test", sample=None)
    server = HTTPServer(("127.0.0.1", 0), make_handler(state))
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        conn = HTTPConnection("127.0.0.1", port)
        # First /answer for the shown card (a:1): recorded.
        conn.request("GET", "/answer?type=P&c=a:1")
        conn.getresponse().read()
        # Replaying the exact same request: by now the current card has
        # advanced to a:2, so the stale c=a:1 must be refused, not recorded
        # as a decision on a:2.
        conn.request("GET", "/answer?type=P&c=a:1")
        conn.getresponse().read()
        rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
        assert len(rows) == 1
        assert rows[0]["card_id"] == "a:1"
    finally:
        server.shutdown()
        thread.join()
        if path.is_file():
            path.unlink()


def test_answer_buttons_hit_the_same_urls_as_the_keys():
    from labels.serve import answer_buttons
    out = answer_buttons("c6-0001:7 x", [1, 2])
    assert 'href="/answer?type=H&amp;level=1&amp;c=c6-0001%3A7%20x"' in out
    assert 'href="/answer?type=H&amp;level=2&amp;c=c6-0001%3A7%20x"' in out
    assert "level=3" not in out  # only allowed levels are offered
    for t in ("P", "Artifact", "Caption", "TH", "TOCI", "Lbl", "BlockQuote", "Unsure"):
        assert f'href="/answer?type={t}&amp;c=c6-0001%3A7%20x"' in out
    assert 'href="/undo"' in out and 'href="/skip?c=c6-0001%3A7%20x"' in out and "confirm(" in out


def test_two_concurrent_answers_for_one_card_write_one_row_under_a_threading_server():
    import time
    from http.server import ThreadingHTTPServer
    cards = [{"card_id": "c:1", "document_id": "c", "index": 1, "text": "t", "kind": "docx"},
             {"card_id": "c:2", "document_id": "c", "index": 2, "text": "t", "kind": "docx"}]
    manifest = [{"id": "c", "kind": "docx", "sha256": "c" * 64, "host": "c.gov"}]
    path = fresh("race-test")
    state = State(cards, manifest, "race-test", sample=None)
    real = state.record
    def slow(*a, **k):
        time.sleep(0.2); real(*a, **k)
    state.record = slow
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(state))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        def hit():
            conn = HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
            conn.request("GET", "/answer?type=P&c=c%3A1"); conn.getresponse().read()
        ts = [threading.Thread(target=hit) for _ in range(2)]
        [t.start() for t in ts]; [t.join() for t in ts]
        assert len(path.read_text().splitlines()) == 1
    finally:
        srv.shutdown(); srv.server_close(); fresh("race-test")
