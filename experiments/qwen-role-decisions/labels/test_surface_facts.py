from labels.surface_facts import facts, pooled


def test_pooled_facts_are_over_the_cards_together():
    a = [{"text": "Scope", "weight": "bold", "font_pt": 12}] * 3
    b = [{"text": "GENERAL PROVISIONS", "weight": "regular", "font_pt": 16}]
    groups = {("H", "stripped-tree"): a, ("H", "word-outline"): b, ("H", "planted"): [{"text": "x"}] * 9}
    [row] = pooled(groups, ["stripped-tree", "word-outline"])
    assert row == {"type": "H", "source": "pooled:stripped-tree+word-outline", **facts(a + b)}
    assert row["n"] == 4 and row["bold"] == 0.75 and row["all_caps"] == 0.25
    assert pooled(groups, []) == []
