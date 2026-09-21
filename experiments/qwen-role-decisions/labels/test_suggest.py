from labels.suggest import ALL_BLOCKS_LIMIT, CARD_KEYS, COVERAGE_KEYS, LOCATOR_KEYS, SIDECAR_KEYS, assemble_sidecar, asked, choose_cards

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
        assert set(c) == set(CARD_KEYS) == {"card_id", "locator", "text", "type", "level", "rule", "score", "decided_by", "proposed", "depends_on", "in_table_box", "asked"}
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
    assert set(cov) == set(COVERAGE_KEYS) == {"blocks_total", "cards_considered", "selector", "not_heading_confident",
                                              "table_vetoed", "table_not_heading_confident", "split_heads"}
    assert cov == {"blocks_total": 9, "cards_considered": 5, "selector": "likely-headings+5%", "not_heading_confident": 1,
                   "table_vetoed": 0, "table_not_heading_confident": 0, "split_heads": 0}


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
    _, total, _, _ = choose_cards(FIXTURE, "doc", all_blocks=False)
    assert total == 41  # 43 blocks, less the Table container and the K35 copy


def test_all_blocks_considers_every_block_in_the_pool():
    chosen, total, selector, _ = choose_cards(FIXTURE, "doc", all_blocks=False)
    assert len(chosen) < total  # the default selects
    assert selector == "likely-headings+5%"
    every, total_all, selector_all, _ = choose_cards(FIXTURE, "doc", all_blocks=True)
    assert selector_all == "all-blocks"
    assert total_all == total and len(every) == total
    s = assemble_sidecar("doc", THRESHOLD, every, [{"id": c["card_id"], "raw": '{"type":"P","rule":4}', "decided_by": "model", "score": 0.99} for c in every],
                         total_all, "all-blocks")
    assert s["coverage"]["cards_considered"] == s["coverage"]["blocks_total"] == 41
    assert s["coverage"]["selector"] == "all-blocks"


def test_not_heading_confident_counts_proposed_cards_that_are_not_h():
    # doc:1 proposed H (not counted), doc:3 proposed rule Artifact (counted), the rest asked
    assert _sidecar()["coverage"]["not_heading_confident"] == 1
    cards = [_card(n, 0, n * 10.0) for n in (1, 2, 3, 4)]
    raws = ['{"type":"P","rule":4}', '{"type":"Lbl","rule":3}', '{"type":"H","level":1,"rule":1}', '{"type":"P","rule":4}']
    scores = [0.999, 1.0, 0.999, 0.5]  # the last P is asked, so it is not counted
    preds = [{"id": c["card_id"], "raw": r, "decided_by": "model", "score": sc} for c, r, sc in zip(cards, raws, scores)]
    s = assemble_sidecar("doc", THRESHOLD, cards, preds, 4, "all-blocks")
    assert s["coverage"]["not_heading_confident"] == 2
    assert len(s["cards"]) == 4  # the confident non-headings stay in the list


def _body(n: int) -> dict:
    return {"blocks": [_block(i, "P", BODY.format(i)) for i in range(n)]}


def test_all_blocks_at_or_under_the_limit_stays_all_blocks():
    assert ALL_BLOCKS_LIMIT == 600
    cards, total, selector, _ = choose_cards(_body(ALL_BLOCKS_LIMIT), "doc", all_blocks=True)
    assert (total, len(cards), selector) == (600, 600, "all-blocks")


def test_all_blocks_above_the_limit_falls_back_to_the_selector_and_says_so():
    cards, total, selector, _ = choose_cards(_body(ALL_BLOCKS_LIMIT + 1), "doc", all_blocks=True)
    assert total == 601 and len(cards) < total
    assert selector == "likely-headings+5% (all-blocks capped: 601 > 600)"
    default, _, _, _ = choose_cards(_body(ALL_BLOCKS_LIMIT + 1), "doc", all_blocks=False)
    assert [c["card_id"] for c in cards] == [c["card_id"] for c in default]


def _table_sidecar() -> dict:
    """Six cards: in-table P above and below threshold, in-table H above and below, out-of-table P below, out-of-table P above."""
    cards = [{**_card(n, 0, n * 10.0), "in_table_box": n <= 4} for n in range(1, 7)]
    raws = ['{"type":"TH","rule":3}', '{"type":"P","rule":4}', '{"type":"H","level":2,"rule":1}', '{"type":"H","level":2,"rule":1}',
            '{"type":"P","rule":4}', '{"type":"P","rule":4}']
    scores = [0.999, 0.6, 0.999, 0.6, 0.6, 0.999]
    preds = [{"id": c["card_id"], "raw": r, "decided_by": "model", "score": sc} for c, r, sc in zip(cards, raws, scores)]
    return assemble_sidecar("doc", THRESHOLD, cards, preds, 6, "all-blocks")


def test_in_table_non_h_is_vetoed_above_and_below_threshold():
    s = _by_id(_table_sidecar())
    assert s["doc:1"]["in_table_box"] is True and s["doc:1"]["proposed"] is True and not asked(s["doc:1"])
    assert s["doc:2"]["in_table_box"] is True and s["doc:2"]["proposed"] is False and not asked(s["doc:2"])


def test_in_table_h_is_still_asked_at_any_score():
    s = _by_id(_table_sidecar())
    assert asked(s["doc:3"]) and s["doc:3"]["proposed"] is True
    assert asked(s["doc:4"]) and s["doc:4"]["proposed"] is False


def test_out_of_table_below_threshold_non_h_is_still_asked():
    s = _by_id(_table_sidecar())
    assert s["doc:5"]["in_table_box"] is False and asked(s["doc:5"])
    assert not asked(s["doc:6"])  # confident non-heading, out of table: considered, not asked


def test_coverage_splits_vetoed_asks_from_confident_table_cards():
    s = _table_sidecar()
    assert s["coverage"]["table_vetoed"] == 1  # doc:2: in table, non-H, below threshold -- an ask the veto removed
    assert s["coverage"]["table_not_heading_confident"] == 1  # doc:1: in table, non-H, already proposed
    assert s["coverage"]["not_heading_confident"] == 3  # doc:1 and doc:6 (proposed non-H) plus doc:2 (vetoed)
    assert sum(asked(c) for c in s["cards"]) == 3  # doc:3, doc:4, doc:5
    assert sum(asked(c) for c in s["cards"]) + s["coverage"]["not_heading_confident"] == s["coverage"]["cards_considered"]


def test_a_card_without_the_table_fact_is_out_of_table():
    assert _by_id(_sidecar())["doc:1"]["in_table_box"] is False


def test_asked_flag_on_every_branch():
    cards = [{**_card(n, 0, n * 10.0), "in_table_box": t} for n, t in ((1, False), (2, True), (3, True), (4, False), (5, False), (6, True))]
    cases = [('{"type":"H","level":1,"rule":1}', 0.6, True),   # H out of table, below threshold: asked
             ('{"type":"H","level":2,"rule":1}', 0.999, True),  # H in table, proposed: the model's H overrides the veto
             ('{"type":"P","rule":4}', 0.6, False),             # below-threshold non-H in table: vetoed
             ('{"type":"P","rule":4}', 0.6, True),              # below-threshold non-H out of table: asked
             ('{"type":"P","rule":4}', 0.999, False),           # proposed non-H out of table: confident, not asked
             ('{"type":"TH","rule":3}', 0.999, False)]          # proposed non-H in table: confident, not asked
    preds = [{"id": c["card_id"], "raw": r, "decided_by": "model", "score": sc} for c, (r, sc, _) in zip(cards, cases)]
    s = assemble_sidecar("doc", THRESHOLD, cards, preds, 6, "all-blocks")
    assert [c["asked"] for c in s["cards"]] == [want for _, _, want in cases]
    assert all(c["asked"] == asked(c) for c in s["cards"])  # the flag is the Python rule
    cov = s["coverage"]
    assert (cov["table_vetoed"], cov["table_not_heading_confident"], cov["not_heading_confident"]) == (1, 1, 3)
    assert sum(c["asked"] for c in s["cards"]) + cov["not_heading_confident"] == cov["cards_considered"]


# Stage 2 round 2: --split-enumerated-heads. An LI whose first physical line is "B. Scope" and
# its Lbl sibling "B.", beside the FIXTURE body. Synthetic text.
def _enumerated(raw: dict) -> dict:
    li = {**_block(50, "LI", "B. Scope Every widget shall be counted twice.", y0=600.0), "y1": 640.0,
          "first_line": "B. Scope", "line_count": 3, "ancestors": ["L", "Document"]}
    lbl = {**_block(51, "Lbl", "B.", y0=600.0), "first_line": "B.", "line_count": 1, "ancestors": ["LI", "L", "Document"]}
    return {**raw, "blocks": raw["blocks"] + [li, lbl]}


def test_split_enumerated_heads_is_off_by_default_and_counted_when_on():
    raw = _enumerated(FIXTURE)
    off, total_off, _, n_off = choose_cards(raw, "doc", all_blocks=True)
    assert n_off == 0 and "doc:50h" not in {c["card_id"] for c in off}
    on, total_on, selector, n_on = choose_cards(raw, "doc", all_blocks=True, split_heads=True)
    assert n_on == 1 and total_on == total_off + 1 and selector == "all-blocks"
    by = {c["card_id"]: c for c in on}
    assert by["doc:50h"]["text"] == "B. Scope" and by["doc:50"]["text"] == "Every widget shall be counted twice."
    assert by["doc:50h"]["y1"] == by["doc:50"]["y0"] == 600.0 + 1.3 * 11
    assert by["doc:51"]["text"] == "B."  # the numeral-only Lbl sibling is untouched
    ids = [c["card_id"] for c in on]
    assert ids.index("doc:50h") < ids.index("doc:50")  # head before body in reading order
    s = assemble_sidecar("doc", THRESHOLD, on, [{"id": c["card_id"], "raw": '{"type":"P","rule":4}', "decided_by": "model", "score": 0.5} for c in on],
                         total_on, selector, split_heads=n_on)
    assert s["coverage"]["split_heads"] == 1 and set(s["coverage"]) == set(COVERAGE_KEYS)


def test_split_enumerated_heads_does_not_change_the_default_selection_otherwise():
    """With nothing to split, the flag leaves the cards exactly as they were."""
    off = choose_cards(FIXTURE, "doc", all_blocks=False)
    on = choose_cards(FIXTURE, "doc", all_blocks=False, split_heads=True)
    assert on == off and on[3] == 0


# Stage 2 run-in split: --split-run-in-heads WIDTH. A P block whose first physical line is
# a short run-in heading ending at 45 % of the block width, beside the FIXTURE body.
# Synthetic text.
def _run_in(raw: dict) -> dict:
    p = {**_block(60, "P", "Plant Selection Native species thrive on this site.", y0=660.0), "y1": 700.0,
         "first_line": "Plant Selection", "line_count": 4, "first_line_x1": 135.0}
    return {**raw, "blocks": raw["blocks"] + [p]}


def test_split_run_in_heads_is_off_by_default_and_counted_when_on():
    raw = _run_in(FIXTURE)
    off, total_off, _, n_off = choose_cards(raw, "doc", all_blocks=True)
    assert n_off == 0 and "doc:60h" not in {c["card_id"] for c in off}
    on, total_on, selector, n_on = choose_cards(raw, "doc", all_blocks=True, run_in_width=0.6)
    assert n_on == 1 and total_on == total_off + 1 and selector == "all-blocks"
    by = {c["card_id"]: c for c in on}
    assert by["doc:60h"]["text"] == "Plant Selection" and by["doc:60"]["text"] == "Native species thrive on this site."
    assert by["doc:60h"]["y1"] == by["doc:60"]["y0"] == 660.0 + 1.3 * 11
    ids = [c["card_id"] for c in on]
    assert ids.index("doc:60h") < ids.index("doc:60")  # head before body in reading order
    s = assemble_sidecar("doc", THRESHOLD, on, [{"id": c["card_id"], "raw": '{"type":"P","rule":4}', "decided_by": "model", "score": 0.5} for c in on],
                         total_on, selector, split_heads=n_on)
    assert s["coverage"]["split_heads"] == 1 and set(s["coverage"]) == set(COVERAGE_KEYS)


def test_split_run_in_heads_does_not_change_the_default_selection_otherwise():
    """With nothing to split, the flag leaves the cards exactly as they were."""
    off = choose_cards(FIXTURE, "doc", all_blocks=False)
    on = choose_cards(FIXTURE, "doc", all_blocks=False, run_in_width=0.6)
    assert on == off and on[3] == 0


def test_split_enumerated_heads_output_is_unchanged_with_the_run_in_flag_present():
    """The round-2 flag's output is byte-identical whether or not a run-in width is passed:
    the enumerated fixture carries no first_line_x1, so the run-in rule never fires."""
    raw = _enumerated(FIXTURE)
    a = choose_cards(raw, "doc", all_blocks=True, split_heads=True)
    b = choose_cards(raw, "doc", all_blocks=True, split_heads=True, run_in_width=0.6)
    assert a == b and a[3] == 1
