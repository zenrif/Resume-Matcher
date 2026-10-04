"""Eval-style structural tests for Indonesian resume tailoring (Phase 6c).

Guarantees anti-fabrication without an LLM judge:
- No fabricated employers
- No fabricated job titles
- No fabricated degrees or educational institutions
- No fabricated numeric figures
- Personal info unchanged and sections preserved
"""

from __future__ import annotations

import re
from typing import Any
import pytest

from tests.evals.scorers import (
    sections_preserved,
    no_fabricated_employers,
    personal_info_unchanged,
    is_valid_resume,
)


def _job_titles(data: dict) -> list[str]:
    """Return stripped position titles from workExperience."""
    titles = []
    for entry in data.get("workExperience", []) or []:
        if isinstance(entry, dict):
            pos = entry.get("position")
            if isinstance(pos, str) and pos.strip():
                titles.append(pos.strip())
    return titles


def _degrees_and_institutions(data: dict) -> tuple[list[str], list[str]]:
    """Return stripped degrees and institutions from education."""
    degrees = []
    institutions = []
    for entry in data.get("education", []) or []:
        if isinstance(entry, dict):
            deg = entry.get("degree")
            inst = entry.get("institution")
            if isinstance(deg, str) and deg.strip():
                degrees.append(deg.strip())
            if isinstance(inst, str) and inst.strip():
                institutions.append(inst.strip())
    return degrees, institutions


def _extract_numeric_tokens(data: dict) -> set[str]:
    """Extract standalone numbers/percentages from all text in resume."""
    from tests.evals.scorers import _iter_text_fragments
    
    text = " ".join(_iter_text_fragments(data))
    # Extract numbers with optional decimals and percent signs, e.g. 15, 30%, 4.5, 100
    pattern = re.compile(r"\b\d+(?:[.,]\d+)?%?(?!\w)")
    matches = pattern.findall(text)
    return {m.strip() for m in matches if m.strip()}


def no_fabricated_job_titles(master: dict, tailored: dict) -> list[str]:
    master_titles = {t.lower() for t in _job_titles(master)}
    fabricated = []
    for t in _job_titles(tailored):
        if t.lower() not in master_titles:
            fabricated.append(t)
    return fabricated


def no_fabricated_education(master: dict, tailored: dict) -> tuple[list[str], list[str]]:
    master_degs, master_insts = _degrees_and_institutions(master)
    master_degs_lower = {d.lower() for d in master_degs}
    master_insts_lower = {i.lower() for i in master_insts}

    tailored_degs, tailored_insts = _degrees_and_institutions(tailored)
    fab_degs = [d for d in tailored_degs if d.lower() not in master_degs_lower]
    fab_insts = [i for i in tailored_insts if i.lower() not in master_insts_lower]
    return fab_degs, fab_insts


def no_fabricated_numbers(master: dict, tailored: dict) -> set[str]:
    master_nums = _extract_numeric_tokens(master)
    tailored_nums = _extract_numeric_tokens(tailored)
    return tailored_nums - master_nums


# Fixtures representing a realistic Indonesian master resume
@pytest.fixture
def indonesian_master_resume() -> dict[str, Any]:
    return {
        "personalInfo": {
            "name": "Budi Santoso",
            "title": "Senior Backend Developer",
            "email": "budi.santoso@example.id",
            "phone": "+62 812-3456-7890",
            "location": "Jakarta, Indonesia",
            "website": "https://budisantoso.dev",
            "linkedin": "https://linkedin.com/in/budisantoso",
            "github": "https://github.com/budisantoso",
        },
        "summary": "Software engineer dengan pengalaman 5 tahun membangun API berbasis Python dan FastAPI.",
        "workExperience": [
            {
                "company": "PT Solusi Digital Nusantara",
                "position": "Backend Developer",
                "location": "Jakarta, Indonesia",
                "date": "2021 - Sekarang",
                "description": [
                    "Mengembangkan microservices menggunakan FastAPI dan PostgreSQL melayani 50000 pengguna aktif harian.",
                    "Mengurangi latensi respons API sebesar 25% melalui pengindeksan basis data dan caching Redis.",
                ],
            },
            {
                "company": "PT Kreasi Teknologi Mandiri",
                "position": "Junior Python Developer",
                "location": "Bandung, Indonesia",
                "date": "2019 - 2021",
                "description": [
                    "Membangun modul automasi data dengan Django dan Celery.",
                    "Membantu meningkatkan cakupan unit test hingga 80%.",
                ],
            },
        ],
        "education": [
            {
                "institution": "Universitas Indonesia",
                "degree": "Sarjana Ilmu Komputer",
                "location": "Depok, Indonesia",
                "date": "2015 - 2019",
                "description": "IPK 3.75 dari 4.00",
            }
        ],
        "additional": {
            "technicalSkills": ["Python", "FastAPI", "PostgreSQL", "Redis", "Docker", "Git"],
            "languages": ["Bahasa Indonesia", "Bahasa Inggris"],
            "certifications": ["AWS Certified Developer"],
        },
    }


def test_truthful_tailored_indonesian_resume(indonesian_master_resume):
    # Tailored resume yang jujur dan relevan
    tailored = {
        "personalInfo": dict(indonesian_master_resume["personalInfo"]),
        "summary": "Senior Backend Developer dengan keahlian mendalam pada Python, FastAPI, dan PostgreSQL.",
        "workExperience": [
            {
                "company": "PT Solusi Digital Nusantara",
                "position": "Backend Developer",
                "location": "Jakarta, Indonesia",
                "date": "2021 - Sekarang",
                "description": [
                    "Merancang arsitektur API FastAPI performa tinggi untuk 50000 pengguna.",
                    "Optimasi query PostgreSQL dan Redis yang menurunkan latensi hingga 25%.",
                ],
            },
            {
                "company": "PT Kreasi Teknologi Mandiri",
                "position": "Junior Python Developer",
                "location": "Bandung, Indonesia",
                "date": "2019 - 2021",
                "description": [
                    "Mengembangkan automasi data berbasis Django.",
                    "Menjaga kualitas kode dengan cakupan unit test 80%.",
                ],
            },
        ],
        "education": list(indonesian_master_resume["education"]),
        "additional": dict(indonesian_master_resume["additional"]),
    }

    assert is_valid_resume(tailored)
    assert personal_info_unchanged(indonesian_master_resume, tailored)
    assert sections_preserved(indonesian_master_resume, tailored)
    assert no_fabricated_employers(indonesian_master_resume, tailored) == []
    assert no_fabricated_job_titles(indonesian_master_resume, tailored) == []
    fab_degs, fab_insts = no_fabricated_education(indonesian_master_resume, tailored)
    assert fab_degs == []
    assert fab_insts == []
    assert no_fabricated_numbers(indonesian_master_resume, tailored) == set()


def test_detects_fabricated_employer_in_indonesian_resume(indonesian_master_resume):
    tailored = dict(indonesian_master_resume)
    tailored["workExperience"] = list(indonesian_master_resume["workExperience"]) + [
        {
            "company": "PT Unicorn Superindo",
            "position": "Lead Architect",
            "date": "2022",
            "description": ["Memimpin tim backend."],
        }
    ]

    fabricated = no_fabricated_employers(indonesian_master_resume, tailored)
    assert "PT Unicorn Superindo" in fabricated


def test_detects_fabricated_job_title_in_indonesian_resume(indonesian_master_resume):
    tailored = dict(indonesian_master_resume)
    tailored["workExperience"] = [
        {
            "company": "PT Solusi Digital Nusantara",
            "position": "VP of Engineering",  # Fabricated title
            "date": "2021 - Sekarang",
            "description": ["Memimpin seluruh departemen rekayasa perangkat lunak."],
        }
    ]

    fabricated_titles = no_fabricated_job_titles(indonesian_master_resume, tailored)
    assert "VP of Engineering" in fabricated_titles


def test_detects_fabricated_education_in_indonesian_resume(indonesian_master_resume):
    tailored = dict(indonesian_master_resume)
    tailored["education"] = [
        {
            "institution": "Institut Teknologi Bandung",  # Fabricated institution
            "degree": "Magister Manajemen Teknologi",     # Fabricated degree
            "date": "2020 - 2022",
        }
    ]

    fab_degs, fab_insts = no_fabricated_education(indonesian_master_resume, tailored)
    assert "Magister Manajemen Teknologi" in fab_degs
    assert "Institut Teknologi Bandung" in fab_insts


def test_detects_fabricated_numeric_metrics_in_indonesian_resume(indonesian_master_resume):
    tailored = dict(indonesian_master_resume)
    tailored["workExperience"] = [
        {
            "company": "PT Solusi Digital Nusantara",
            "position": "Backend Developer",
            "date": "2021 - Sekarang",
            "description": [
                # Mengklaim 99% dan 1000000 padahal di master hanya 25% dan 50000
                "Meningkatkan throughput sebesar 99% untuk 1000000 pengguna baru.",
            ],
        }
    ]

    fab_nums = no_fabricated_numbers(indonesian_master_resume, tailored)
    assert "99%" in fab_nums
    assert "1000000" in fab_nums
