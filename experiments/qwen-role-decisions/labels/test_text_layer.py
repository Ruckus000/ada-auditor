import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from labels.text_layer import best_word_conf, mark_box, ocr_word_conf

MAGENTA = (255, 0, 255)


CARD = {"document_id": "doc", "page": 0}


def _marked(word: str | None, box: bool = True, render: bool = True) -> Path:
    """``marked_image``'s layout: the clean render ``pages/doc-p1.png`` with ``word`` drawn
    large, and ``pages/marked/doc_1.png``, the same page with a magenta mark drawn tight
    over the glyphs (as the real mark is)."""
    pages = Path(tempfile.mkdtemp())
    im = Image.new("RGB", (600, 200), "white")
    d = ImageDraw.Draw(im)
    if word:
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Times New Roman.ttf", 48)
        except OSError:
            font = ImageFont.load_default()
        d.text((110, 70), word, fill="black", font=font)
    if render:
        im.save(pages / "doc-p1.png")
    if box:
        ImageDraw.Draw(im).rectangle((104, 78, 300, 120), outline=MAGENTA, width=2)
    (pages / "marked").mkdir()
    p = pages / "marked" / "doc_1.png"
    im.save(p)
    return p


def test_a_word_under_a_letterless_text_layer_is_read_with_confidence():
    conf = ocr_word_conf({**CARD, "text": "552,579"}, _marked("NORTH"))
    assert conf is not None and conf >= 80.0


def test_digits_on_the_page_read_no_word():
    assert ocr_word_conf({**CARD, "text": "2019"}, _marked("2019")) == 0.0


def test_the_fact_does_not_apply_to_text_with_letters_or_without_an_image():
    assert ocr_word_conf({**CARD, "text": "NORTH"}, _marked("NORTH")) is None
    assert ocr_word_conf({**CARD, "text": ""}, _marked("NORTH")) is None
    assert ocr_word_conf({**CARD, "text": "552,579"}, None) is None


def test_no_magenta_mark_means_no_measurement():
    assert mark_box(_marked("NORTH", box=False)) is None
    assert ocr_word_conf({**CARD, "text": "552,579"}, _marked("NORTH", box=False)) is None


def test_no_clean_render_beside_the_mark_means_no_measurement():
    assert ocr_word_conf({**CARD, "text": "552,579"}, _marked("NORTH", render=False)) is None


def test_best_word_conf_reads_only_alphabetic_words_of_three_or_more_letters():
    head = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
    row = lambda conf, text: f"5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t{conf}\t{text}"
    tsv = "\n".join([head, row(99, "7-34"), row(97, "LU"), row(-1, ""), row(88.5, "NORTH"), row(91, "BOARD")])
    assert best_word_conf(tsv) == 91.0
    assert best_word_conf(head) == 0.0
