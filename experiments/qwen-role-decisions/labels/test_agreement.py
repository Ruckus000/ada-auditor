from labels.agreement import agreement


def row(i, t, level=None, unsure=False):
    return {"id": i, "type": t, "unsure": unsure, "label": {"heading": t == "H", "level": level}}


def test_agreement_rates_and_disagreement_list():
    a = [row("1", "H", 1), row("2", "P"), row("3", "Caption"), row("4", "H", 2), row("5", "Unsure", unsure=True)]
    b = [row("1", "H", 1), row("2", "P"), row("3", "H", 2), row("4", "H", 3), row("5", "P")]
    r = agreement(a, b)
    assert r["n"] == 4 and r["type_agreement"] == 0.75 and r["heading_agreement"] == 0.75
    assert r["level_agreement"] == 0.5 and r["unsure"] == {"a": 1, "b": 0}
    assert [d["id"] for d in r["disagreements"]] == ["3", "4"]
