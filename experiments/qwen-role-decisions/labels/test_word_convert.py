import os
import re
import stat
import tempfile
from pathlib import Path

from labels import word_convert
from labels.word_convert import EXPORT_FILTER, convert_docx

REPO = Path(__file__).resolve().parents[3]


def test_export_filter_matches_the_products():
    src = (REPO / "src" / "integrations" / "documents" / "convert.ts").read_text()
    assert "UseTaggedPDF" in src and "PDFUACompliance" in src
    assert EXPORT_FILTER.startswith("pdf:writer_pdf_Export:")
    assert '"UseTaggedPDF":{"type":"boolean","value":"true"}' in EXPORT_FILTER.replace(" ", "")
    assert '"PDFUACompliance":{"type":"boolean","value":"true"}' in EXPORT_FILTER.replace(" ", "")
    assert EXPORT_FILTER == 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"},"PDFUACompliance":{"type":"boolean","value":"true"}}'


def test_convert_docx_does_not_mask_a_failed_run_with_a_stale_pdf():
    """A leftover PDF from an earlier run must not survive a failing soffice call."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        out_dir = tmp_dir / "out"
        out_dir.mkdir()
        src = tmp_dir / "doc.docx"
        src.write_text("not a real docx, only the stem is used")

        stale_pdf = out_dir / "doc.pdf"
        stale_pdf.write_text("stale pdf from an earlier run")

        fake_soffice = tmp_dir / "fake_soffice.sh"
        fake_soffice.write_text("#!/bin/sh\nexit 1\n")
        fake_soffice.chmod(fake_soffice.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

        original_soffice = word_convert.SOFFICE
        word_convert.SOFFICE = str(fake_soffice)
        try:
            result = convert_docx(src, out_dir)
        finally:
            word_convert.SOFFICE = original_soffice

        assert result is None
        assert not stale_pdf.exists()
