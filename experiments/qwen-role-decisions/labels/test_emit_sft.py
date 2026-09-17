"""emit_sft's two round-4 flags, end to end on a fixture keys dir (no real SFT is written)."""
import json
import tempfile
from pathlib import Path

from labels.emit_sft import main, parse_args


def _keys_dir(root: Path) -> Path:
    rows, cards = [], []
    docs = {"c5-0001": ("planted", 3), "c7-0001": ("planted", 4), "n01": ("stripped-tree", 2)}
    for doc, (src, n) in docs.items():
        for k in range(n):
            rid = f"{doc}:{k}"
            rows.append({"id": rid, "document_id": doc, "type": "H", "label_source": src, "label": {"level": 1}})
            cards.append({"card_id": rid, "text": "Heading words", "page": 0, "y0": k, "repeats_on_pages": 1, "image": "/img.png"})
    rows.append({"id": "n01:p", "document_id": "n01", "type": "P", "label_source": "stripped-tree", "label": {}})
    cards.append({"card_id": "n01:p", "text": "Body words", "page": 0, "y0": 9, "repeats_on_pages": 1, "image": "/img.png"})
    keys = root / "keys"
    keys.mkdir()
    (keys / "labels.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (keys / "cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in cards))
    (keys / "key-headings.json").write_text(json.dumps({d: [] for d in docs}))
    (keys / "split.json").write_text(json.dumps({"ids": {"train": [r["id"] for r in rows]}}))
    return keys


def _run(root: Path, *flags: str) -> dict:
    keys = _keys_dir(root) if not (root / "keys").exists() else root / "keys"
    out = root / f"sft{len(list(root.glob('sft*')))}"
    main(["--keys-dir", str(keys), "--split", str(keys / "split.json"), "--out", str(out), *flags])
    return json.loads((out / "manifest.json").read_text())


def test_defaults_leave_the_manifest_shape_unchanged():
    assert parse_args([]).exclude_doc_prefix == [] and parse_args([]).max_planted_heading_share is None
    with tempfile.TemporaryDirectory() as d:
        m = _run(Path(d))
        assert m["n"] == 10 and m["types"] == {"H": 9, "P": 1}
        assert "excluded_doc_prefix" not in m and "planted_cap" not in m


def test_exclude_doc_prefix_drops_those_documents_before_emit():
    with tempfile.TemporaryDirectory() as d:
        m = _run(Path(d), "--exclude-doc-prefix", "c5-")
        assert m["types"] == {"H": 6, "P": 1}
        assert m["excluded_doc_prefix"] == {"prefixes": ["c5-"], "rows": 3}
        m2 = _run(Path(d), "--exclude-doc-prefix", "c5-", "--exclude-doc-prefix", "c7-")
        assert m2["types"] == {"H": 2, "P": 1} and m2["excluded_doc_prefix"]["rows"] == 7


def test_max_planted_heading_share_caps_and_records_counts():
    with tempfile.TemporaryDirectory() as d:
        m = _run(Path(d), "--exclude-doc-prefix", "c5-", "--max-planted-heading-share", "0.40")
        # 2 real H and 4 planted: keep 1 planted (1/3 <= 0.40; 2/4 is not).
        assert m["planted_cap"] == {"max_share": 0.4, "planted_h": 4, "total_h": 6, "dropped": 3,
                                    "planted_h_after": 1, "total_h_after": 3}
        assert m["types"] == {"H": 3, "P": 1} and m["n"] == 4
        train = json.loads((Path(d) / "sft0" / "train.json").read_text())
        assert len(train) == 4


def test_max_planted_heading_share_fails_loudly_and_writes_nothing():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        keys = _keys_dir(root)
        try:
            main(["--keys-dir", str(keys), "--split", str(keys / "split.json"), "--out", str(root / "sft"),
                  "--exclude-doc-prefix", "n01", "--max-planted-heading-share", "0.40"])
        except ValueError as e:
            assert "no other H rows" in str(e)
        else:
            raise AssertionError("cap with no real headings did not fail")
        assert not (root / "sft").exists()


def test_oversample_regular_h_duplicates_only_regular_weight_heading_rows():
    assert parse_args([]).oversample_regular_h == 1
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        keys = _keys_dir(root)
        cards = [json.loads(l) for l in (keys / "cards.jsonl").read_text().splitlines()]
        for c in cards:  # n01:0 regular heading, n01:1 bold heading, n01:p regular body
            c["weight"] = "bold" if c["card_id"] == "n01:1" else "regular"
        (keys / "cards.jsonl").write_text("".join(json.dumps(c) + "\n" for c in cards))
        base = _run(root, "--exclude-doc-prefix", "c5", "--exclude-doc-prefix", "c7")
        m = _run(root, "--exclude-doc-prefix", "c5", "--exclude-doc-prefix", "c7", "--oversample-regular-h", "2")
        assert base["n"] == 3 and base["types"] == {"H": 2, "P": 1}
        assert m["n"] == 4 and m["types"] == {"H": 3, "P": 1}
        assert m["oversample_regular_h"] == {"factor": 2, "regular_h": 1, "bold_h": 1, "added": 1, "ids": ["n01:0#dup1"]}
