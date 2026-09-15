# labels/test_serve_cards_file.py
"""--cards-file: serve exactly a fixed, pre-picked card set in file order."""
import json
import tempfile
from pathlib import Path

from labels.serve import (
    State,
    load_fixed_cards,
    make_row,
    manifest_for_fixed_cards,
    read_ids,
)
from eligibility_eval import refusals


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))


def test_read_ids_reads_id_field_in_file_order():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "cards.jsonl"
        write_jsonl(p, [{"id": "b:2"}, {"id": "a:1"}, {"id": "b:2"}])
        assert read_ids(p) == ["b:2", "a:1", "b:2"]


def test_load_fixed_cards_returns_them_in_the_requested_order():
    with tempfile.TemporaryDirectory() as d:
        cards_path = Path(d) / "cards-r5.jsonl"
        write_jsonl(cards_path, [
            {"card_id": "a:1", "document_id": "a", "text": "t1", "kind": "pdf"},
            {"card_id": "a:2", "document_id": "a", "text": "t2", "kind": "pdf"},
            {"card_id": "b:1", "document_id": "b", "text": "t3", "kind": "pdf"},
        ])
        out = load_fixed_cards(["b:1", "a:1"], cards_path)
        assert [c["card_id"] for c in out] == ["b:1", "a:1"]


def test_load_fixed_cards_refuses_an_unknown_id_loudly():
    with tempfile.TemporaryDirectory() as d:
        cards_path = Path(d) / "cards-r5.jsonl"
        write_jsonl(cards_path, [{"card_id": "a:1", "document_id": "a", "text": "t1", "kind": "pdf"}])
        try:
            load_fixed_cards(["a:1", "no-such-id"], cards_path)
        except ValueError as e:
            assert "unknown card id" in str(e) and "no-such-id" in str(e)
        else:
            raise AssertionError("expected ValueError for an unknown card id")


def test_manifest_for_fixed_cards_pulls_sha256_and_host_from_key_labels():
    with tempfile.TemporaryDirectory() as d:
        labels_path = Path(d) / "labels.jsonl"
        write_jsonl(labels_path, [
            {"document_id": "a", "document_sha256": "a" * 64, "client_id": "a.gov", "kind": "pdf"},
            {"document_id": "a", "document_sha256": "a" * 64, "client_id": "a.gov", "kind": "pdf"},  # dup doc, ignored
            {"document_id": "b", "document_sha256": "b" * 64, "client_id": "b.gov", "kind": "pdf"},
            {"document_id": "c", "document_sha256": "c" * 64, "client_id": "c.gov", "kind": "pdf"},  # not needed
        ])
        cards = [{"card_id": "a:1", "document_id": "a", "kind": "pdf"}, {"card_id": "b:1", "document_id": "b", "kind": "pdf"}]
        manifest = manifest_for_fixed_cards(cards, labels_path)
        by_id = {m["id"]: m for m in manifest}
        assert set(by_id) == {"a", "b"}
        assert by_id["a"] == {"id": "a", "kind": "pdf", "sha256": "a" * 64, "host": "a.gov"}


def test_manifest_for_fixed_cards_refuses_a_document_missing_from_key_labels():
    with tempfile.TemporaryDirectory() as d:
        labels_path = Path(d) / "labels.jsonl"
        write_jsonl(labels_path, [{"document_id": "a", "document_sha256": "a" * 64, "client_id": "a.gov", "kind": "pdf"}])
        cards = [{"card_id": "a:1", "document_id": "a", "kind": "pdf"}, {"card_id": "z:1", "document_id": "z", "kind": "pdf"}]
        try:
            manifest_for_fixed_cards(cards, labels_path)
        except ValueError as e:
            assert "z" in str(e)
        else:
            raise AssertionError("expected ValueError for a document missing from key labels")


def test_state_fixed_order_serves_only_the_listed_ids_in_that_exact_order():
    # File order deliberately not reading order and not document-grouped —
    # that interleaving is the point of an audit set.
    cards = [
        {"card_id": "a:3", "document_id": "a", "text": "t", "kind": "pdf", "image": "/does/not/exist-a3.png"},
        {"card_id": "a:1", "document_id": "a", "text": "t", "kind": "pdf", "image": "/does/not/exist-a1.png"},
        {"card_id": "b:2", "document_id": "b", "text": "t", "kind": "pdf", "image": "/does/not/exist-b2.png"},
    ]
    manifest = [{"id": "a", "kind": "pdf", "sha256": "a" * 64, "host": "a.gov"}, {"id": "b", "kind": "pdf", "sha256": "b" * 64, "host": "b.gov"}]
    with tempfile.TemporaryDirectory() as d:
        out_path = Path(d) / "audit-r6-test.jsonl"
        # Point each card's image at a real temp file so it is queued.
        for c in cards:
            img = Path(d) / (c["card_id"].replace(":", "_") + ".png")
            img.write_bytes(b"png")
            c["image"] = str(img)
        state = State(cards, manifest, "test-actor", fixed_order=["b:2", "a:3", "a:1"], out_path=out_path)
        assert [c["card_id"] for c in state.cards] == ["b:2", "a:3", "a:1"]
        assert state.path == out_path


def test_state_fixed_order_uses_the_cards_own_image_field():
    with tempfile.TemporaryDirectory() as d:
        img_dir = Path(d)
        real_img = img_dir / "marked-408.png"
        real_img.write_bytes(b"png-bytes")
        cards = [{"card_id": "a:1", "document_id": "a", "text": "t", "kind": "pdf", "image": str(real_img)}]
        manifest = [{"id": "a", "kind": "pdf", "sha256": "a" * 64, "host": "a.gov"}]
        state = State(cards, manifest, "test-actor", fixed_order=["a:1"], out_path=Path(d) / "out.jsonl")
        assert state.no_image == 0
        assert len(state.cards) == 1


def test_state_fixed_order_waives_the_ladder_refusal_like_sample_mode():
    cards = [{"card_id": "a:1", "document_id": "a", "text": "t", "kind": "pdf"}]
    manifest = [{"id": "a", "kind": "pdf", "sha256": "a" * 64, "host": "a.gov"}]
    with tempfile.TemporaryDirectory() as d:
        img = Path(d) / "a_1.png"
        img.write_bytes(b"png")
        cards[0]["image"] = str(img)
        state = State(cards, manifest, "test-actor", fixed_order=["a:1"], out_path=Path(d) / "out.jsonl")
        assert state.allowed_levels_for("a") == [1, 2, 3, 4, 5, 6]


def test_row_written_to_out_path_has_human_answer_label_source_and_passes_the_contract():
    card = {"card_id": "a:1", "document_id": "a", "text": "Some Text", "kind": "pdf", "font_pt": 12, "weight": "bold"}
    doc = {"id": "a", "sha256": "a" * 64, "host": "a.gov"}
    row = make_row(card, doc, "reviewer-x", "P", None)
    assert row["label_source"] == "human-answer"
    assert refusals([row]) == []
