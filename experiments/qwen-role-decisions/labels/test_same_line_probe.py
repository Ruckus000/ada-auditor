from labels.same_line_probe import lead_boundary


def blk(runs, first_line=None):
    fl = first_line if first_line is not None else " ".join(r["text"] for r in runs)
    return {"first_line": fl, "first_line_runs": runs}


def run(text, pt=12, bold=False):
    return {"text": text, "font_pt": pt, "bold": bold}


def test_bold_lead_then_regular_is_a_clean_boundary():
    b = blk([run("Summary", bold=True), run("the body follows here.")])
    assert lead_boundary(b) == "Summary"


def test_larger_lead_then_smaller_regular_is_a_clean_boundary():
    b = blk([run("Scope", pt=14), run("the body follows here.", pt=12)])
    assert lead_boundary(b) == "Scope"


def test_one_run_has_no_boundary():
    assert lead_boundary(blk([run("just one style here")])) is None
    assert lead_boundary(blk([])) is None
    assert lead_boundary({"first_line": "x", "first_line_runs": None}) is None
    assert lead_boundary({}) is None


def test_regular_lead_then_bold_is_not_the_pattern():
    b = blk([run("the body"), run("Emphasis", bold=True)])
    assert lead_boundary(b) is None


def test_smaller_lead_then_larger_regular_is_not_the_pattern():
    b = blk([run("small start", pt=10), run("bigger body", pt=12)])
    assert lead_boundary(b) is None


def test_bold_body_after_bold_lead_is_not_a_style_boundary():
    b = blk([run("Lead", bold=True), run("still bold body", bold=True)])
    assert lead_boundary(b) is None


def test_a_boundary_mid_word_is_not_clean():
    b = blk([run("Summ", bold=True), run("ary the body follows.")],
            first_line="Summary the body follows.")
    assert lead_boundary(b) is None


def test_lead_covering_the_whole_first_line_is_clean():
    b = blk([run("Agenda", bold=True), run("", )], first_line="Agenda")
    assert lead_boundary(b) == "Agenda"
