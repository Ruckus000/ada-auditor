from labels.suggest import CARD_KEYS, COVERAGE_KEYS, LOCATOR_KEYS, SIDECAR_KEYS, assemble_sidecar, choose_cards

THRESHOLD = 0.9933


def _card(n: int, page: int, y0: float) -> dict:
    return {"card_id": f"doc:{n}", "document_id": "doc", "page": page, "x0": 10.0, "y0": y0, "x1": 200.0, "y1": y0 + 12,
            "text": f"card {n}", "font_pt": 11, "ancestors": ["Document"]}


CARDS = [_card(3, 1, 20.0), _card(1, 0, 10.0), _card(2, 0, 40.0), _card(4, 1, 60.0), _card(5, 1, 80.0)]
PREDICTIONS = [
    {"id": "doc:1", "raw": '{"type":"H","level":1,"rule":1}', "decided_by": "model", "p_H": 0.9933, "score": THRESHOLD, "score_method": "logprob"},
    {"id": "doc:2", "raw": '{"type":"P","rule":4}', "decided_by": "model", "p_H": 0.0068, "score": 0.9932, "score_method": "logprob"},
    {"id": "doc:3", "raw": '{"type":"Artifact","rule":2}', "decided_by": "rule", "p_H": None, "score": 1.0, "score_method": "rule"},
    {"id": "doc:4", "raw": 'noise {"type":"H","level":2,"rule":1}', "decided_by": "model", "p_H": 0.7, "score": 0.7, "score_method": "logprob"},
    {"id": "doc:5", "raw": "no json", "decided_by": "model", "p_H": None, "score": None, "score_method": "logprob_missing"},
]


def _sidecar() -> dict:
    return assemble_sidecar("doc", THRESHOLD, CARDS, PREDICTIONS, blocks_total=9, selector="likely-headings+5%")


def _by_id(sidecar: dict) -> dict:
    return {c["card_id"]: c for c in sidecar["cards"]}


def test_sidecar_has_the_exact_shape_and_key_set():
    s = _sidecar()
    assert set(s) == set(SIDECAR_KEYS) == {"document", "threshold", "page_base", "coverage", "cards"}
    assert s["document"] == "doc" and s["threshold"] == THRESHOLD
    assert [c["card_id"] for c in s["cards"]] == ["doc:1", "doc:2", "doc:3", "doc:4", "doc:5"]  # reading order
    for c in s["cards"]:
        assert set(c) == set(CARD_KEYS) == {"card_id", "locator", "text", "type", "level", "rule", "score", "decided_by", "proposed", "depends_on"}
        assert set(c["locator"]) == set(LOCATOR_KEYS) == {"page", "x0", "y0", "x1", "y1"}
    one = _by_id(s)["doc:1"]
    assert one["locator"] == {"page": 0, "x0": 10.0, "y0": 10.0, "x1": 200.0, "y1": 22.0}
    assert (one["text"], one["type"], one["level"], one["rule"], one["decided_by"]) == ("card 1", "H", 1, 1, "model")


def test_proposed_at_the_threshold_boundary():
    s = _by_id(_sidecar())
    assert s["doc:1"]["proposed"] is True  # score exactly at the threshold
    assert s["doc:2"]["proposed"] is False  # just below it


def test_abstained_rows_are_present_and_not_proposed():
    s = _by_id(_sidecar())
    assert s["doc:4"]["proposed"] is False and (s["doc:4"]["type"], s["doc:4"]["level"]) == ("H", 2)
    # no score (logprob missing) and no parsable JSON: still a row, never proposed
    assert s["doc:5"]["proposed"] is False and s["doc:5"]["score"] is None
    assert (s["doc:5"]["type"], s["doc:5"]["level"], s["doc:5"]["rule"]) == (None, None, None)


def test_rule_decided_rows_are_proposed_with_score_one():
    s = _by_id(_sidecar())
    assert s["doc:3"] == {**s["doc:3"], "type": "Artifact", "rule": 2, "level": None, "score": 1.0, "decided_by": "rule", "proposed": True}


def test_a_card_without_a_prediction_or_a_prediction_without_a_card_is_refused():
    for cards, preds in ((CARDS, PREDICTIONS[:-1]), (CARDS[:-1], PREDICTIONS)):
        try:
            assemble_sidecar("doc", THRESHOLD, cards, preds, 9, "likely-headings+5%")
        except ValueError:
            continue
        raise AssertionError("expected a mismatch between cards and predictions to be refused")


def test_page_base_is_zero():
    assert _sidecar()["page_base"] == 0


def test_depends_on_is_the_own_stack_each_card_was_predicted_under_including_an_asked_heading():
    s = _by_id(_sidecar())
    assert s["doc:1"]["depends_on"] == []  # first card: empty stack
    assert s["doc:2"]["depends_on"] == ["doc:1"]
    assert s["doc:3"]["depends_on"] == ["doc:1"]  # rule-decided rows get it too
    assert s["doc:4"]["depends_on"] == ["doc:1"]  # an H2 does not stand on itself
    # doc:4 is an asked (below-threshold) H2, and it is still in the chain
    assert s["doc:5"]["depends_on"] == ["doc:1", "doc:4"]


def test_depends_on_follows_the_stack_when_a_heading_closes_a_deeper_one():
    cards = [_card(1, 0, 10.0), _card(2, 0, 20.0), _card(3, 0, 30.0), _card(4, 0, 40.0)]
    raws = ['{"type":"H","level":1,"rule":1}', '{"type":"H","level":2,"rule":1}', '{"type":"H","level":1,"rule":1}', '{"type":"P","rule":4}']
    preds = [{"id": c["card_id"], "raw": r, "decided_by": "model", "score": 0.5} for c, r in zip(cards, raws)]
    s = _by_id(assemble_sidecar("doc", THRESHOLD, cards, preds, 4, "all-blocks"))
    assert [s[f"doc:{n}"]["depends_on"] for n in (1, 2, 3, 4)] == [[], ["doc:1"], ["doc:1", "doc:2"], ["doc:3"]]


def test_coverage_counts():
    cov = _sidecar()["coverage"]
    assert set(cov) == set(COVERAGE_KEYS) == {"blocks_total", "cards_considered", "selector"}
    assert cov == {"blocks_total": 9, "cards_considered": 5, "selector": "likely-headings+5%"}


def _block(i: int, tag: str, text: str, y0: float | None = None) -> dict:
    y = i * 12 if y0 is None else y0
    return {"locator": f"doc:{i}", "existing_tag": tag, "text": text, "font_pt": 11, "weight": "regular", "page": 0,
            "x0": 0, "y0": y, "x1": 300, "y1": y + 10, "ancestors": []}


# 40 body sentences (none is short, bold or large, so only the 5 % slice can pick one),
# one heading, one table container, and a K35 duplicate of block 1.
BODY = "This is body sentence number {} and it runs on well past fifteen words so it is never short at all."
FIXTURE = {"blocks": [_block(0, "H1", "Fees")] + [_block(i, "P", BODY.format(i)) for i in range(1, 41)]
           + [_block(41, "Table", "Fee Amount"), {**_block(1, "P", BODY.format(1)), "locator": "doc:42"}]}


def test_blocks_total_is_the_pool_after_dedupe_and_container_removal():
    _, total = choose_cards(FIXTURE, "doc", all_blocks=False)
    assert total == 41  # 43 blocks, less the Table container and the K35 copy


def test_all_blocks_considers_every_block_in_the_pool():
    chosen, total = choose_cards(FIXTURE, "doc", all_blocks=False)
    assert len(chosen) < total  # the default selects
    every, total_all = choose_cards(FIXTURE, "doc", all_blocks=True)
    assert total_all == total and len(every) == total
    s = assemble_sidecar("doc", THRESHOLD, every, [{"id": c["card_id"], "raw": '{"type":"P","rule":4}', "decided_by": "model", "score": 0.99} for c in every],
                         total_all, "all-blocks")
    assert s["coverage"]["cards_considered"] == s["coverage"]["blocks_total"] == 41
    assert s["coverage"]["selector"] == "all-blocks"
