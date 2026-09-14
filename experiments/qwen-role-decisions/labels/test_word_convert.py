import re
from pathlib import Path

from labels.word_convert import EXPORT_FILTER

REPO = Path(__file__).resolve().parents[3]


def test_export_filter_matches_the_products():
    src = (REPO / "src" / "integrations" / "documents" / "convert.ts").read_text()
    assert "UseTaggedPDF" in src and "PDFUACompliance" in src
    assert EXPORT_FILTER.startswith("pdf:writer_pdf_Export:")
    assert '"UseTaggedPDF":{"type":"boolean","value":"true"}' in EXPORT_FILTER.replace(" ", "")
    assert '"PDFUACompliance":{"type":"boolean","value":"true"}' in EXPORT_FILTER.replace(" ", "")
    assert EXPORT_FILTER == 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"},"PDFUACompliance":{"type":"boolean","value":"true"}}'
