"""Tests for Indonesian AI phrase removal and refinement (Phase 6c)."""

import pytest
from app.prompts.refinement import (
    AI_PHRASE_BLACKLIST,
    AI_PHRASE_BLACKLIST_ID,
    AI_PHRASE_REPLACEMENTS,
    AI_PHRASE_REPLACEMENTS_ID,
    get_ai_phrase_blacklist,
    get_ai_phrase_replacements,
)
from app.services.refiner import remove_ai_phrases


def test_get_ai_phrase_blacklist():
    assert get_ai_phrase_blacklist("en") == AI_PHRASE_BLACKLIST
    assert get_ai_phrase_blacklist("id") == AI_PHRASE_BLACKLIST_ID
    assert get_ai_phrase_blacklist("fr") == AI_PHRASE_BLACKLIST  # Default to en


def test_get_ai_phrase_replacements():
    assert get_ai_phrase_replacements("en") == AI_PHRASE_REPLACEMENTS
    assert get_ai_phrase_replacements("id") == AI_PHRASE_REPLACEMENTS_ID


def test_indonesian_ai_phrases_removal():
    data = {
        "summary": "Profesional berdedikasi tinggi dan pekerja keras yang memelopori transformasi digital.",
        "workExperience": [
            {
                "company": "PT Maju Mundur",
                "position": "Software Engineer",
                "description": [
                    "Merevolusi sistem backend dalam rangka untuk meningkatkan efisiensi.",
                    "Mampu bekerja di bawah tekanan untuk mencapai sinergi tim.",
                    "Mendayagunakan arsitektur modern — menghasilkan kinerja terbaik di kelasnya.",
                ],
            }
        ],
    }

    cleaned, removed = remove_ai_phrases(data, language="id")

    assert "berdedikasi tinggi" in removed
    assert "pekerja keras" in removed
    assert "memelopori" in removed
    assert "merevolusi" in removed
    assert "dalam rangka untuk" in removed
    assert "mampu bekerja di bawah tekanan" in removed
    assert "sinergi" in removed
    assert "mendayagunakan" in removed
    assert "terbaik di kelasnya" in removed
    assert "—" in removed

    # Verifikasi penggantian teks
    summary = cleaned["summary"]
    assert "memimpin" in summary
    assert "berdedikasi tinggi" not in summary

    exp = cleaned["workExperience"][0]["description"]
    assert "mengubah" in exp[0].lower()
    assert "untuk meningkatkan" in exp[0]
    assert "kolaborasi" in exp[1]
    assert "menggunakan" in exp[2]


def test_indonesian_jd_protection():
    data = {
        "summary": "Kandidat mampu bekerja di bawah tekanan dan memiliki sinergi yang baik.",
    }
    jd = "Dibutuhkan kandidat yang mampu bekerja di bawah tekanan untuk proyek ini."

    cleaned, removed = remove_ai_phrases(data, job_description=jd, language="id")

    # "mampu bekerja di bawah tekanan" ada di JD, jadi tidak boleh dihapus
    assert "mampu bekerja di bawah tekanan" not in removed
    assert "mampu bekerja di bawah tekanan" in cleaned["summary"]
    # "sinergi" tidak ada di JD, jadi tetap dihapus/diganti
    assert "sinergi" in removed
    assert "kolaborasi" in cleaned["summary"]
