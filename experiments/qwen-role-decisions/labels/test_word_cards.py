import random, tempfile, zipfile
from pathlib import Path
from labels.word_cards import paragraphs, select_word_candidates

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
STYLES = f'''<w:styles {W}>
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="contactheading"><w:basedOn w:val="Heading1"/></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>
</w:styles>'''
DOC = f'''<w:document {W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="contactheading"/></w:pPr><w:r><w:t>Inherited</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>
<w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>Direct level</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>Bold Big</w:t></w:r></w:p>
<w:p><w:r><w:t>Plain body text that runs on as ordinary paragraphs tend to do in a document.</w:t></w:r></w:p>
<w:p><w:r><w:t></w:t></w:r></w:p>
</w:body></w:document>'''


def make_docx(d):
    p = Path(d) / "t.docx"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("word/document.xml", DOC)
        z.writestr("word/styles.xml", STYLES)
    return p


def test_paragraphs_resolve_outline_levels_and_formatting():
    with tempfile.TemporaryDirectory() as d:
        ps = paragraphs(make_docx(d))
    by = {p["text"]: p for p in ps}
    assert len(ps) == 6  # empty paragraph dropped
    assert by["Title"]["outline_level"] == 0
    assert by["Inherited"]["outline_level"] == 0
    assert by["Contents"]["outline_level"] is None  # level 9 = body text
    assert by["Direct level"]["outline_level"] == 2
    assert by["Bold Big"]["bold"] is True and by["Bold Big"]["size_pt"] == 14.0
    assert by["Inherited"]["prev"] == "Title" and by["Inherited"]["next"] == "Contents"


def test_select_word_candidates_flags_levels_and_formatting():
    with tempfile.TemporaryDirectory() as d:
        ps = paragraphs(make_docx(d))
    out = {c["text"]: c["why"] for c in select_word_candidates(ps, random.Random(1))}
    assert "source_h" in out["Title"] and "source_h" in out["Direct level"]
    assert "short" in out["Contents"] and "source_h" not in out["Contents"]
    assert "outlier" in out["Bold Big"]
