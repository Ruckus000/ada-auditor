from probe_lib import enum_class, features, host_of, rank, text_shape, vetoed_read

CARD = {"text": "IV. Public Comments", "font_pt": 14, "body_font_pt": 10, "weight": "bold", "existing_tag": "P",
        "ancestors": ["LI", "L", "Document"], "in_table_box": False, "repeats_on_pages": 1, "margin_band": None,
        "after_inline_label": False, "x0": 10, "y0": 20, "x1": 110, "y1": 34, "prev": "none", "next": "Members spoke."}


def test_enum_class_matches_the_probe3_shapes():
    assert enum_class("IV. Public Comments") == "roman"
    assert enum_class("SECTION 2. AMENDMENT.") == "kw"
    assert enum_class("1.2 Scope") == "arabic"
    assert enum_class("A. Plans") == "letter"
    assert enum_class("Plans") == "none"
    assert enum_class("10") == "none"


def test_text_shape_and_empty_neighbours():
    s = text_shape("Fees:")
    assert s["colon"] and not s["period"] and s["words"] == 1 and s["caps"] == 0.25
    e = text_shape(None, "prev_")
    assert e == {"prev_len": 0, "prev_words": 0, "prev_caps": 0.0, "prev_digits": 0.0, "prev_enum": "none",
                 "prev_colon": False, "prev_period": False}


def test_features_use_no_label_and_read_ancestors():
    f = features(CARD, doc_fonts=[10, 10, 14, 18], page_y=[5, 20, 40], page_x=[10, 50])
    assert f["font_ratio"] == 1.4 and f["font_rank_doc"] == 0.5
    assert f["anc_LI"] and f["anc_L"] and not f["anc_Table"] and f["anc_depth"] == 3
    assert f["y_rank_page"] == 1 / 3 and f["x_rank_page"] == 0.0
    assert f["margin_band"] == "none" and f["prev_len"] == 0 and f["next_period"]
    assert not any(k in f for k in ("type", "label", "heading", "score", "p_H"))


def test_host_of_drops_www():
    assert host_of("https://www.lincolnnh.gov/DocumentCenter/View/300") == "lincolnnh.gov"
    assert rank([], 3) == 0.0


def row(said, truth, p, by="model", doc="d1"):
    return {"said_h": said, "truth": truth, "p_h": p, "by": by, "doc": doc}


def test_vetoed_read_counts_caught_lost_and_coverage():
    decided = [
        row(False, True, 0.9),           # model FN, second opinion says H at 0.9: caught at c<=0.9
        row(False, True, 0.3, "rule"),   # rule FN, second opinion unsure: kept
        row(True, False, 0.02, doc="d2"),  # FP, second opinion says not-H at 0.98: caught at c<=0.98
        row(True, True, 0.1),            # correct H, second opinion disagrees at 0.9: lost at c<=0.9
        row(False, False, 0.01),         # correct not-H, agrees: kept
    ]
    r = vetoed_read(decided, 0.8, cards_total=10)
    assert r["caught"] == 2 and r["caught_by_kind"] == {"model-FN": 1, "rule-FN": 0, "FP": 1}
    assert r["correct_lost"] == 1 and r["decided"] == 2 and r["errors"] == 1
    assert r["coverage"] == 0.2 and r["fp"] == 0 and r["negatives"] == 1 and r["documents_with_error"] == 1
    r95 = vetoed_read(decided, 0.95, cards_total=10)
    assert r95["caught"] == 1 and r95["correct_lost"] == 0 and r95["errors"] == 2


def test_bar_is_floor_of_share():
    decided = [row(False, False, 0.0)] * 8893
    assert vetoed_read(decided, 0.5, cards_total=10021)["bar_errors"] == 31
