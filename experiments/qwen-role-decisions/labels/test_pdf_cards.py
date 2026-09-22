import random
from labels.pdf_cards import drop_duplicate_cards, repeats_on_pages, select_candidates


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
    rows += [{"document_id": "b", "why": ["outlier"], "n": 2000} for i in range(1)]
    out = cap_per_document(rows, random.Random(0), cap=10)
    a = [r for r in out if r["document_id"] == "a"]
    assert len(a) == 10 + 7 and sum(r["why"] == ["source_h"] for r in a) == 5
    assert sum(r["why"] == ["random"] for r in a) == 7
    assert [r["n"] for r in out if r["document_id"] == "b"] == [2000]


def test_drop_duplicate_cards_keeps_first_copy_at_one_box_only():
    first = card(0, "Agenda", tag="H2", y0=74)
    copy = {**card(1, "AGENDA", tag="Figure", y0=74.3)}  # same page, box rounds to the same points, same norm
    elsewhere = card(2, "Agenda", y0=102)  # same text, different box: K34's case, kept here
    other_page = card(3, "Agenda", page=1, y0=74)
    kept, dropped = drop_duplicate_cards([first, copy, elsewhere, other_page])
    assert [c["locator"] for c in kept] == ["d:0", "d:2", "d:3"] and dropped == 1


# Task 1 (Stage 2 round 2): Cards.java reports each block's first physical line.
import tempfile
from pathlib import Path
from run import dump_pdf

# The plan's two real-PDF cases read the ODL-tagged copies (gitignored). The runner has no pytest,
# so a skip prints and returns instead of pytest.skip; the bodies are the plan's verbatim.
import json, subprocess

WILD = Path("out/suggest/wild/c3-0794/odl-out/c3-0794.pdf")


def _tagged_pdf(path: Path, lines: list) -> None:
    """A one-page tagged PDF, written by hand: Document > L > LI, the LI holding one MCID
    whose text is ``lines`` set 14 pt apart in 12 pt Helvetica, then a one-line P. A line may be
    a list of (x, text) runs on one baseline, like a tab stop. Synthetic text only."""
    runs = lambda line: line if isinstance(line, list) else [(72, line)]
    shows = "".join(f"1 0 0 1 {x} {700 - 14 * i} Tm ({t}) Tj\n" for i, line in enumerate(lines) for x, t in runs(line))
    content = (f"/LI <</MCID 0>> BDC\nBT /F1 12 Tf\n{shows}ET\nEMC\n"
               "/P <</MCID 1>> BDC\nBT /F1 12 Tf 1 0 0 1 72 600 Tm (One line only) Tj ET\nEMC\n")
    objs = [
        "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> "
        "/Contents 9 0 R /StructParents 0 >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        "<< /Type /StructTreeRoot /K 6 0 R /ParentTree 10 0 R >>",
        "<< /Type /StructElem /S /Document /P 5 0 R /K [7 0 R 11 0 R] >>",
        "<< /Type /StructElem /S /L /P 6 0 R /K [8 0 R] >>",
        "<< /Type /StructElem /S /LI /P 7 0 R /Pg 3 0 R /K [0] >>",
        f"<< /Length {len(content.encode('latin-1'))} >>\nstream\n{content}endstream",
        "<< /Nums [0 [8 0 R 11 0 R]] >>",
        "<< /Type /StructElem /S /P /P 6 0 R /Pg 3 0 R /K [1] >>",
    ]
    out = bytearray(b"%PDF-1.7\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))


def test_cards_dump_reports_first_line_and_line_count_on_a_synthetic_pdf():
    with tempfile.TemporaryDirectory() as d:
        pdf = Path(d) / "syn.pdf"
        _tagged_pdf(pdf, ["B. Scope", "Every widget shall be", "counted twice."])
        by = {b["existing_tag"]: b for b in dump_pdf(pdf, compile=True)["blocks"]}
    li, p, lst = by["LI"], by["P"], by["L"]
    assert li["text"] == "B. Scope Every widget shall be counted twice."
    assert (li["first_line"], li["line_count"]) == ("B. Scope", 3)
    assert (p["first_line"], p["line_count"]) == ("One line only", 1)
    assert (lst["first_line"], lst["line_count"]) == ("B. Scope", 3)  # a container reports its gathered glyphs
    # first_line_x1: the right edge of the first line, from the same glyph walk
    assert 72 < li["first_line_x1"] < li["x1"]  # "B. Scope" ends well inside the block
    assert (li["first_line_x1"] - li["x0"]) < 0.6 * (li["x1"] - li["x0"])  # the run-in rule's width test fires
    assert p["first_line_x1"] == p["x1"]  # one line: the first line is the whole block



def test_first_line_keeps_an_enumerator_and_its_words_across_a_tab_gap_on_one_baseline():
    with tempfile.TemporaryDirectory() as d:
        pdf = Path(d) / "syn.pdf"
        _tagged_pdf(pdf, [[(72, "VI."), (108, "Budget Process")], "Every widget shall be", "counted twice."])
        li = next(b for b in dump_pdf(pdf, compile=True)["blocks"] if b["existing_tag"] == "LI")
    assert (li["first_line"], li["line_count"]) == ("VI. Budget Process", 3)
    assert li["first_line_x1"] > 108  # x1 covers the second run past the tab gap, not just "VI."


# Task 3 (Stage 2 same-line probe): Cards.java reports the first line's style runs —
# the smallest per-glyph style output that can show a bold (or larger) run at the start
# of the first line followed by regular text. Every pre-existing field is untouched.

def _styled_tagged_pdf(path: Path, lines: list) -> None:
    """Like _tagged_pdf, but each line is a list of (x, text, font, size) runs on one
    baseline; font is "F1" (Helvetica) or "F2" (Helvetica-Bold). Synthetic text only."""
    shows = "".join(
        f"BT /{f} {s} Tf 1 0 0 1 {x} {700 - 14 * i} Tm ({t}) Tj ET\n"
        for i, line in enumerate(lines) for x, t, f, s in line)
    content = f"/LI <</MCID 0>> BDC\n{shows}EMC\n"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 12 0 R >> >> "
        "/Contents 9 0 R /StructParents 0 >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        "<< /Type /StructTreeRoot /K 6 0 R /ParentTree 10 0 R >>",
        "<< /Type /StructElem /S /Document /P 5 0 R /K [7 0 R] >>",
        "<< /Type /StructElem /S /L /P 6 0 R /K [8 0 R] >>",
        "<< /Type /StructElem /S /LI /P 7 0 R /Pg 3 0 R /K [0] >>",
        f"<< /Length {len(content.encode('latin-1'))} >>\nstream\n{content}endstream",
        "<< /Nums [0 [8 0 R]] >>",
        "<< /Type /StructElem /S /P /P 6 0 R /Pg 3 0 R /K [0] >>",  # unused sibling-free shape
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]
    out = bytearray(b"%PDF-1.7\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1 }\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))


def _styled_li(lines: list) -> dict:
    with tempfile.TemporaryDirectory() as d:
        pdf = Path(d) / "syn.pdf"
        _styled_tagged_pdf(pdf, lines)
        return next(b for b in dump_pdf(pdf, compile=True)["blocks"] if b["existing_tag"] == "LI")


def test_first_line_runs_show_a_bold_lead_in_then_regular_text():
    li = _styled_li([[(72, "Summary", "F2", 12), (150, "the body follows here", "F1", 12)]])
    assert li["first_line_runs"] == [
        {"text": "Summary", "font_pt": 12, "bold": True},
        {"text": "the body follows here", "font_pt": 12, "bold": False}]


def test_first_line_runs_show_a_larger_lead_in_then_regular_text():
    li = _styled_li([[(72, "Scope", "F1", 14), (150, "the body follows here", "F1", 12)]])
    assert li["first_line_runs"] == [
        {"text": "Scope", "font_pt": 14, "bold": False},
        {"text": "the body follows here", "font_pt": 12, "bold": False}]


def test_first_line_runs_cover_only_the_first_line():
    li = _styled_li([[(72, "Summary", "F2", 12), (150, "the body follows", "F1", 12)],
                     [(72, "next line is bold again", "F2", 12)]])
    assert li["first_line_runs"] == [
        {"text": "Summary", "font_pt": 12, "bold": True},
        {"text": "the body follows", "font_pt": 12, "bold": False}]
    assert li["line_count"] == 2


def test_first_line_runs_collapse_one_style_into_one_run():
    li = _styled_li([[(72, "all one style on this line", "F1", 12)]])
    assert li["first_line_runs"] == [{"text": "all one style on this line", "font_pt": 12, "bold": False}]


def test_first_line_runs_empty_for_a_glyphless_block():
    li = _styled_li([[(72, "", "F1", 12)]])
    assert li["first_line_runs"] == []


def test_cards_dump_reports_first_line_and_line_count():
    if not WILD.is_file():
        print("skip: wild tagged copy not present on this machine"); return
    raw = dump_pdf(WILD, compile=True)
    by = {b["locator"]: b for b in raw["blocks"]}
    assert by["c3-0794:9"]["first_line"] == "A. Plans"
    assert by["c3-0794:9"]["line_count"] >= 8
    assert by["c3-0794:10"]["first_line"] == "A." and by["c3-0794:10"]["line_count"] == 1


def test_first_line_joins_an_enumerator_and_its_words_across_a_tab_gap():
    # c3-0094 page 3: "VI." at x=90 and "Budget Process – Execution" at x=126 share one baseline.
    tagged = Path("out/suggest/wild/c3-0094/odl-out/c3-0094.pdf")
    if not tagged.is_file():
        print("skip: wild tagged copy not present on this machine"); return
    by = {b["locator"]: b for b in dump_pdf(tagged, compile=False)["blocks"]}
    assert by["c3-0094:54"]["first_line"] == "VI. Budget Process – Execution"
    assert by["c3-0094:54"]["line_count"] >= 5
