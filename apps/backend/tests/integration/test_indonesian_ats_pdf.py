"""ATS compatibility test for Indonesian resume PDF rendering (Phase 6d).

Tests that rendering an Indonesian resume through the PDF pipeline emits text
that pdfminer.six can extract in proper reading order, ensuring ATS readability.
"""

from __future__ import annotations

import io
import urllib.parse
import pytest
from pdfminer.high_level import extract_text
from playwright.async_api import Error as PlaywrightError

from app.pdf import (
    PDFRenderError,
    close_pdf_renderer,
    render_resume_pdf,
)


# Self-contained Indonesian resume HTML formatted for ATS readability (single column)
INDONESIAN_RESUME_HTML = """<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: sans-serif; margin: 0; padding: 20px; }
        .resume-print { max-width: 800px; margin: 0 auto; }
        h1 { margin: 0 0 5px 0; font-size: 24px; }
        .subtitle { font-size: 16px; font-weight: bold; color: #333; margin-bottom: 8px; }
        .contact { font-size: 12px; margin-bottom: 20px; color: #666; }
        h2 { font-size: 16px; border-bottom: 1px solid #333; padding-bottom: 4px; margin-top: 20px; }
        .item-header { font-weight: bold; font-size: 14px; margin-top: 10px; }
        .item-sub { font-style: italic; font-size: 13px; color: #444; }
        ul { margin: 5px 0 15px 20px; padding: 0; }
        li { font-size: 12px; line-height: 1.4; }
    </style>
</head>
<body>
    <div class="resume-print">
        <h1>Budi Santoso</h1>
        <div class="subtitle">Senior Backend Developer</div>
        <div class="contact">Jakarta, Indonesia | budi.santoso@example.id | +62 812-3456-7890 | linkedin.com/in/budisantoso</div>

        <h2>Ringkasan Profesional</h2>
        <p>Software engineer dengan pengalaman 5 tahun membangun API berskala tinggi dengan Python, FastAPI, dan PostgreSQL.</p>

        <h2>Pengalaman Kerja</h2>
        <div class="item-header">PT Solusi Digital Nusantara</div>
        <div class="item-sub">Senior Backend Engineer (2021 - Sekarang)</div>
        <ul>
            <li>Mengembangkan arsitektur microservices berbasis FastAPI yang melayani 50000 pengguna aktif harian.</li>
            <li>Mengoptimalkan query database PostgreSQL dan Redis caching sehingga memangkas latensi hingga 25%.</li>
        </ul>

        <div class="item-header">PT Kreasi Teknologi Mandiri</div>
        <div class="item-sub">Junior Python Developer (2019 - 2021)</div>
        <ul>
            <li>Mengembangkan layanan backend automasi menggunakan Django dan Celery.</li>
            <li>Mencapai cakupan unit test 80% untuk seluruh modul pembayaran.</li>
        </ul>

        <h2>Pendidikan</h2>
        <div class="item-header">Universitas Indonesia</div>
        <div class="item-sub">Sarjana Ilmu Komputer (2015 - 2019)</div>
        <ul>
            <li>Lulus dengan predikat sangat memuaskan, fokus pada Sistem Terdistribusi.</li>
        </ul>

        <h2>Keahlian</h2>
        <p>Keahlian Teknis: Python, FastAPI, PostgreSQL, Redis, Docker, Git, REST API</p>
    </div>
</body>
</html>
"""

INDONESIAN_RESUME_DATA_URL = (
    "data:text/html;charset=utf-8," + urllib.parse.quote(INDONESIAN_RESUME_HTML)
)


async def _render_or_skip(url: str, **kwargs) -> bytes:
    """Render url to PDF or skip gracefully if Chromium is not available."""
    try:
        return await render_resume_pdf(url, **kwargs)
    except PDFRenderError as exc:
        if "executable" in str(exc).lower():
            pytest.skip(f"chromium unavailable: {exc}")
        raise
    except PlaywrightError as exc:
        if "Executable doesn't exist" in str(exc):
            pytest.skip(f"chromium unavailable: {exc}")
        raise
    except NotImplementedError as exc:
        pytest.skip(f"chromium subprocess launch unsupported: {exc}")


@pytest.fixture(autouse=True)
async def _teardown_renderer():
    yield
    await close_pdf_renderer()


@pytest.mark.asyncio
async def test_indonesian_resume_pdf_ats_extraction():
    """Verify that PDF rendering preserves Indonesian characters and linear reading order."""
    pdf_bytes = await _render_or_skip(INDONESIAN_RESUME_DATA_URL, page_size="A4")
    assert isinstance(pdf_bytes, (bytes, bytearray))
    assert pdf_bytes.startswith(b"%PDF")

    # Extract text using pdfminer.six
    text = extract_text(io.BytesIO(pdf_bytes))
    assert text and len(text.strip()) > 0

    # 1. Assert key strings are present in extracted ATS text
    key_strings = [
        "Budi Santoso",
        "Senior Backend Developer",
        "Jakarta, Indonesia",
        "budi.santoso@example.id",
        "Ringkasan Profesional",
        "Pengalaman Kerja",
        "PT Solusi Digital Nusantara",
        "FastAPI",
        "PostgreSQL",
        "PT Kreasi Teknologi Mandiri",
        "Pendidikan",
        "Universitas Indonesia",
        "Sarjana Ilmu Komputer",
        "Keahlian Teknis",
    ]
    for s in key_strings:
        assert s in text, f"Key string '{s}' missing in ATS extracted text."

    # 2. Assert linear reading order (top to bottom)
    idx_name = text.index("Budi Santoso")
    idx_title = text.index("Senior Backend Developer")
    idx_summary = text.index("Ringkasan Profesional")
    idx_exp = text.index("Pengalaman Kerja")
    idx_company1 = text.index("PT Solusi Digital Nusantara")
    idx_company2 = text.index("PT Kreasi Teknologi Mandiri")
    idx_edu = text.index("Pendidikan")
    idx_univ = text.index("Universitas Indonesia")
    idx_skills = text.index("Keahlian")

    assert idx_name < idx_title < idx_summary < idx_exp < idx_company1 < idx_company2 < idx_edu < idx_univ < idx_skills, (
        "Extracted text violates chronological ATS reading order."
    )
