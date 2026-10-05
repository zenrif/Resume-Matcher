"""Language detection service for resumes and job descriptions.

Zero-dependency language detector supporting Indonesian, English, and other supported
locales based on Unicode character analysis and stopword frequency scoring.
"""

from __future__ import annotations

import re
from typing import Final

# Regex pattern for words (letters and underscores)
_WORD_RE: Final = re.compile(r"\b[a-zA-ZáéíóúüñãõçàèìòùâêîôûÁÉÍÓÚÜÑÃÕÇÀÈÌÒÙÂÊÎÔÛ]+\b")

# Indonesian indicator words / stopwords
_ID_WORDS: Final[frozenset[str]] = frozenset({
    "yang", "dan", "di", "dari", "untuk", "pada", "dengan", "sebagai", "adalah",
    "ke", "dalam", "ini", "itu", "atau", "pengalaman", "kerja", "pendidikan",
    "kemampuan", "tanggung", "jawab", "proyek", "ringkasan", "tahun", "bulan",
    "sistem", "perusahaan", "kualifikasi", "persyaratan", "keahlian", "sertifikasi",
    "pelatihan", "jurusan", "universitas", "lulusan", "tugas", "posisi", "memiliki",
    "mampu", "mengembangkan", "membuat", "mengelola", "melakukan", "karyawan",
    "tingkat", "jenjang", "pelaksana", "informasi", "kompetensi", "kegiatan",
    "organisasi", "penghargaan", "riwayat", "pekerjaan", "deskripsi", "syarat",
    "dibutuhkan", "lowongan", "penempatan", "kejuruan", "surabaya", "jakarta",
    "bandung", "indonesia", "kemahiran", "bahasa",
})

# English indicator words / stopwords
_EN_WORDS: Final[frozenset[str]] = frozenset({
    "the", "and", "in", "of", "to", "for", "with", "on", "at", "from", "by",
    "an", "as", "experience", "education", "skills", "projects", "summary",
    "developer", "engineer", "responsible", "management", "years", "requirements",
    "qualifications", "technologies", "developed", "built", "managed", "led",
    "created", "worked", "team", "bachelor", "university", "professional",
    "development", "software", "product", "solutions", "collaborating", "proven",
    "design", "designed", "implement", "implemented", "learning", "degree",
    "certifications", "training", "awards", "responsibilities", "proficient",
})

# Spanish indicator words
_ES_WORDS: Final[frozenset[str]] = frozenset({
    "el", "la", "los", "las", "un", "una", "de", "en", "para", "con", "por",
    "del", "experiencia", "educacion", "habilidades", "proyectos", "resumen",
    "trabajo", "empresa", "anos", "desarrollador", "responsabilidades",
})

# French indicator words
_FR_WORDS: Final[frozenset[str]] = frozenset({
    "le", "la", "les", "des", "un", "une", "pour", "dans", "avec", "sur",
    "experience", "formation", "competences", "projets", "resume", "ans",
    "developpeur", "responsabilites", "entreprise",
})

# Portuguese indicator words
_PT_WORDS: Final[frozenset[str]] = frozenset({
    "o", "os", "as", "um", "uma", "para", "com", "em", "dos", "das", "pelo",
    "experiencia", "educacao", "habilidades", "projetos", "resumo", "anos",
    "desenvolvedor", "responsabilidades", "empresa",
})


def detect_language(text: str | None, default: str = "en") -> str:
    """Detect the dominant language of a resume or job description text.

    Returns one of the supported language codes:
    'id', 'en', 'es', 'zh', 'ja', 'ko', 'fr', 'pt'.

    Args:
        text: Input text (markdown, raw text, or description).
        default: Fallback language code if detection is inconclusive.

    Returns:
        Detected ISO language code (e.g. 'id' or 'en').
    """
    if not text or not isinstance(text, str) or not text.strip():
        return default

    # 1. Check for Asian scripts
    # Japanese: Hiragana (\u3040-\u309f) or Katakana (\u30a0-\u30ff)
    if re.search(r"[\u3040-\u309f\u30a0-\u30ff]", text):
        return "ja"

    # Korean: Hangul syllables (\uac00-\ud7af) or Jamo (\u1100-\u11ff)
    if re.search(r"[\uac00-\ud7af\u1100-\u11ff]", text):
        return "ko"

    # Chinese: CJK Unified Ideographs (\u4e00-\u9fff) without kana
    if len(re.findall(r"[\u4e00-\u9fff]", text)) >= 10:
        return "zh"

    # 2. Tokenize Latin words
    words = [w.lower() for w in _WORD_RE.findall(text)]
    if not words:
        return default

    # 3. Calculate scores based on unique matches and frequencies
    id_score = sum(1 for w in words if w in _ID_WORDS)
    en_score = sum(1 for w in words if w in _EN_WORDS)
    es_score = sum(1 for w in words if w in _ES_WORDS)
    fr_score = sum(1 for w in words if w in _FR_WORDS)
    pt_score = sum(1 for w in words if w in _PT_WORDS)

    scores = {
        "id": id_score,
        "en": en_score,
        "es": es_score,
        "fr": fr_score,
        "pt": pt_score,
    }

    max_lang, max_score = max(scores.items(), key=lambda item: item[1])

    # If the highest score is 0 or very low, fall back to default
    if max_score < 2:
        return default

    # Indonesian vs English disambiguation:
    # Since Indonesian tech resumes frequently use English tech keywords (PHP, Laravel, Git, etc.),
    # if Indonesian indicator words are strongly present (>= 3 words), prioritize Indonesian
    # unless English dominates by more than 2.5x.
    if max_lang == "id" and id_score >= 2:
        return "id"
    if id_score >= 3 and id_score >= en_score * 0.4:
        return "id"

    return max_lang
