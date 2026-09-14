import json
from labels.sft import cap_planted_headings, emit, prompt_for, stack_before, target_for


def test_stack_before_is_the_approved_ladder_in_reading_order():
    hs = [{"page": 0, "y0": 10, "level": 1, "text": "Title"}, {"page": 0, "y0": 50, "level": 2, "text": "Logging"},
          {"page": 1, "y0": 20, "level": 3, "text": "Paper"}, {"page": 1, "y0": 60, "level": 2, "text": "Storage"}]
    assert [s["text"] for s in stack_before({"page": 1, "y0": 30}, hs)] == ["Title", "Logging", "Paper"]
    assert [s["text"] for s in stack_before({"page": 1, "y0": 70}, hs)] == ["Title", "Storage"]
    assert stack_before({"page": 0, "y0": 5}, hs) == []


def test_stack_before_excludes_the_cards_own_key_heading():
    hs = [{"page": 0, "y0": 100.0, "level": 2, "text": "Logging", "locator": "k:7"},
          {"page": 0, "y0": 90.3, "level": 1, "text": "Above"}]
    card = {"page": 0, "y0": 100.3}
    assert [s["text"] for s in stack_before(card, hs, own_locator="k:7")] == ["Above"]
    assert [s["text"] for s in stack_before(card, hs, own_locator=None)] == ["Above"]


def test_targets_and_emit_hold_back_other_and_rule_decided():
    assert json.loads(target_for({"type": "H", "label": {"level": 2}})) == {"type": "H", "level": 2, "rule": 1}
    assert json.loads(target_for({"type": "TH", "label": {}})) == {"type": "TH", "rule": 3}
    rows = [{"id": "a:1", "document_id": "a", "type": "H", "label": {"heading": True, "level": 1}},
            {"id": "a:2", "document_id": "a", "type": "Other", "label": {"heading": False, "level": None}},
            {"id": "a:3", "document_id": "a", "type": "Lbl", "label": {"heading": False, "level": None}},
            {"id": "a:4", "document_id": "a", "type": "P", "label": {"heading": False, "level": None}}]
    cards = {"a:1": {"text": "Title", "page": 0, "y0": 10, "repeats_on_pages": 1}, "a:2": {"text": "cell", "page": 0, "y0": 20},
             "a:3": {"text": "3", "page": 0, "y0": 30}, "a:4": {"text": "Body", "page": 0, "y0": 40, "repeats_on_pages": 1}}
    out, held = emit(rows, cards, {"a": []}, lambda c: "/img.png", {"a:1", "a:2", "a:3"})
    assert len(out) == 1 and held == {"other": 1, "rule_decided": 1}
    assert "Approved headings so far: none" in out[0]["messages"][0]["content"]
    assert json.loads(out[0]["messages"][1]["content"])["type"] == "H"


def test_emit_sources_are_index_aligned_with_emitted_rows():
    rows = [{"id": "a:1", "document_id": "a", "type": "H", "label_source": "planted", "label": {"level": 1}},
            {"id": "a:2", "document_id": "a", "type": "Other", "label_source": "planted", "label": {}},
            {"id": "a:3", "document_id": "a", "type": "P", "label_source": "word-outline", "label": {}}]
    cards = {i: {"text": "Words", "page": 0, "y0": n, "repeats_on_pages": 1} for n, i in enumerate(["a:1", "a:2", "a:3"])}
    sources = []
    out, _ = emit(rows, cards, {"a": []}, lambda c: "/img.png", {"a:1", "a:2", "a:3"}, sources)
    assert [s["id"] for s in sources] == ["a:1", "a:3"] and len(out) == 2
    assert sources[0] == {"id": "a:1", "label_source": "planted", "type": "H"}


def _h(i, src):
    return {"id": i, "label_source": src, "type": "H"}


def test_cap_planted_headings_drops_by_sha256_of_id_until_the_share_holds():
    import hashlib
    sources = [_h(f"p:{k}", "planted") for k in range(6)] + [_h(f"r:{k}", "stripped-tree") for k in range(3)] \
        + [{"id": "r:p", "label_source": "stripped-tree", "type": "P"}]
    sft = [{"row": s["id"]} for s in sources]
    kept, kept_sources, stats = cap_planted_headings(sft, sources, 0.40)
    # 3 real H: at most 2 planted (2/5 = 0.40), so 4 of 6 planted go.
    assert stats == {"max_share": 0.40, "planted_h": 6, "total_h": 9, "dropped": 4, "planted_h_after": 2, "total_h_after": 5}
    by_hash = sorted((f"p:{k}" for k in range(6)), key=lambda i: hashlib.sha256(i.encode()).hexdigest())
    assert [r["row"] for r in kept] == [i for i in [s["id"] for s in sources] if i not in set(by_hash[:4])]
    assert [s["id"] for s in kept_sources] == [r["row"] for r in kept]
    # Under the cap already: nothing moves.
    kept2, _, stats2 = cap_planted_headings(sft[4:], sources[4:], 0.40)
    assert stats2["dropped"] == 0 and kept2 == sft[4:]


def test_cap_planted_headings_fails_loudly_when_it_cannot_be_met():
    only_planted = [_h("p:1", "planted"), _h("p:2", "planted")]
    for share, sources in ((0.4, only_planted), (1.0, only_planted + [_h("r:1", "x")]), (-0.1, only_planted)):
        try:
            cap_planted_headings([{}] * len(sources), sources, share)
        except ValueError:
            continue
        raise AssertionError(f"no error for share {share}")
