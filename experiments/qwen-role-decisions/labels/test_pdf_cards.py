import random
from labels.pdf_cards import repeats_on_pages, select_candidates


def card(i, text, tag="P", pt=11, weight="regular", page=0, y0=700):
    return {"locator": f"d:{i}", "text": text, "existing_tag": tag, "font_pt": pt, "weight": weight,
            "page": page, "x0": 50, "y0": y0, "x1": 300, "y1": y0 + 12, "prev": "none", "next": "none",
            "ancestors": [], "in_table_box": False}


def test_repeats_counts_same_text_same_band_across_pages():
    cards = [card(0, "Town of X · Page", page=0, y0=760), card(1, "Town of X · Page", page=1, y0=762),
             card(2, "Town of X · Page", page=2, y0=40), card(3, "Body text here.", page=0)]
    r = repeats_on_pages(cards)
    assert r["d:0"] == 2 and r["d:1"] == 2 and r["d:2"] == 1 and r["d:3"] == 1


def test_select_keeps_source_headings_short_lines_outliers_and_a_random_slice():
    body = [card(i, "A long sentence of ordinary running body text that goes on for a while.", pt=11) for i in range(100)]
    cards = body + [card(200, "Source heading", tag="H2"), card(201, "Public Comment"),
                    card(202, "Big text sentence that is long enough to fail the short rule okay.", pt=18),
                    card(203, "Bold sentence that is long enough to fail the short rule okay yes.", weight="bold")]
    out = select_candidates(cards, random.Random(1))
    why = {c["locator"]: c["why"] for c in out}
    assert "source_h" in why["d:200"] and "short" in why["d:201"]
    assert "outlier" in why["d:202"] and "outlier" in why["d:203"]
    randoms = [c for c in out if c["why"] == ["random"]]
    assert 1 <= len(randoms) <= 15
    assert all(c["card_id"].endswith(c["locator"].split(":")[1]) for c in out)


def test_table_contained_blocks_enter_only_as_source_headings():
    inside = card(0, "Fee"); inside["in_table_box"] = True
    toc = card(1, "Contents entry"); toc["ancestors"] = ["Document", "TOC", "TOCI"]
    h_in = card(2, "Heading in table", tag="H2"); h_in["in_table_box"] = True
    out = select_candidates([inside, toc, h_in] + [card(i, "x" * 5 + " long sentence text that is body copy and terminates properly.") for i in range(10, 30)], random.Random(0))
    ids = {c["locator"]: c["why"] for c in out}
    assert "d:0" not in ids and "d:1" not in ids
    assert ids["d:2"] == ["source_h"]


def test_cap_per_document_keeps_best_reasons_and_all_random_rows():
    from labels.pdf_cards import cap_per_document
    rows = [{"document_id": "a", "why": ["short"], "n": i} for i in range(300)]
    rows += [{"document_id": "a", "why": ["source_h"], "n": 900 + i} for i in range(5)]
    rows += [{"document_id": "a", "why": ["random"], "n": 990 + i} for i in range(7)]
    rows += [{"document_id": "b", "why": ["outlier"], "n": 2000}]
    out = cap_per_document(rows, random.Random(0), cap=10)
    a = [r for r in out if r["document_id"] == "a"]
    assert len(a) == 10 + 7 and sum(r["why"] == ["source_h"] for r in a) == 5
    assert sum(r["why"] == ["random"] for r in a) == 7
    assert [r["n"] for r in out if r["document_id"] == "b"] == [2000]
